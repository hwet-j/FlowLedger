/**
 * v3: 지출 인사이트(가맹점 별칭)와 거래 가져오기(분류 학습, 가져오기 묶음)용 앱 전용 테이블.
 * 비서 제공자(Kotlin)는 이 테이블을 쓰지 않고, 제공자의 INSERT 는 import_batch_id 를 모르므로 NULL 로 남는다(컬럼은 NULL 허용).
 */
export const SCHEMA_VERSION_V3 = 3;

export const MIGRATE_V3_TABLES = `
CREATE TABLE IF NOT EXISTS merchant_aliases(alias_key TEXT PRIMARY KEY, canonical TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS merchant_categories(merchant_key TEXT PRIMARY KEY, category_id TEXT NOT NULL REFERENCES categories(id));
CREATE TABLE IF NOT EXISTS import_batches(
  id TEXT PRIMARY KEY, created_at TEXT NOT NULL, source TEXT NOT NULL, label TEXT,
  account_id TEXT REFERENCES accounts(id), count INTEGER NOT NULL DEFAULT 0);
`;

export const MIGRATE_V3_COLUMN = 'ALTER TABLE transactions ADD COLUMN import_batch_id TEXT';
export const MIGRATE_V3_INDEX = 'CREATE INDEX IF NOT EXISTS tx_import ON transactions(import_batch_id)';

/** 가져오기 멱등 키 접두사 (source_ref) */
export const IMPORT_REF_PREFIX = 'imp:';
