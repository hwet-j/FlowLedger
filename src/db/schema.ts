export const SCHEMA_VERSION = 1;

export const PRAGMAS = `
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 3000;
PRAGMA foreign_keys = ON;
`;

/** 비서 연동 provider(Kotlin)가 같은 파일을 직접 열어 쓰므로 컬럼/제약은 스펙(docs/provider-sql.md)과 같아야 한다 */
export const SCHEMA_V1 = `
CREATE TABLE IF NOT EXISTS accounts(
  id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK(kind IN ('bank','card','cash','savings','invest','other')),
  initial_balance INTEGER NOT NULL DEFAULT 0,
  is_default INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0, sort INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS categories(
  id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL CHECK(type IN ('expense','income')),
  parent_id TEXT REFERENCES categories(id),
  icon TEXT, color TEXT, sort INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0,
  UNIQUE(name, type, parent_id));
CREATE TABLE IF NOT EXISTS transactions(
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
CREATE INDEX IF NOT EXISTS tx_date ON transactions(date DESC, time DESC);
CREATE INDEX IF NOT EXISTS tx_acc ON transactions(account_id);
CREATE INDEX IF NOT EXISTS tx_cat ON transactions(category_id);
CREATE TABLE IF NOT EXISTS budgets(id TEXT PRIMARY KEY, category_id TEXT UNIQUE REFERENCES categories(id), amount INTEGER NOT NULL CHECK(amount > 0));
CREATE TABLE IF NOT EXISTS recurring(
  id TEXT PRIMARY KEY, type TEXT NOT NULL CHECK(type IN ('expense','income','transfer')), amount INTEGER NOT NULL CHECK(amount > 0),
  account_id TEXT NOT NULL REFERENCES accounts(id), to_account_id TEXT REFERENCES accounts(id), category_id TEXT REFERENCES categories(id),
  merchant TEXT, memo TEXT, day INTEGER NOT NULL CHECK(day BETWEEN 1 AND 31),
  start_date TEXT NOT NULL, end_date TEXT, last_run TEXT, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS account_rules(
  id TEXT PRIMARY KEY, keyword TEXT NOT NULL,
  match TEXT NOT NULL DEFAULT 'any' CHECK(match IN ('merchant','category','memo','any')),
  account_id TEXT NOT NULL REFERENCES accounts(id), created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS kv(key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;
