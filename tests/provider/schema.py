"""스펙(/docs 와 앱)과 같은 스키마 + 테스트용 시드. Kotlin 제공자가 열 실제 DB 와 같은 모양이다."""

SCHEMA = """
CREATE TABLE accounts(
  id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK(kind IN ('bank','card','cash','savings','invest','other')),
  initial_balance INTEGER NOT NULL DEFAULT 0,
  is_default INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0, sort INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
CREATE TABLE categories(
  id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL CHECK(type IN ('expense','income')),
  parent_id TEXT REFERENCES categories(id),
  icon TEXT, color TEXT, sort INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0,
  UNIQUE(name, type, parent_id));
CREATE TABLE transactions(
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK(type IN ('expense','income','transfer')),
  amount INTEGER NOT NULL CHECK(amount > 0),
  date TEXT NOT NULL, time TEXT,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  to_account_id TEXT REFERENCES accounts(id),
  category_id TEXT REFERENCES categories(id),
  merchant TEXT, memo TEXT, tags TEXT,
  source TEXT NOT NULL DEFAULT 'app' CHECK(source IN ('app','assistant','recurring')),
  source_ref TEXT UNIQUE,
  recurring_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX tx_date ON transactions(date DESC, time DESC);
CREATE INDEX tx_acc ON transactions(account_id);
CREATE INDEX tx_cat ON transactions(category_id);
CREATE TABLE budgets(id TEXT PRIMARY KEY, category_id TEXT UNIQUE REFERENCES categories(id), amount INTEGER NOT NULL CHECK(amount>0));
CREATE TABLE recurring(
  id TEXT PRIMARY KEY, type TEXT NOT NULL CHECK(type IN ('expense','income','transfer')), amount INTEGER NOT NULL CHECK(amount>0),
  account_id TEXT NOT NULL REFERENCES accounts(id), to_account_id TEXT REFERENCES accounts(id), category_id TEXT REFERENCES categories(id),
  merchant TEXT, memo TEXT, day INTEGER NOT NULL CHECK(day BETWEEN 1 AND 31),
  start_date TEXT NOT NULL, end_date TEXT, last_run TEXT, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE account_rules(
  id TEXT PRIMARY KEY, keyword TEXT NOT NULL,
  match TEXT NOT NULL DEFAULT 'any' CHECK(match IN ('merchant','category','memo','any')),
  account_id TEXT NOT NULL REFERENCES accounts(id), created_at TEXT NOT NULL);
CREATE TABLE kv(key TEXT PRIMARY KEY, value TEXT NOT NULL);
"""

# (id, name, type, parent_id) — 앱 시드의 일부(이름 매칭 규칙을 시험하는 데 필요한 것)
CATEGORIES = [
    ("cat_food", "식비", "expense", None),
    ("cat_food_dining", "외식", "expense", "cat_food"),
    ("cat_food_delivery", "배달", "expense", "cat_food"),
    ("cat_food_cafe", "카페/간식", "expense", "cat_food"),
    ("cat_food_grocery", "장보기", "expense", "cat_food"),
    ("cat_shop", "쇼핑", "expense", None),
    ("cat_shop_clothes", "의류", "expense", "cat_shop"),
    ("cat_hobby", "취미/여가", "expense", None),
    ("cat_hobby_sports", "운동", "expense", "cat_hobby"),
    ("cat_hobby_sub", "구독", "expense", "cat_hobby"),
    ("cat_health", "건강", "expense", None),
    ("cat_health_fitness", "운동", "expense", "cat_health"),
    ("cat_transport", "교통", "expense", None),
    ("cat_transport_taxi", "택시", "expense", "cat_transport"),
    ("cat_misc", "기타", "expense", None),
    ("cat_inc_salary", "급여", "income", None),
    ("cat_inc_side", "부수입", "income", None),
    ("cat_inc_misc", "기타수입", "income", None),
]


def seed(db):
    db.executescript(SCHEMA)
    now = "2026-01-01T00:00:00.000Z"
    db.execute("INSERT INTO accounts(id,name,kind,initial_balance,is_default,sort,created_at) VALUES('acc_main','주 통장','bank',1000000,1,0,?)", (now,))
    for i, (cid, name, typ, parent) in enumerate(CATEGORIES):
        db.execute("INSERT INTO categories(id,name,type,parent_id,sort) VALUES(?,?,?,?,?)", (cid, name, typ, parent, i))
    db.commit()
