"""
제공자(Kotlin) 로직의 Python 참조 구현. docs/provider-sql.md 의 SQL 과 규칙을 그대로 옮겼다.
Kotlin 쪽(LedgerApi.kt)은 이 파일을 한 줄씩 옮긴 것이므로, 규칙을 바꿀 때는 여기와 문서를 먼저 고친다.
"""
import json
import re
import sqlite3
import uuid
from datetime import date as _date, datetime, timedelta, timezone

MAX_AMOUNT = 9_999_999_999
DATE_MIN, DATE_MAX = "2000-01-01", "2100-12-31"
MAX_SPAN_DAYS = 400
DEFAULT_WINDOW_DAYS = 90
DEFAULT_LIMIT, MAX_LIMIT = 1500, 3000
REQ_ID_RE = re.compile(r"^[A-Za-z0-9_.:\-]{1,64}$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
TYPES = ("expense", "income", "transfer")
RULE_MATCHES = ("merchant", "category", "memo", "any")
MAX_RULES = 200


class LedgerError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code, self.message = code, message


# ---- SQL (docs/provider-sql.md 와 동일) -------------------------------------------------
SQL_BALANCES = """
SELECT a.id AS id, a.name AS name, a.kind AS kind, a.is_default AS is_default, a.archived AS archived,
  a.initial_balance
  + COALESCE((SELECT SUM(amount) FROM transactions WHERE type='income' AND account_id=a.id),0)
  - COALESCE((SELECT SUM(amount) FROM transactions WHERE type='expense' AND account_id=a.id),0)
  - COALESCE((SELECT SUM(amount) FROM transactions WHERE type='transfer' AND account_id=a.id),0)
  + COALESCE((SELECT SUM(amount) FROM transactions WHERE type='transfer' AND to_account_id=a.id),0) AS balance
FROM accounts a ORDER BY a.sort, a.created_at, a.name"""
SQL_ACCOUNTS = "SELECT id, name, is_default, archived FROM accounts ORDER BY sort, created_at, name"
SQL_CATEGORIES = """
SELECT c.id AS id, c.name AS name, c.type AS type, c.parent_id AS parent_id, p.name AS parent_name, c.archived AS archived
FROM categories c LEFT JOIN categories p ON p.id = c.parent_id ORDER BY c.sort, c.name"""
SQL_BUDGETS = """
SELECT b.amount AS amount, c.name AS name, p.name AS parent_name
FROM budgets b LEFT JOIN categories c ON c.id = b.category_id LEFT JOIN categories p ON p.id = c.parent_id"""
SQL_TX_SELECT = """
SELECT t.id, t.type, t.amount, t.date, t.time, a.name AS account, ta.name AS to_account,
  c.name AS category, p.name AS category_parent, t.merchant, t.memo, t.tags, t.source
FROM transactions t
JOIN accounts a ON a.id = t.account_id
LEFT JOIN accounts ta ON ta.id = t.to_account_id
LEFT JOIN categories c ON c.id = t.category_id
LEFT JOIN categories p ON p.id = c.parent_id"""
SQL_TX_RANGE = SQL_TX_SELECT + """
WHERE t.date >= ? AND t.date <= ?
ORDER BY t.date DESC, COALESCE(t.time,'') DESC, t.created_at DESC LIMIT ?"""
SQL_TX_BY_ID = SQL_TX_SELECT + " WHERE t.id = ?"
SQL_TX_BY_REF = "SELECT id FROM transactions WHERE source_ref = ?"
SQL_TX_ROW = "SELECT * FROM transactions WHERE id = ?"
SQL_INSERT = """INSERT INTO transactions(id,type,amount,date,time,account_id,to_account_id,category_id,merchant,memo,tags,source,source_ref,created_at,updated_at)
VALUES(?,?,?,?,?,?,?,?,?,?,?,'assistant',?,?,?)"""
SQL_UPDATE = """UPDATE transactions SET amount=?, date=?, time=?, account_id=?, to_account_id=?, category_id=?, merchant=?, memo=?, tags=?, updated_at=? WHERE id=?"""
SQL_DELETE = "DELETE FROM transactions WHERE id = ?"
SQL_RULES = """
SELECT r.id AS id, r.keyword AS keyword, r.match AS match, r.account_id AS account_id, a.name AS account, a.archived AS archived, r.created_at AS created_at
FROM account_rules r JOIN accounts a ON a.id = r.account_id ORDER BY r.created_at, r.id"""
SQL_RULE_INSERT = "INSERT INTO account_rules(id,keyword,match,account_id,created_at) VALUES(?,?,?,?,?)"
SQL_RULE_UPDATE_ACCOUNT = "UPDATE account_rules SET account_id=? WHERE id=?"
SQL_RULE_DELETE = "DELETE FROM account_rules WHERE id=?"
SQL_RULE_COUNT = "SELECT COUNT(*) FROM account_rules"
SQL_BALANCE_ONE = "SELECT balance FROM (" + SQL_BALANCES + ") WHERE id = ?"


def now_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + f"{datetime.now(timezone.utc).microsecond // 1000:03d}Z"


# ---- 이름 매칭 ----------------------------------------------------------------------------
def norm(s):
    return "".join(str(s).split()).lower()


def cat_display(name, parent_name):
    return f"{parent_name}>{name}" if parent_name else name


def resolve_account(db, ref, *, for_write):
    rows = db.execute(SQL_ACCOUNTS).fetchall()
    if for_write:
        pool = [r for r in rows if not r["archived"]]
    else:
        pool = list(rows)
    ref_s = str(ref).strip()
    for r in rows:
        if r["id"] == ref_s:
            if for_write and r["archived"]:
                raise LedgerError("invalid", f"'{r['name']}' 통장은 보관(숨김) 상태라 기록할 수 없어요")
            return r["id"]
    n = norm(ref_s)
    if not n:
        raise LedgerError("invalid", "통장 이름이 비어 있어요")
    exact = [r for r in pool if norm(r["name"]) == n]
    if len(exact) == 1:
        return exact[0]["id"]
    if len(exact) > 1:
        raise LedgerError("ambiguous", "통장이 여러 개예요: " + ", ".join(r["name"] for r in exact))
    part = [r for r in pool if n in norm(r["name"])]
    if len(part) == 1:
        return part[0]["id"]
    if len(part) > 1:
        raise LedgerError("ambiguous", f"'{ref_s}' 와 맞는 통장이 여러 개예요: " + ", ".join(r["name"] for r in part))
    archived = [r for r in rows if r["archived"] and n in norm(r["name"])]
    if for_write and archived:
        raise LedgerError("invalid", f"'{archived[0]['name']}' 통장은 보관(숨김) 상태라 기록할 수 없어요")
    raise LedgerError("not_found", f"'{ref_s}' 통장을 찾을 수 없어요. 있는 통장: " + ", ".join(r["name"] for r in pool))


def resolve_category(db, ref, tx_type):
    rows = [r for r in db.execute(SQL_CATEGORIES).fetchall() if r["type"] == tx_type and not r["archived"]]
    ref_s = str(ref).strip()
    for r in rows:
        if r["id"] == ref_s:
            return r["id"]
    if not norm(ref_s):
        raise LedgerError("invalid", "카테고리 이름이 비어 있어요")
    if ">" in ref_s:
        head, _, tail = ref_s.partition(">")
        hn, tn = norm(head), norm(tail)
        exact = [r for r in rows if r["parent_name"] is not None and norm(r["parent_name"]) == hn and norm(r["name"]) == tn]
        pool = exact or [r for r in rows if r["parent_name"] is not None and hn in norm(r["parent_name"]) and tn in norm(r["name"])]
    else:
        n = norm(ref_s)
        pool = [r for r in rows if norm(r["name"]) == n] or [r for r in rows if n in norm(r["name"])]
    if len(pool) == 1:
        return pool[0]["id"]
    if len(pool) > 1:
        raise LedgerError("ambiguous", f"'{ref_s}' 와 맞는 카테고리가 여러 개예요: " + ", ".join(cat_display(r["name"], r["parent_name"]) for r in pool))
    raise LedgerError("not_found", f"'{ref_s}' 카테고리를 찾을 수 없어요 ({'지출' if tx_type == 'expense' else '수입'}). 예: " +
                      ", ".join(cat_display(r["name"], r["parent_name"]) for r in rows[:12]))


# ---- 입력 검증 ----------------------------------------------------------------------------
def v_amount(v):
    if isinstance(v, bool) or not isinstance(v, (int, float)) or (isinstance(v, float) and not v.is_integer()):
        raise LedgerError("invalid", "amount 는 정수(원)여야 해요")
    v = int(v)
    if v < 1 or v > MAX_AMOUNT:
        raise LedgerError("invalid", f"amount 는 1 ~ {MAX_AMOUNT:,} 사이여야 해요")
    return v


def v_date(v):
    if not isinstance(v, str) or not DATE_RE.match(v):
        raise LedgerError("invalid", "date 는 YYYY-MM-DD 형식이어야 해요")
    try:
        _date.fromisoformat(v)
    except ValueError:
        raise LedgerError("invalid", "존재하지 않는 날짜예요")
    if v < DATE_MIN or v > DATE_MAX:
        raise LedgerError("invalid", f"date 는 {DATE_MIN} ~ {DATE_MAX} 사이여야 해요")
    return v


def v_time(v):
    if v is None or v == "":
        return None
    if not isinstance(v, str) or not TIME_RE.match(v):
        raise LedgerError("invalid", "time 은 HH:MM 형식이어야 해요")
    return v


def v_text(v, name, cap):
    if v is None:
        return None
    if not isinstance(v, str):
        raise LedgerError("invalid", f"{name} 는 문자열이어야 해요")
    s = v.strip()
    if len(s) > cap:
        raise LedgerError("invalid", f"{name} 는 {cap}자 이하여야 해요")
    return s or None


def v_tags(v):
    if v is None:
        return None
    if isinstance(v, list):
        parts = [x for x in v if isinstance(x, str)]
    elif isinstance(v, str):
        parts = re.split(r"[,\n]", v)
    else:
        raise LedgerError("invalid", "tags 는 문자열이어야 해요")
    out = []
    for p in parts:
        t = p.strip().lstrip("#").strip()
        if not t:
            continue
        if len(t) > 20:
            raise LedgerError("invalid", "태그는 20자 이하여야 해요")
        if t not in out:
            out.append(t)
    if len(out) > 10:
        raise LedgerError("invalid", "태그는 10개까지예요")
    return ",".join(out) or None


def today():
    return _date.today().isoformat()


# ---- 응답 모양 ----------------------------------------------------------------------------
def tx_json(r):
    o = {"id": r["id"], "type": r["type"], "amount": r["amount"], "date": r["date"], "account": r["account"], "source": r["source"]}
    if r["time"]:
        o["time"] = r["time"]
    if r["to_account"]:
        o["to_account"] = r["to_account"]
    if r["category"]:
        o["category"] = cat_display(r["category"], r["category_parent"])
    for k in ("merchant", "memo", "tags"):
        if r[k]:
            o[k] = r[k]
    return o


def load_tx(db, tx_id):
    r = db.execute(SQL_TX_BY_ID, (tx_id,)).fetchone()
    if not r:
        raise LedgerError("not_found", f"거래 {tx_id} 를 찾을 수 없어요")
    return tx_json(r)


def balance_of(db, account_id):
    return db.execute(SQL_BALANCE_ONE, (account_id,)).fetchone()[0]


def rule_account(db, merchant, memo, category_id):
    """명시 통장이 없을 때 규칙으로 통장 결정. 키워드가 긴 규칙 우선, 같으면 먼저 만든 규칙. 보관 통장을 가리키는 규칙은 건너뜀."""
    cat_text = ""
    if category_id:
        r = db.execute("SELECT c.name AS name, p.name AS parent FROM categories c LEFT JOIN categories p ON p.id=c.parent_id WHERE c.id=?", (category_id,)).fetchone()
        if r:
            cat_text = norm(cat_display(r["name"], r["parent"]))
    fields = {"merchant": norm(merchant or ""), "memo": norm(memo or ""), "category": cat_text}
    best = None
    for r in db.execute(SQL_RULES).fetchall():
        if r["archived"]:
            continue
        kw = norm(r["keyword"])
        if not kw:
            continue
        targets = list(fields.values()) if r["match"] == "any" else [fields[r["match"]]]
        if any(kw in t for t in targets):
            key = (-len(kw), r["created_at"], r["id"])
            if best is None or key < best[0]:
                best = (key, r["account_id"])
    return best[1] if best else None


# ---- 공개 API -----------------------------------------------------------------------------
def query(db, arg=None, now_ms=0):
    a = arg or {}
    to = v_date(a["to"]) if a.get("to") is not None else today()
    frm = v_date(a["from"]) if a.get("from") is not None else (_date.fromisoformat(to) - timedelta(days=DEFAULT_WINDOW_DAYS - 1)).isoformat()
    if frm > to:
        raise LedgerError("invalid", "from 이 to 보다 뒤예요")
    if (_date.fromisoformat(to) - _date.fromisoformat(frm)).days + 1 > MAX_SPAN_DAYS:
        raise LedgerError("invalid", f"한 번에 {MAX_SPAN_DAYS}일까지만 조회할 수 있어요")
    limit = a.get("limit", DEFAULT_LIMIT)
    if isinstance(limit, bool) or not isinstance(limit, int) or limit < 1:
        raise LedgerError("invalid", "limit 은 1 이상의 정수여야 해요")
    limit = min(limit, MAX_LIMIT)
    rows = db.execute(SQL_TX_RANGE, (frm, to, limit + 1)).fetchall()
    accounts = [{"id": r["id"], "name": r["name"], "kind": r["kind"], "balance": r["balance"], "is_default": bool(r["is_default"]), "archived": bool(r["archived"])}
                for r in db.execute(SQL_BALANCES).fetchall()]
    cats = [{"id": r["id"], "name": r["name"], "type": r["type"], "parent": r["parent_name"]}
            for r in db.execute(SQL_CATEGORIES).fetchall() if not r["archived"]]
    budgets = [{"category": cat_display(r["name"], r["parent_name"]) if r["name"] else None, "amount": r["amount"]} for r in db.execute(SQL_BUDGETS).fetchall()]
    rules = [{"id": r["id"], "keyword": r["keyword"], "match": r["match"], "account": r["account"]} for r in db.execute(SQL_RULES).fetchall()]
    return {"v": 1, "app": "flowledger", "ts": now_ms, "from": frm, "to": to, "accounts": accounts, "categories": cats, "budgets": budgets, "rules": rules,
            "transactions": [tx_json(r) for r in rows[:limit]], "truncated": len(rows) > limit}


def add(db, arg, now=None):
    if not isinstance(arg, dict):
        raise LedgerError("invalid", "요청 형식이 올바르지 않아요")
    req_id = arg.get("req_id")
    if not isinstance(req_id, str) or not REQ_ID_RE.match(req_id):
        raise LedgerError("invalid", "req_id 가 필요해요 (영문·숫자·_.:- 64자 이하)")
    t = arg.get("type")
    if t not in TYPES:
        raise LedgerError("invalid", "type 은 expense, income, transfer 중 하나여야 해요")
    amount = v_amount(arg.get("amount"))
    d = v_date(arg["date"]) if arg.get("date") is not None else today()
    tm = v_time(arg.get("time"))
    merchant, memo, tags = v_text(arg.get("merchant"), "merchant", 100), v_text(arg.get("memo"), "memo", 500), v_tags(arg.get("tags"))
    if t == "transfer" and arg.get("category") not in (None, ""):
        raise LedgerError("invalid", "이체에는 카테고리를 쓸 수 없어요")
    if t != "transfer" and arg.get("to_account") not in (None, ""):
        raise LedgerError("invalid", "to_account 는 이체에서만 쓸 수 있어요")
    db.execute("BEGIN IMMEDIATE")
    try:
        dup = db.execute(SQL_TX_BY_REF, (req_id,)).fetchone()
        if dup:
            tx = load_tx(db, dup["id"])
            row = db.execute(SQL_TX_ROW, (dup["id"],)).fetchone()
            db.execute("COMMIT")
            return {"ok": True, "id": dup["id"], "duplicate": True, "transaction": tx,
                    "account": {"name": tx["account"], "balance_after": balance_of(db, row["account_id"])}}
        cat = None
        if t != "transfer":
            if arg.get("category") not in (None, ""):
                cat = resolve_category(db, arg["category"], t)
            else:
                cat = "cat_misc" if t == "expense" else "cat_inc_misc"
                if not db.execute("SELECT 1 FROM categories WHERE id=?", (cat,)).fetchone():
                    raise LedgerError("invalid", "기본 카테고리(기타)가 없어요. category 를 지정해 주세요")
        account_source = "explicit"
        if arg.get("account") not in (None, ""):
            acc = resolve_account(db, arg["account"], for_write=True)
        else:
            acc = rule_account(db, merchant, memo, cat) if t != "transfer" else None
            account_source = "rule"
            if acc is None:
                account_source = "default"
                r = db.execute("SELECT id FROM accounts WHERE is_default=1 AND archived=0 ORDER BY sort, created_at LIMIT 1").fetchone()
                if not r:
                    raise LedgerError("invalid", "기본 통장이 없어요. 앱에서 기본 통장을 지정하거나 통장 이름을 말해 주세요")
                acc = r["id"]
        to_acc = None
        if t == "transfer":
            if arg.get("to_account") in (None, ""):
                raise LedgerError("invalid", "이체에는 to_account(입금 통장)가 필요해요")
            to_acc = resolve_account(db, arg["to_account"], for_write=True)
            if to_acc == acc:
                raise LedgerError("invalid", "출금 통장과 입금 통장이 같아요")
        tx_id = "tx_" + uuid.uuid4().hex[:16]
        ts = now or now_iso()
        try:
            db.execute(SQL_INSERT, (tx_id, t, amount, d, tm, acc, to_acc, cat, merchant, memo, tags, req_id, ts, ts))
        except sqlite3.IntegrityError:
            # 동시에 같은 req_id 가 먼저 들어간 경우 (UNIQUE) → 기존 결과를 돌려준다
            dup = db.execute(SQL_TX_BY_REF, (req_id,)).fetchone()
            if not dup:
                raise
            tx = load_tx(db, dup["id"])
            row = db.execute(SQL_TX_ROW, (dup["id"],)).fetchone()
            db.execute("COMMIT")
            return {"ok": True, "id": dup["id"], "duplicate": True, "transaction": tx,
                    "account": {"name": tx["account"], "balance_after": balance_of(db, row["account_id"])}}
        tx = load_tx(db, tx_id)
        bal = balance_of(db, acc)
        db.execute("COMMIT")
        return {"ok": True, "id": tx_id, "duplicate": False, "transaction": tx, "account": {"name": tx["account"], "balance_after": bal}, "account_source": account_source}
    except BaseException:
        if db.in_transaction:
            db.execute("ROLLBACK")
        raise


def update(db, arg, now=None):
    if not isinstance(arg, dict) or not isinstance(arg.get("id"), str) or not arg["id"]:
        raise LedgerError("invalid", "id 가 필요해요")
    db.execute("BEGIN IMMEDIATE")
    try:
        cur = db.execute(SQL_TX_ROW, (arg["id"],)).fetchone()
        if not cur:
            raise LedgerError("not_found", f"거래 {arg['id']} 를 찾을 수 없어요")
        if "type" in arg and arg["type"] != cur["type"]:
            raise LedgerError("invalid", "거래 유형(type)은 바꿀 수 없어요. 삭제 후 다시 기록해 주세요")
        t = cur["type"]
        amount = v_amount(arg["amount"]) if "amount" in arg else cur["amount"]
        d = v_date(arg["date"]) if "date" in arg else cur["date"]
        tm = v_time(arg["time"]) if "time" in arg else cur["time"]
        merchant = v_text(arg["merchant"], "merchant", 100) if "merchant" in arg else cur["merchant"]
        memo = v_text(arg["memo"], "memo", 500) if "memo" in arg else cur["memo"]
        tags = v_tags(arg["tags"]) if "tags" in arg else cur["tags"]
        acc = resolve_account(db, arg["account"], for_write=True) if arg.get("account") not in (None, "") else cur["account_id"]
        to_acc, cat = cur["to_account_id"], cur["category_id"]
        if t == "transfer":
            if arg.get("category") not in (None, ""):
                raise LedgerError("invalid", "이체에는 카테고리를 쓸 수 없어요")
            if arg.get("to_account") not in (None, ""):
                to_acc = resolve_account(db, arg["to_account"], for_write=True)
            if to_acc == acc:
                raise LedgerError("invalid", "출금 통장과 입금 통장이 같아요")
        else:
            if arg.get("to_account") not in (None, ""):
                raise LedgerError("invalid", "to_account 는 이체에서만 쓸 수 있어요")
            if arg.get("category") not in (None, ""):
                cat = resolve_category(db, arg["category"], t)
        db.execute(SQL_UPDATE, (amount, d, tm, acc, to_acc, cat, merchant, memo, tags, now or now_iso(), arg["id"]))
        tx = load_tx(db, arg["id"])
        bal = balance_of(db, acc)
        db.execute("COMMIT")
        return {"ok": True, "transaction": tx, "account": {"name": tx["account"], "balance_after": bal}}
    except BaseException:
        if db.in_transaction:
            db.execute("ROLLBACK")
        raise


def delete(db, arg):
    if not isinstance(arg, dict) or not isinstance(arg.get("id"), str) or not arg["id"]:
        raise LedgerError("invalid", "id 가 필요해요")
    db.execute("BEGIN IMMEDIATE")
    try:
        row = db.execute(SQL_TX_ROW, (arg["id"],)).fetchone()
        if not row:
            raise LedgerError("not_found", f"거래 {arg['id']} 를 찾을 수 없어요")
        db.execute(SQL_DELETE, (arg["id"],))
        bal = balance_of(db, row["account_id"])
        name = db.execute("SELECT name FROM accounts WHERE id=?", (row["account_id"],)).fetchone()[0]
        db.execute("COMMIT")
        return {"ok": True, "deleted": True, "account": {"name": name, "balance_after": bal}}
    except BaseException:
        if db.in_transaction:
            db.execute("ROLLBACK")
        raise


def connect(path=":memory:"):
    db = sqlite3.connect(path, isolation_level=None)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")
    db.execute("PRAGMA busy_timeout=3000")
    return db


def add_rule(db, arg, now=None):
    if not isinstance(arg, dict):
        raise LedgerError("invalid", "요청 형식이 올바르지 않아요")
    kw = v_text(arg.get("keyword"), "keyword", 40)
    if not kw:
        raise LedgerError("invalid", "keyword 가 필요해요")
    match = arg.get("match", "any") or "any"
    if match not in RULE_MATCHES:
        raise LedgerError("invalid", "match 는 merchant, category, memo, any 중 하나여야 해요")
    if arg.get("account") in (None, ""):
        raise LedgerError("invalid", "account(통장 이름)가 필요해요")
    db.execute("BEGIN IMMEDIATE")
    try:
        acc = resolve_account(db, arg["account"], for_write=True)
        for r in db.execute(SQL_RULES).fetchall():
            if norm(r["keyword"]) == norm(kw) and r["match"] == match:
                db.execute(SQL_RULE_UPDATE_ACCOUNT, (acc, r["id"]))
                db.execute("COMMIT")
                return {"ok": True, "id": r["id"], "updated": True}
        if db.execute(SQL_RULE_COUNT).fetchone()[0] >= MAX_RULES:
            raise LedgerError("invalid", f"규칙은 {MAX_RULES}개까지예요")
        rid = "rule_" + uuid.uuid4().hex[:12]
        db.execute(SQL_RULE_INSERT, (rid, kw, match, acc, now or now_iso()))
        db.execute("COMMIT")
        return {"ok": True, "id": rid, "updated": False}
    except BaseException:
        if db.in_transaction:
            db.execute("ROLLBACK")
        raise


def delete_rule(db, arg):
    if not isinstance(arg, dict) or not isinstance(arg.get("id"), str) or not arg["id"]:
        raise LedgerError("invalid", "id 가 필요해요")
    db.execute("BEGIN IMMEDIATE")
    try:
        if not db.execute("SELECT 1 FROM account_rules WHERE id=?", (arg["id"],)).fetchone():
            raise LedgerError("not_found", f"규칙 {arg['id']} 를 찾을 수 없어요")
        db.execute(SQL_RULE_DELETE, (arg["id"],))
        db.execute("COMMIT")
        return {"ok": True}
    except BaseException:
        if db.in_transaction:
            db.execute("ROLLBACK")
        raise
