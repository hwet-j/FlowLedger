import * as SQLite from 'expo-sqlite';

import { seedAccounts, seedCategories } from '../lib/seed';
import { MIGRATE_V2_ITEMS, PRAGMAS, SCHEMA_V1, SCHEMA_VERSION } from './schema';
import { MIGRATE_V3_COLUMN, MIGRATE_V3_INDEX, MIGRATE_V3_TABLES, SCHEMA_VERSION_V3 } from './schemaV3';

export const DB_NAME = 'flowledger.db';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

/** 단일 DB 핸들. 최초 호출 시 스키마 생성·마이그레이션·시드 */
export function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync(DB_NAME);
      await db.execAsync(PRAGMAS);
      await migrate(db);
      return db;
    })();
    dbPromise.catch(() => { dbPromise = null; });
  }
  return dbPromise;
}

async function migrate(db: SQLite.SQLiteDatabase) {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const v = row?.user_version ?? 0;
  if (v < 1) {
    await db.withExclusiveTransactionAsync(async (tx) => {
      await tx.execAsync(SCHEMA_V1);
      const n = await tx.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM accounts');
      if (!n?.n) {
        const now = new Date().toISOString();
        for (const a of seedAccounts(now)) {
          await tx.runAsync('INSERT INTO accounts(id,name,kind,initial_balance,is_default,archived,sort,created_at) VALUES(?,?,?,?,?,?,?,?)',
            a.id, a.name, a.kind, a.initial_balance, a.is_default, a.archived, a.sort, a.created_at);
        }
      }
      const c = await tx.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM categories');
      if (!c?.n) {
        for (const k of seedCategories()) {
          await tx.runAsync('INSERT INTO categories(id,name,type,parent_id,icon,color,sort,archived) VALUES(?,?,?,?,?,?,?,?)',
            k.id, k.name, k.type, k.parent_id, k.icon, k.color, k.sort, k.archived);
        }
      }
    });
    await db.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  } else if (v < 2) {
    await db.withExclusiveTransactionAsync(async (tx) => {
      const cols = await tx.getAllAsync<{ name: string }>('PRAGMA table_info(transactions)');
      if (!cols.some((c) => c.name === 'receipt_uri')) await tx.execAsync('ALTER TABLE transactions ADD COLUMN receipt_uri TEXT');
      await tx.execAsync(MIGRATE_V2_ITEMS);
    });
    await db.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  }
  // v3: 가맹점 별칭·분류 학습·가져오기 묶음 (앞 단계가 user_version 을 2 로 올린 뒤에 다시 읽는다)
  const v3 = (await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version'))?.user_version ?? 0;
  if (v3 < SCHEMA_VERSION_V3) {
    await db.withExclusiveTransactionAsync(async (tx) => {
      const cols = await tx.getAllAsync<{ name: string }>('PRAGMA table_info(transactions)');
      if (!cols.some((c) => c.name === 'import_batch_id')) await tx.execAsync(MIGRATE_V3_COLUMN);
      await tx.execAsync(MIGRATE_V3_TABLES);
      await tx.execAsync(MIGRATE_V3_INDEX);
    });
    await db.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION_V3}`);
  }
}
