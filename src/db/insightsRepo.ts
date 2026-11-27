import { merchantKey } from '../lib/merchants';
import { IMPORT_REF_PREFIX } from './schemaV3';
import type { Db } from './dbtype';
import { uid } from './repo';

// ---- 가맹점 별칭 (표기 변형을 한 가게로 합치기)
/** merchantKey → 대표 이름 */
export async function loadAliases(db: Db): Promise<Map<string, string>> {
  const rows = await db.getAllAsync<{ alias_key: string; canonical: string }>('SELECT alias_key, canonical FROM merchant_aliases');
  return new Map(rows.map((r) => [r.alias_key, r.canonical]));
}

/** names 를 모두 canonical 이름으로 합친다. canonical 자신의 키는 별칭으로 저장하지 않는다 */
export async function mergeMerchants(db: Db, names: string[], canonical: string): Promise<void> {
  const ck = merchantKey(canonical);
  await db.withExclusiveTransactionAsync(async (tx) => {
    for (const n of names) {
      const k = merchantKey(n);
      if (!k || k === ck) continue;
      await tx.runAsync('INSERT OR REPLACE INTO merchant_aliases(alias_key, canonical) VALUES(?,?)', k, canonical.trim());
    }
    // 이미 canonical 을 대표로 쓰던 별칭이 새 대표를 가리키도록 (연쇄 합치기)
    await tx.runAsync('UPDATE merchant_aliases SET canonical=? WHERE canonical IN (' + names.map(() => '?').join(',') + ')', canonical.trim(), ...names);
  });
}

export const removeAlias = (db: Db, key: string) => db.runAsync('DELETE FROM merchant_aliases WHERE alias_key=?', key);

// ---- 가맹점 → 분류 학습
export async function loadLearned(db: Db): Promise<Map<string, string>> {
  const rows = await db.getAllAsync<{ merchant_key: string; category_id: string }>('SELECT merchant_key, category_id FROM merchant_categories');
  return new Map(rows.map((r) => [r.merchant_key, r.category_id]));
}

export async function learnCategory(db: Db, merchant: string, categoryId: string): Promise<void> {
  const k = merchantKey(merchant);
  if (k) await db.runAsync('INSERT OR REPLACE INTO merchant_categories(merchant_key, category_id) VALUES(?,?)', k, categoryId);
}

// ---- 거래 가져오기
export interface ImportRow {
  type: 'expense' | 'income' | 'transfer';
  amount: number;
  date: string;
  time: string | null;
  account_id: string;
  to_account_id: string | null;
  category_id: string | null;
  merchant: string | null;
  memo: string | null;
  /** 멱등 키 (imp: 로 시작) */
  source_ref: string;
}

export interface ImportInput {
  source: 'csv' | 'sms';
  label: string | null;
  account_id: string | null;
  rows: ImportRow[];
  /** 가져오기 미리보기에서 사용자가 바꾼 분류 → "앞으로도" 학습 (가맹점 → 분류) */
  learn: { merchant: string; category_id: string }[];
}

/** 한 트랜잭션으로 일괄 저장. 이미 같은 source_ref 가 있으면 건너뛴다(재가져오기 멱등). 저장한 건수와 묶음 id 를 돌려준다 */
export async function saveImport(db: Db, input: ImportInput, now: Date = new Date()): Promise<{ batchId: string; saved: number; skipped: number }> {
  const batchId = `imp_${uid()}`;
  const ts = now.toISOString();
  let saved = 0;
  await db.withExclusiveTransactionAsync(async (tx) => {
    await tx.runAsync('INSERT INTO import_batches(id, created_at, source, label, account_id, count) VALUES(?,?,?,?,?,0)', batchId, ts, input.source, input.label, input.account_id);
    for (const r of input.rows) {
      if (!r.source_ref.startsWith(IMPORT_REF_PREFIX)) throw new Error('가져오기 키가 올바르지 않아요');
      const res = await tx.runAsync(
        `INSERT OR IGNORE INTO transactions(id,type,amount,date,time,account_id,to_account_id,category_id,merchant,memo,tags,source,source_ref,recurring_id,created_at,updated_at,import_batch_id)
         VALUES(?,?,?,?,?,?,?,?,?,?,NULL,'app',?,NULL,?,?,?)`,
        uid(), r.type, r.amount, r.date, r.time, r.account_id, r.type === 'transfer' ? r.to_account_id : null,
        r.type === 'transfer' ? null : r.category_id, r.merchant, r.memo, r.source_ref, ts, ts, batchId);
      saved += res.changes;
    }
    await tx.runAsync('UPDATE import_batches SET count=? WHERE id=?', saved, batchId);
    for (const l of input.learn) {
      const k = merchantKey(l.merchant);
      if (k) await tx.runAsync('INSERT OR REPLACE INTO merchant_categories(merchant_key, category_id) VALUES(?,?)', k, l.category_id);
    }
    if (saved === 0) await tx.runAsync('DELETE FROM import_batches WHERE id=?', batchId);
  });
  return { batchId, saved, skipped: input.rows.length - saved };
}

/** 가져오기 묶음 되돌리기: 그 묶음의 거래(품목 포함)와 묶음 기록을 지운다. 지운 거래 수를 돌려준다 */
export async function undoImport(db: Db, batchId: string): Promise<number> {
  let n = 0;
  await db.withExclusiveTransactionAsync(async (tx) => {
    await tx.runAsync('DELETE FROM transaction_items WHERE transaction_id IN (SELECT id FROM transactions WHERE import_batch_id=?)', batchId);
    const res = await tx.runAsync('DELETE FROM transactions WHERE import_batch_id=?', batchId);
    n = res.changes;
    await tx.runAsync('DELETE FROM import_batches WHERE id=?', batchId);
  });
  return n;
}

export async function loadBatches(db: Db): Promise<{ id: string; created_at: string; source: string; label: string | null; count: number }[]> {
  return db.getAllAsync('SELECT id, created_at, source, label, count FROM import_batches ORDER BY created_at DESC LIMIT 20');
}
