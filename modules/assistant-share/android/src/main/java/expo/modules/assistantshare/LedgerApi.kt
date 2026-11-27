package expo.modules.assistantshare

import android.database.Cursor
import android.database.sqlite.SQLiteConstraintException
import android.database.sqlite.SQLiteDatabase
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import java.util.UUID

class LedgerError(val code: String, override val message: String) : RuntimeException(message)

/**
 * tests/provider/ledger.py 의 한 줄씩 옮긴 포팅. 규칙을 바꿀 때는 Python 참조 구현과 docs/provider-sql.md 를 먼저 고친다.
 * 호출자 검사는 Provider 에서 끝낸 뒤 여기로 온다.
 */
object LedgerApi {
  private const val MAX_AMOUNT = 9_999_999_999L
  private const val DATE_MIN = "2000-01-01"
  private const val DATE_MAX = "2100-12-31"
  private const val MAX_SPAN_DAYS = 400L
  private const val DEFAULT_WINDOW_DAYS = 90L
  private const val DEFAULT_LIMIT = 1500
  private const val MAX_LIMIT = 3000
  private const val MAX_RULES = 200
  private const val MAX_ITEMS = 100
  private const val ITEMS_DEFAULT_LIMIT = 200
  private const val ITEMS_MAX_LIMIT = 500
  private const val MAX_QTY = 1_000_000.0
  private val REQ_ID_RE = Regex("^[A-Za-z0-9_.:\\-]{1,64}$")
  private val DATE_RE = Regex("^\\d{4}-\\d{2}-\\d{2}$")
  private val TIME_RE = Regex("^([01]\\d|2[0-3]):[0-5]\\d$")
  private val TYPES = setOf("expense", "income", "transfer")
  private val RULE_MATCHES = setOf("merchant", "category", "memo", "any")
  private val ISO_MS = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC)

  fun handle(db: SQLiteDatabase, method: String, arg: String?): JSONObject {
    val obj = parse(arg)
    return when (method) {
      "query" -> query(db, obj)
      "items" -> items(db, obj)
      "add" -> add(db, obj)
      "update" -> update(db, obj)
      "delete" -> delete(db, obj)
      "add_rule" -> addRule(db, obj)
      "delete_rule" -> deleteRule(db, obj)
      else -> throw LedgerError("unknown_method", method)
    }
  }

  // ---- 작은 도구들 ----------------------------------------------------------------------------
  private fun parse(arg: String?): JSONObject {
    if (arg == null || arg.isBlank()) return JSONObject()
    if (arg.length > 20_000) throw LedgerError("invalid", "요청이 너무 커요")
    return try { JSONObject(arg) } catch (e: JSONException) { throw LedgerError("invalid", "요청 형식이 올바르지 않아요") }
  }

  private fun Cursor.str(name: String): String? { val i = getColumnIndexOrThrow(name); return if (isNull(i)) null else getString(i) }
  private fun Cursor.lng(name: String): Long { val i = getColumnIndexOrThrow(name); return if (isNull(i)) 0L else getLong(i) }

  private fun nowIso(): String = ISO_MS.format(Instant.now())
  private fun today(): String = LocalDate.now().toString()
  fun norm(s: String): String = s.filter { !it.isWhitespace() }.lowercase()
  private fun catDisplay(name: String, parent: String?) = if (parent != null) "$parent>$name" else name

  /** 값이 없거나 null 이거나 빈 문자열이면 "없음" (Python 의 `arg.get(k) in (None, "")`) */
  private fun blank(o: JSONObject, k: String): Boolean = !o.has(k) || o.isNull(k) || (o.opt(k) is String && (o.opt(k) as String).isEmpty())
  private fun refString(o: JSONObject, k: String): String = o.opt(k).toString()

  private inline fun <T> rows(db: SQLiteDatabase, sql: String, args: Array<String>? = null, f: (Cursor) -> T): List<T> {
    val out = ArrayList<T>()
    db.rawQuery(sql, args).use { c -> while (c.moveToNext()) out.add(f(c)) }
    return out
  }

  private fun first(db: SQLiteDatabase, sql: String, vararg args: String): Boolean =
    db.rawQuery(sql, arrayOf(*args)).use { it.moveToFirst() }

  // ---- 이름 매칭 ----------------------------------------------------------------------------
  private data class Acc(val id: String, val name: String, val archived: Boolean)
  private data class Cat(val id: String, val name: String, val type: String, val parentName: String?, val archived: Boolean)

  private fun resolveAccount(db: SQLiteDatabase, ref: String, forWrite: Boolean): String {
    val all = rows(db, LedgerSql.ACCOUNTS) { Acc(it.str("id")!!, it.str("name")!!, it.lng("archived") != 0L) }
    val pool = if (forWrite) all.filter { !it.archived } else all
    val refS = ref.trim()
    all.firstOrNull { it.id == refS }?.let {
      if (forWrite && it.archived) throw LedgerError("invalid", "'${it.name}' 통장은 보관(숨김) 상태라 기록할 수 없어요")
      return it.id
    }
    val n = norm(refS)
    if (n.isEmpty()) throw LedgerError("invalid", "통장 이름이 비어 있어요")
    val exact = pool.filter { norm(it.name) == n }
    if (exact.size == 1) return exact[0].id
    if (exact.size > 1) throw LedgerError("ambiguous", "통장이 여러 개예요: " + exact.joinToString(", ") { it.name })
    val part = pool.filter { norm(it.name).contains(n) }
    if (part.size == 1) return part[0].id
    if (part.size > 1) throw LedgerError("ambiguous", "'$refS' 와 맞는 통장이 여러 개예요: " + part.joinToString(", ") { it.name })
    val archived = all.filter { it.archived && norm(it.name).contains(n) }
    if (forWrite && archived.isNotEmpty()) throw LedgerError("invalid", "'${archived[0].name}' 통장은 보관(숨김) 상태라 기록할 수 없어요")
    throw LedgerError("not_found", "'$refS' 통장을 찾을 수 없어요. 있는 통장: " + pool.joinToString(", ") { it.name })
  }

  private fun resolveCategory(db: SQLiteDatabase, ref: String, txType: String): String {
    val all = rows(db, LedgerSql.CATEGORIES) { Cat(it.str("id")!!, it.str("name")!!, it.str("type")!!, it.str("parent_name"), it.lng("archived") != 0L) }
    val rows = all.filter { it.type == txType && !it.archived }
    val refS = ref.trim()
    rows.firstOrNull { it.id == refS }?.let { return it.id }
    if (norm(refS).isEmpty()) throw LedgerError("invalid", "카테고리 이름이 비어 있어요")
    val pool: List<Cat>
    if (refS.contains(">")) {
      val hn = norm(refS.substringBefore(">"))
      val tn = norm(refS.substringAfter(">"))
      val exact = rows.filter { it.parentName != null && norm(it.parentName) == hn && norm(it.name) == tn }
      pool = if (exact.isNotEmpty()) exact else rows.filter { it.parentName != null && norm(it.parentName).contains(hn) && norm(it.name).contains(tn) }
    } else {
      val n = norm(refS)
      val exact = rows.filter { norm(it.name) == n }
      pool = if (exact.isNotEmpty()) exact else rows.filter { norm(it.name).contains(n) }
    }
    if (pool.size == 1) return pool[0].id
    if (pool.size > 1) throw LedgerError("ambiguous", "'$refS' 와 맞는 카테고리가 여러 개예요: " + pool.joinToString(", ") { catDisplay(it.name, it.parentName) })
    throw LedgerError("not_found", "'$refS' 카테고리를 찾을 수 없어요 (${if (txType == "expense") "지출" else "수입"}). 예: " +
      rows.take(12).joinToString(", ") { catDisplay(it.name, it.parentName) })
  }

  // ---- 입력 검증 ----------------------------------------------------------------------------
  private fun vAmount(v: Any?): Long {
    if (v !is Number) throw LedgerError("invalid", "amount 는 정수(원)여야 해요")
    val d = v.toDouble()
    if (d.isNaN() || d.isInfinite() || d != Math.floor(d)) throw LedgerError("invalid", "amount 는 정수(원)여야 해요")
    val l = v.toLong()
    if (l < 1 || l > MAX_AMOUNT) throw LedgerError("invalid", "amount 는 1 ~ 9,999,999,999 사이여야 해요")
    return l
  }

  private fun vDate(v: Any?): String {
    if (v !is String || !DATE_RE.matches(v)) throw LedgerError("invalid", "date 는 YYYY-MM-DD 형식이어야 해요")
    try { LocalDate.parse(v) } catch (e: Exception) { throw LedgerError("invalid", "존재하지 않는 날짜예요") }
    if (v < DATE_MIN || v > DATE_MAX) throw LedgerError("invalid", "date 는 $DATE_MIN ~ $DATE_MAX 사이여야 해요")
    return v
  }

  private fun vTime(v: Any?): String? {
    if (v == null || v == JSONObject.NULL || v == "") return null
    if (v !is String || !TIME_RE.matches(v)) throw LedgerError("invalid", "time 은 HH:MM 형식이어야 해요")
    return v
  }

  private fun vText(v: Any?, name: String, cap: Int): String? {
    if (v == null || v == JSONObject.NULL) return null
    if (v !is String) throw LedgerError("invalid", "$name 는 문자열이어야 해요")
    val s = v.trim()
    if (s.length > cap) throw LedgerError("invalid", "$name 는 ${cap}자 이하여야 해요")
    return if (s.isEmpty()) null else s
  }

  private fun vTags(v: Any?): String? {
    if (v == null || v == JSONObject.NULL) return null
    val parts: List<String> = when (v) {
      is JSONArray -> (0 until v.length()).mapNotNull { v.opt(it) as? String }
      is String -> v.split(',', '\n')
      else -> throw LedgerError("invalid", "tags 는 문자열이어야 해요")
    }
    val out = ArrayList<String>()
    for (p in parts) {
      val t = p.trim().trimStart('#').trim()
      if (t.isEmpty()) continue
      if (t.length > 20) throw LedgerError("invalid", "태그는 20자 이하여야 해요")
      if (!out.contains(t)) out.add(t)
    }
    if (out.size > 10) throw LedgerError("invalid", "태그는 10개까지예요")
    return if (out.isEmpty()) null else out.joinToString(",")
  }

  // ---- 영수증 품목 ----------------------------------------------------------------------------
  private data class Item(val name: String, val qty: Double, val unitPrice: Long?, val amount: Long, val categoryId: String?)

  private fun wholeLong(v: Any?, what: String, min: Long, max: Long): Long {
    if (v !is Number) throw LedgerError("invalid", what)
    val d = v.toDouble()
    if (d.isNaN() || d.isInfinite() || d != Math.floor(d)) throw LedgerError("invalid", what)
    val l = v.toLong()
    if (l < min || l > max) throw LedgerError("invalid", what)
    return l
  }

  /** items 배열 검증·정규화 (빈 배열 허용). tests/provider/ledger.py v_items 의 포팅 */
  private fun vItems(db: SQLiteDatabase, v: Any?, txType: String): List<Item> {
    if (v == null || v == JSONObject.NULL) return emptyList()
    if (v !is JSONArray) throw LedgerError("invalid", "items 는 배열이어야 해요")
    if (v.length() > MAX_ITEMS) throw LedgerError("invalid", "품목은 ${MAX_ITEMS}개까지예요")
    if (v.length() > 0 && txType == "transfer") throw LedgerError("invalid", "이체에는 품목을 쓸 수 없어요")
    val out = ArrayList<Item>()
    for (idx in 0 until v.length()) {
      val n = idx + 1
      val it = v.opt(idx) as? JSONObject ?: throw LedgerError("invalid", "품목 $n: 형식이 올바르지 않아요")
      val name = vText(it.opt("name"), "품목 name", 80) ?: throw LedgerError("invalid", "품목 $n: name 이 필요해요")
      var qty = 1.0
      if (it.has("qty") && !it.isNull("qty")) {
        val q = it.opt("qty")
        if (q !is Number || q.toDouble().isNaN() || !(q.toDouble() > 0.0 && q.toDouble() <= MAX_QTY)) {
          throw LedgerError("invalid", "품목 $n: qty 는 0 보다 크고 1,000,000 이하인 숫자여야 해요")
        }
        qty = q.toDouble()
      }
      var unitPrice: Long? = null
      if (it.has("unit_price") && !it.isNull("unit_price")) unitPrice = wholeLong(it.opt("unit_price"), "품목 $n: unit_price 는 0 이상의 정수여야 해요", 0, MAX_AMOUNT)
      val amount = wholeLong(it.opt("amount"), "품목 $n: amount 는 정수(원)여야 해요 (할인은 음수)", -MAX_AMOUNT, MAX_AMOUNT)
      val cat = if (!blank(it, "category")) resolveCategory(db, refString(it, "category"), txType) else null
      out.add(Item(name, qty, unitPrice, amount, cat))
    }
    return out
  }

  private fun checkItemsSum(items: List<Item>, amount: Long) {
    if (items.isEmpty()) return
    val total = items.sumOf { it.amount }
    if (total != amount) throw LedgerError("invalid", "품목 합계 ${"%,d".format(java.util.Locale.US, total)}원 ≠ 총액 ${"%,d".format(java.util.Locale.US, amount)}원")
  }

  private fun insertItems(db: SQLiteDatabase, txId: String, items: List<Item>) {
    items.forEachIndexed { n, i ->
      db.execSQL(LedgerSql.ITEM_INSERT, arrayOf<Any?>("it_" + UUID.randomUUID().toString().replace("-", "").substring(0, 16), txId, i.name, i.qty, i.unitPrice, i.amount, i.categoryId, n))
    }
  }

  private fun putQty(o: JSONObject, q: Double) {
    if (q == Math.floor(q)) o.put("qty", q.toLong()) else o.put("qty", q)
  }

  private fun itemJson(c: Cursor): JSONObject {
    val o = JSONObject().put("name", c.str("name"))
    putQty(o, c.getDouble(c.getColumnIndexOrThrow("qty")))
    o.put("amount", c.lng("amount"))
    val ui = c.getColumnIndexOrThrow("unit_price")
    if (!c.isNull(ui)) o.put("unit_price", c.getLong(ui))
    c.str("category")?.takeIf { it.isNotEmpty() }?.let { o.put("category", catDisplay(it, c.str("category_parent"))) }
    return o
  }

  // ---- 응답 모양 ----------------------------------------------------------------------------
  private fun txJson(c: Cursor): JSONObject {
    val o = JSONObject()
    o.put("id", c.str("id")); o.put("type", c.str("type")); o.put("amount", c.lng("amount"))
    o.put("date", c.str("date")); o.put("account", c.str("account")); o.put("source", c.str("source"))
    c.str("time")?.takeIf { it.isNotEmpty() }?.let { o.put("time", it) }
    c.str("to_account")?.takeIf { it.isNotEmpty() }?.let { o.put("to_account", it) }
    c.str("category")?.takeIf { it.isNotEmpty() }?.let { o.put("category", catDisplay(it, c.str("category_parent"))) }
    for (k in arrayOf("merchant", "memo", "tags")) c.str(k)?.takeIf { it.isNotEmpty() }?.let { o.put(k, it) }
    return o
  }

  private fun loadTx(db: SQLiteDatabase, id: String): JSONObject {
    val o = db.rawQuery(LedgerSql.TX_BY_ID, arrayOf(id)).use { if (it.moveToFirst()) txJson(it) else throw LedgerError("not_found", "거래 $id 를 찾을 수 없어요") }
    val items = JSONArray()
    db.rawQuery(LedgerSql.ITEMS_FOR_TX, arrayOf(id)).use { while (it.moveToNext()) items.put(itemJson(it)) }
    if (items.length() > 0) o.put("items", items)
    return o
  }

  private fun balanceOf(db: SQLiteDatabase, accountId: String): Long =
    db.rawQuery(LedgerSql.BALANCE_ONE, arrayOf(accountId)).use { if (it.moveToFirst()) it.getLong(0) else 0L }

  private fun accountObj(name: String?, bal: Long) = JSONObject().put("name", name).put("balance_after", bal)

  private inline fun <T> writeTx(db: SQLiteDatabase, f: () -> T): T {
    db.beginTransactionNonExclusive() // BEGIN IMMEDIATE
    try {
      val r = f()
      db.setTransactionSuccessful()
      return r
    } finally {
      db.endTransaction()
    }
  }

  private fun ruleAccount(db: SQLiteDatabase, merchant: String?, memo: String?, categoryId: String?): String? {
    var catText = ""
    if (categoryId != null) {
      db.rawQuery(LedgerSql.CATEGORY_WITH_PARENT, arrayOf(categoryId)).use {
        if (it.moveToFirst()) catText = norm(catDisplay(it.str("name")!!, it.str("parent")))
      }
    }
    val fields = mapOf("merchant" to norm(merchant ?: ""), "memo" to norm(memo ?: ""), "category" to catText)
    var best: Triple<Int, String, String>? = null // (-키워드 길이, created_at, id)
    var bestAcc: String? = null
    db.rawQuery(LedgerSql.RULES, null).use { c ->
      while (c.moveToNext()) {
        if (c.lng("archived") != 0L) continue
        val kw = norm(c.str("keyword") ?: "")
        if (kw.isEmpty()) continue
        val match = c.str("match") ?: "any"
        val targets = if (match == "any") fields.values.toList() else listOf(fields[match] ?: "")
        if (targets.any { it.contains(kw) }) {
          val key = Triple(-kw.length, c.str("created_at") ?: "", c.str("id") ?: "")
          val cur = best
          val better = cur == null || key.first < cur.first ||
            (key.first == cur.first && (key.second < cur.second || (key.second == cur.second && key.third < cur.third)))
          if (better) { best = key; bestAcc = c.str("account_id") }
        }
      }
    }
    return bestAcc
  }

  // ---- 공개 API ---------------------------------------------------------------------------
  fun query(db: SQLiteDatabase, a: JSONObject): JSONObject {
    val to = if (a.has("to") && !a.isNull("to")) vDate(a.opt("to")) else today()
    val frm = if (a.has("from") && !a.isNull("from")) vDate(a.opt("from")) else LocalDate.parse(to).minusDays(DEFAULT_WINDOW_DAYS - 1).toString()
    if (frm > to) throw LedgerError("invalid", "from 이 to 보다 뒤예요")
    if (ChronoUnit.DAYS.between(LocalDate.parse(frm), LocalDate.parse(to)) + 1 > MAX_SPAN_DAYS) throw LedgerError("invalid", "한 번에 ${MAX_SPAN_DAYS}일까지만 조회할 수 있어요")
    var limit = DEFAULT_LIMIT
    if (a.has("limit")) {
      val l = a.opt("limit")
      if (l !is Number || l is Double || l is Float || l.toLong() < 1) throw LedgerError("invalid", "limit 은 1 이상의 정수여야 해요")
      limit = minOf(l.toLong(), MAX_LIMIT.toLong()).toInt()
    }
    val txs = ArrayList<JSONObject>()
    db.rawQuery(LedgerSql.txRange(limit + 1), arrayOf(frm, to)).use { while (it.moveToNext()) txs.add(txJson(it)) }
    val accounts = JSONArray()
    db.rawQuery(LedgerSql.BALANCES, null).use { c ->
      while (c.moveToNext()) accounts.put(JSONObject().put("id", c.str("id")).put("name", c.str("name")).put("kind", c.str("kind"))
        .put("balance", c.lng("balance")).put("is_default", c.lng("is_default") != 0L).put("archived", c.lng("archived") != 0L))
    }
    val cats = JSONArray()
    db.rawQuery(LedgerSql.CATEGORIES, null).use { c ->
      while (c.moveToNext()) if (c.lng("archived") == 0L) cats.put(JSONObject().put("id", c.str("id")).put("name", c.str("name"))
        .put("type", c.str("type")).put("parent", c.str("parent_name") ?: JSONObject.NULL))
    }
    val budgets = JSONArray()
    db.rawQuery(LedgerSql.BUDGETS, null).use { c ->
      while (c.moveToNext()) {
        val n = c.str("name")
        budgets.put(JSONObject().put("category", if (n != null) catDisplay(n, c.str("parent_name")) else JSONObject.NULL).put("amount", c.lng("amount")))
      }
    }
    val rules = JSONArray()
    db.rawQuery(LedgerSql.RULES, null).use { c ->
      while (c.moveToNext()) rules.put(JSONObject().put("id", c.str("id")).put("keyword", c.str("keyword")).put("match", c.str("match")).put("account", c.str("account")))
    }
    val out = JSONObject().put("v", 1).put("app", "flowledger").put("ts", System.currentTimeMillis()).put("from", frm).put("to", to)
      .put("accounts", accounts).put("categories", cats).put("budgets", budgets).put("rules", rules)
    val shown = JSONArray()
    val includeItems = a.opt("include_items") == true
    val byTx = HashMap<String, JSONArray>()
    if (includeItems) {
      db.rawQuery(LedgerSql.ITEMS_RANGE, arrayOf(frm, to)).use { c ->
        while (c.moveToNext()) byTx.getOrPut(c.str("tx_id")!!) { JSONArray() }.put(itemJson(c))
      }
    }
    txs.take(limit).forEach { t ->
      byTx[t.optString("id")]?.let { t.put("items", it) }
      shown.put(t)
    }
    return out.put("transactions", shown).put("truncated", txs.size > limit)
  }

  private fun dupResult(db: SQLiteDatabase, id: String): JSONObject {
    val tx = loadTx(db, id)
    val accountId = db.rawQuery(LedgerSql.TX_ROW, arrayOf(id)).use { it.moveToFirst(); it.str("account_id")!! }
    return JSONObject().put("ok", true).put("id", id).put("duplicate", true).put("transaction", tx)
      .put("account", accountObj(tx.optString("account"), balanceOf(db, accountId)))
  }

  fun add(db: SQLiteDatabase, a: JSONObject): JSONObject {
    val reqId = a.opt("req_id")
    if (reqId !is String || !REQ_ID_RE.matches(reqId)) throw LedgerError("invalid", "req_id 가 필요해요 (영문·숫자·_.:- 64자 이하)")
    val t = a.opt("type") as? String
    if (t == null || t !in TYPES) throw LedgerError("invalid", "type 은 expense, income, transfer 중 하나여야 해요")
    val hasItems = ((a.opt("items") as? JSONArray)?.length() ?: 0) > 0
    val amountIn: Long? = if ((!a.has("amount") || a.isNull("amount")) && hasItems) null else vAmount(a.opt("amount"))
    val d = if (a.has("date") && !a.isNull("date")) vDate(a.opt("date")) else today()
    val tm = vTime(a.opt("time"))
    val merchant = vText(a.opt("merchant"), "merchant", 100)
    val memo = vText(a.opt("memo"), "memo", 500)
    val tags = vTags(a.opt("tags"))
    if (t == "transfer" && !blank(a, "category")) throw LedgerError("invalid", "이체에는 카테고리를 쓸 수 없어요")
    if (t != "transfer" && !blank(a, "to_account")) throw LedgerError("invalid", "to_account 는 이체에서만 쓸 수 있어요")
    return writeTx(db) {
      db.rawQuery(LedgerSql.TX_BY_REF, arrayOf(reqId)).use { if (it.moveToFirst()) return@writeTx dupResult(db, it.str("id")!!) }
      var cat: String? = null
      if (t != "transfer") {
        if (!blank(a, "category")) {
          cat = resolveCategory(db, refString(a, "category"), t)
        } else {
          cat = if (t == "expense") "cat_misc" else "cat_inc_misc"
          if (!first(db, LedgerSql.CATEGORY_EXISTS, cat)) throw LedgerError("invalid", "기본 카테고리(기타)가 없어요. category 를 지정해 주세요")
        }
      }
      val items = vItems(db, a.opt("items"), t)
      val amount: Long = amountIn ?: vAmount(items.sumOf { it.amount })
      checkItemsSum(items, amount)
      var accountSource = "explicit"
      val acc: String
      if (!blank(a, "account")) {
        acc = resolveAccount(db, refString(a, "account"), true)
      } else {
        val byRule = if (t != "transfer") ruleAccount(db, merchant, memo, cat) else null
        if (byRule != null) {
          accountSource = "rule"; acc = byRule
        } else {
          accountSource = "default"
          acc = db.rawQuery(LedgerSql.DEFAULT_ACCOUNT, null).use {
            if (it.moveToFirst()) it.str("id")!! else throw LedgerError("invalid", "기본 통장이 없어요. 앱에서 기본 통장을 지정하거나 통장 이름을 말해 주세요")
          }
        }
      }
      var toAcc: String? = null
      if (t == "transfer") {
        if (blank(a, "to_account")) throw LedgerError("invalid", "이체에는 to_account(입금 통장)가 필요해요")
        toAcc = resolveAccount(db, refString(a, "to_account"), true)
        if (toAcc == acc) throw LedgerError("invalid", "출금 통장과 입금 통장이 같아요")
      }
      val txId = "tx_" + UUID.randomUUID().toString().replace("-", "").substring(0, 16)
      val ts = nowIso()
      try {
        db.execSQL(LedgerSql.INSERT, arrayOf<Any?>(txId, t, amount, d, tm, acc, toAcc, cat, merchant, memo, tags, reqId, ts, ts))
      } catch (e: SQLiteConstraintException) {
        // 동시에 같은 req_id 가 먼저 들어간 경우(UNIQUE) → 기존 결과를 돌려준다
        db.rawQuery(LedgerSql.TX_BY_REF, arrayOf(reqId)).use { if (it.moveToFirst()) return@writeTx dupResult(db, it.str("id")!!) }
        throw LedgerError("db_error", e.message ?: "저장 실패")
      }
      insertItems(db, txId, items)
      val tx = loadTx(db, txId)
      JSONObject().put("ok", true).put("id", txId).put("duplicate", false).put("transaction", tx)
        .put("account", accountObj(tx.optString("account"), balanceOf(db, acc))).put("account_source", accountSource)
    }
  }

  fun update(db: SQLiteDatabase, a: JSONObject): JSONObject {
    val id = a.opt("id") as? String
    if (id.isNullOrEmpty()) throw LedgerError("invalid", "id 가 필요해요")
    return writeTx(db) {
      val cur = db.rawQuery(LedgerSql.TX_ROW, arrayOf(id)).use {
        if (!it.moveToFirst()) throw LedgerError("not_found", "거래 $id 를 찾을 수 없어요")
        mapOf("type" to it.str("type"), "amount" to it.lng("amount"), "date" to it.str("date"), "time" to it.str("time"),
          "account_id" to it.str("account_id"), "to_account_id" to it.str("to_account_id"), "category_id" to it.str("category_id"),
          "merchant" to it.str("merchant"), "memo" to it.str("memo"), "tags" to it.str("tags"))
      }
      if (a.has("type") && a.opt("type") != cur["type"]) throw LedgerError("invalid", "거래 유형(type)은 바꿀 수 없어요. 삭제 후 다시 기록해 주세요")
      val t = cur["type"] as String
      val amount = if (a.has("amount")) vAmount(a.opt("amount")) else cur["amount"] as Long
      val d = if (a.has("date")) vDate(a.opt("date")) else cur["date"] as String
      val tm = if (a.has("time")) vTime(a.opt("time")) else cur["time"] as String?
      val merchant = if (a.has("merchant")) vText(a.opt("merchant"), "merchant", 100) else cur["merchant"] as String?
      val memo = if (a.has("memo")) vText(a.opt("memo"), "memo", 500) else cur["memo"] as String?
      val tags = if (a.has("tags")) vTags(a.opt("tags")) else cur["tags"] as String?
      val acc = if (!blank(a, "account")) resolveAccount(db, refString(a, "account"), true) else cur["account_id"] as String
      var toAcc = cur["to_account_id"] as String?
      var cat = cur["category_id"] as String?
      if (t == "transfer") {
        if (!blank(a, "category")) throw LedgerError("invalid", "이체에는 카테고리를 쓸 수 없어요")
        if (!blank(a, "to_account")) toAcc = resolveAccount(db, refString(a, "to_account"), true)
        if (toAcc == acc) throw LedgerError("invalid", "출금 통장과 입금 통장이 같아요")
      } else {
        if (!blank(a, "to_account")) throw LedgerError("invalid", "to_account 는 이체에서만 쓸 수 있어요")
        if (!blank(a, "category")) cat = resolveCategory(db, refString(a, "category"), t)
      }
      if (a.has("items")) {
        val items = vItems(db, a.opt("items"), t) // 전체 교체, [] 면 품목 삭제
        checkItemsSum(items, amount)
        db.execSQL(LedgerSql.ITEMS_DELETE, arrayOf<Any?>(id))
        insertItems(db, id, items)
      } else if (a.has("amount")) {
        val (total, n) = db.rawQuery(LedgerSql.ITEMS_SUM, arrayOf(id)).use {
          it.moveToFirst(); Pair(it.getLong(it.getColumnIndexOrThrow("total")), it.getInt(it.getColumnIndexOrThrow("n")))
        }
        if (n > 0 && total != amount) throw LedgerError("invalid", "품목 합계 ${"%,d".format(java.util.Locale.US, total)}원 ≠ 총액 ${"%,d".format(java.util.Locale.US, amount)}원 — 총액을 바꾸려면 items 도 함께 보내 주세요")
      }
      db.execSQL(LedgerSql.UPDATE, arrayOf<Any?>(amount, d, tm, acc, toAcc, cat, merchant, memo, tags, nowIso(), id))
      val tx = loadTx(db, id)
      JSONObject().put("ok", true).put("transaction", tx).put("account", accountObj(tx.optString("account"), balanceOf(db, acc)))
    }
  }

  fun delete(db: SQLiteDatabase, a: JSONObject): JSONObject {
    val id = a.opt("id") as? String
    if (id.isNullOrEmpty()) throw LedgerError("invalid", "id 가 필요해요")
    return writeTx(db) {
      val accountId = db.rawQuery(LedgerSql.TX_ROW, arrayOf(id)).use {
        if (!it.moveToFirst()) throw LedgerError("not_found", "거래 $id 를 찾을 수 없어요")
        it.str("account_id")!!
      }
      db.execSQL(LedgerSql.ITEMS_DELETE, arrayOf<Any?>(id)) // foreign_keys 에 의존하지 않고 명시적으로 지운다
      db.execSQL(LedgerSql.DELETE, arrayOf<Any?>(id))
      val name = db.rawQuery(LedgerSql.ACCOUNT_NAME, arrayOf(accountId)).use { if (it.moveToFirst()) it.getString(0) else null }
      JSONObject().put("ok", true).put("deleted", true).put("account", accountObj(name, balanceOf(db, accountId)))
    }
  }

  fun addRule(db: SQLiteDatabase, a: JSONObject): JSONObject {
    val kw = vText(a.opt("keyword"), "keyword", 40) ?: throw LedgerError("invalid", "keyword 가 필요해요")
    val match = if (blank(a, "match")) "any" else a.opt("match") as? String ?: ""
    if (match !in RULE_MATCHES) throw LedgerError("invalid", "match 는 merchant, category, memo, any 중 하나여야 해요")
    if (blank(a, "account")) throw LedgerError("invalid", "account(통장 이름)가 필요해요")
    return writeTx(db) {
      val acc = resolveAccount(db, refString(a, "account"), true)
      var existing: String? = null
      db.rawQuery(LedgerSql.RULES, null).use { c ->
        while (c.moveToNext()) if (norm(c.str("keyword") ?: "") == norm(kw) && c.str("match") == match) { existing = c.str("id"); break }
      }
      if (existing != null) {
        db.execSQL(LedgerSql.RULE_UPDATE_ACCOUNT, arrayOf<Any?>(acc, existing))
        return@writeTx JSONObject().put("ok", true).put("id", existing).put("updated", true)
      }
      val count = db.rawQuery(LedgerSql.RULE_COUNT, null).use { it.moveToFirst(); it.getInt(0) }
      if (count >= MAX_RULES) throw LedgerError("invalid", "규칙은 ${MAX_RULES}개까지예요")
      val rid = "rule_" + UUID.randomUUID().toString().replace("-", "").substring(0, 12)
      db.execSQL(LedgerSql.RULE_INSERT, arrayOf<Any?>(rid, kw, match, acc, nowIso()))
      JSONObject().put("ok", true).put("id", rid).put("updated", false)
    }
  }

  fun deleteRule(db: SQLiteDatabase, a: JSONObject): JSONObject {
    val id = a.opt("id") as? String
    if (id.isNullOrEmpty()) throw LedgerError("invalid", "id 가 필요해요")
    return writeTx(db) {
      if (!first(db, LedgerSql.RULE_EXISTS, id)) throw LedgerError("not_found", "규칙 $id 를 찾을 수 없어요")
      db.execSQL(LedgerSql.RULE_DELETE, arrayOf<Any?>(id))
      JSONObject().put("ok", true)
    }
  }

  fun items(db: SQLiteDatabase, a: JSONObject): JSONObject {
    val to = if (a.has("to") && !a.isNull("to")) vDate(a.opt("to")) else today()
    val frm = if (a.has("from") && !a.isNull("from")) vDate(a.opt("from")) else LocalDate.parse(to).minusDays(DEFAULT_WINDOW_DAYS - 1).toString()
    if (frm > to) throw LedgerError("invalid", "from 이 to 보다 뒤예요")
    if (ChronoUnit.DAYS.between(LocalDate.parse(frm), LocalDate.parse(to)) + 1 > MAX_SPAN_DAYS) throw LedgerError("invalid", "한 번에 ${MAX_SPAN_DAYS}일까지만 조회할 수 있어요")
    var limit = ITEMS_DEFAULT_LIMIT
    if (a.has("limit")) {
      val l = a.opt("limit")
      if (l !is Number || l is Double || l is Float || l.toLong() < 1) throw LedgerError("invalid", "limit 은 1 이상의 정수여야 해요")
      limit = minOf(l.toLong(), ITEMS_MAX_LIMIT.toLong()).toInt()
    }
    val text = vText(a.opt("text"), "text", 80)
    val merchant = vText(a.opt("merchant"), "merchant", 100)
    val nt = text?.let { norm(it) }
    val nm = merchant?.let { norm(it) }
    val out = JSONArray()
    var truncated = false
    db.rawQuery(LedgerSql.ITEMS_RANGE, arrayOf(frm, to)).use { c ->
      while (c.moveToNext()) {
        if (nt != null && !norm(c.str("name") ?: "").contains(nt)) continue
        if (nm != null && !norm(c.str("merchant") ?: "").contains(nm)) continue
        if (out.length() >= limit) { truncated = true; break }
        val o = JSONObject().put("tx_id", c.str("tx_id")).put("date", c.str("date")).put("account", c.str("account")).put("name", c.str("name"))
        putQty(o, c.getDouble(c.getColumnIndexOrThrow("qty")))
        o.put("amount", c.lng("amount"))
        c.str("merchant")?.takeIf { it.isNotEmpty() }?.let { o.put("merchant", it) }
        val ui = c.getColumnIndexOrThrow("unit_price")
        if (!c.isNull(ui)) o.put("unit_price", c.getLong(ui))
        c.str("category")?.takeIf { it.isNotEmpty() }?.let { o.put("category", catDisplay(it, c.str("category_parent"))) }
        out.put(o)
      }
    }
    return JSONObject().put("v", 1).put("ts", System.currentTimeMillis()).put("from", frm).put("to", to)
      .put("count", out.length()).put("truncated", truncated).put("items", out)
  }
}
