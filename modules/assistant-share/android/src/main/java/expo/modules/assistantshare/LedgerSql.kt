package expo.modules.assistantshare

/** docs/provider-sql.md 와 tests/provider/ledger.py 의 SQL 과 글자 그대로 같다. 바꿀 때는 셋을 함께 고친다. */
object LedgerSql {
  const val BALANCES = """
SELECT a.id AS id, a.name AS name, a.kind AS kind, a.is_default AS is_default, a.archived AS archived,
  a.initial_balance
  + COALESCE((SELECT SUM(amount) FROM transactions WHERE type='income' AND account_id=a.id),0)
  - COALESCE((SELECT SUM(amount) FROM transactions WHERE type='expense' AND account_id=a.id),0)
  - COALESCE((SELECT SUM(amount) FROM transactions WHERE type='transfer' AND account_id=a.id),0)
  + COALESCE((SELECT SUM(amount) FROM transactions WHERE type='transfer' AND to_account_id=a.id),0) AS balance
FROM accounts a ORDER BY a.sort, a.created_at, a.name"""

  const val ACCOUNTS = "SELECT id, name, is_default, archived FROM accounts ORDER BY sort, created_at, name"

  const val CATEGORIES = """
SELECT c.id AS id, c.name AS name, c.type AS type, c.parent_id AS parent_id, p.name AS parent_name, c.archived AS archived
FROM categories c LEFT JOIN categories p ON p.id = c.parent_id ORDER BY c.sort, c.name"""

  const val BUDGETS = """
SELECT b.amount AS amount, c.name AS name, p.name AS parent_name
FROM budgets b LEFT JOIN categories c ON c.id = b.category_id LEFT JOIN categories p ON p.id = c.parent_id"""

  const val TX_SELECT = """
SELECT t.id, t.type, t.amount, t.date, t.time, a.name AS account, ta.name AS to_account,
  c.name AS category, p.name AS category_parent, t.merchant, t.memo, t.tags, t.source
FROM transactions t
JOIN accounts a ON a.id = t.account_id
LEFT JOIN accounts ta ON ta.id = t.to_account_id
LEFT JOIN categories c ON c.id = t.category_id
LEFT JOIN categories p ON p.id = c.parent_id"""

  /** LIMIT 은 검증된 정수를 문자열 템플릿으로 넣는다 (Android 의 바인딩은 전부 문자열이라) */
  fun txRange(limit: Int) = TX_SELECT + """
WHERE t.date >= ? AND t.date <= ?
ORDER BY t.date DESC, COALESCE(t.time,'') DESC, t.created_at DESC LIMIT $limit"""

  const val TX_BY_ID = TX_SELECT + " WHERE t.id = ?"
  const val TX_BY_REF = "SELECT id FROM transactions WHERE source_ref = ?"
  const val TX_ROW = "SELECT * FROM transactions WHERE id = ?"

  const val INSERT = """INSERT INTO transactions(id,type,amount,date,time,account_id,to_account_id,category_id,merchant,memo,tags,source,source_ref,created_at,updated_at)
VALUES(?,?,?,?,?,?,?,?,?,?,?,'assistant',?,?,?)"""
  const val UPDATE = "UPDATE transactions SET amount=?, date=?, time=?, account_id=?, to_account_id=?, category_id=?, merchant=?, memo=?, tags=?, updated_at=? WHERE id=?"
  const val DELETE = "DELETE FROM transactions WHERE id = ?"
  const val ITEMS_FOR_TX = """
SELECT i.name AS name, i.qty AS qty, i.unit_price AS unit_price, i.amount AS amount, c.name AS category, p.name AS category_parent
FROM transaction_items i LEFT JOIN categories c ON c.id = i.category_id LEFT JOIN categories p ON p.id = c.parent_id
WHERE i.transaction_id = ? ORDER BY i.sort, i.id"""
  const val ITEMS_RANGE = """
SELECT t.id AS tx_id, t.date AS date, t.merchant AS merchant, a.name AS account,
  i.name AS name, i.qty AS qty, i.unit_price AS unit_price, i.amount AS amount, c.name AS category, p.name AS category_parent
FROM transaction_items i
JOIN transactions t ON t.id = i.transaction_id
JOIN accounts a ON a.id = t.account_id
LEFT JOIN categories c ON c.id = i.category_id
LEFT JOIN categories p ON p.id = c.parent_id
WHERE t.date >= ? AND t.date <= ?
ORDER BY t.date DESC, COALESCE(t.time,'') DESC, t.created_at DESC, i.sort, i.id"""
  const val ITEM_INSERT = "INSERT INTO transaction_items(id,transaction_id,name,qty,unit_price,amount,category_id,sort) VALUES(?,?,?,?,?,?,?,?)"
  const val ITEMS_DELETE = "DELETE FROM transaction_items WHERE transaction_id = ?"
  const val ITEMS_SUM = "SELECT COALESCE(SUM(amount),0) AS total, COUNT(*) AS n FROM transaction_items WHERE transaction_id = ?"
  const val BALANCE_ONE = "SELECT balance FROM ($BALANCES) WHERE id = ?"

  const val RULES = """
SELECT r.id AS id, r.keyword AS keyword, r.match AS match, r.account_id AS account_id, a.name AS account, a.archived AS archived, r.created_at AS created_at
FROM account_rules r JOIN accounts a ON a.id = r.account_id ORDER BY r.created_at, r.id"""
  const val RULE_INSERT = "INSERT INTO account_rules(id,keyword,match,account_id,created_at) VALUES(?,?,?,?,?)"
  const val RULE_UPDATE_ACCOUNT = "UPDATE account_rules SET account_id=? WHERE id=?"
  const val RULE_DELETE = "DELETE FROM account_rules WHERE id=?"
  const val RULE_COUNT = "SELECT COUNT(*) FROM account_rules"

  const val DEFAULT_ACCOUNT = "SELECT id FROM accounts WHERE is_default=1 AND archived=0 ORDER BY sort, created_at LIMIT 1"
  const val CATEGORY_EXISTS = "SELECT 1 FROM categories WHERE id=?"
  const val CATEGORY_WITH_PARENT = "SELECT c.name AS name, p.name AS parent FROM categories c LEFT JOIN categories p ON p.id=c.parent_id WHERE c.id=?"
  const val RULE_EXISTS = "SELECT 1 FROM account_rules WHERE id=?"
  const val ACCOUNT_NAME = "SELECT name FROM accounts WHERE id=?"
}
