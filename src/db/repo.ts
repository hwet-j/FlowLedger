import type { SQLiteDatabase } from 'expo-sqlite';

import type { BackupData } from '../lib/backup';
import { dueRuns } from '../lib/recurring';
import type { Account, AccountRule, Budget, Category, Goal, Recurring, Template, Tx } from '../lib/types';

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const nowIso = () => new Date().toISOString();

export interface Snapshot {
  accounts: Account[];
  categories: Category[];
  txs: Tx[];
  budgets: Budget[];
  recurring: Recurring[];
  rules: AccountRule[];
  templates: Template[];
  goals: Goal[];
}

export async function loadAll(db: SQLiteDatabase): Promise<Snapshot> {
  const [accounts, categories, txs, budgets, recurring, rules, templates, goals] = await Promise.all([
    db.getAllAsync<Account>('SELECT * FROM accounts ORDER BY sort, created_at'),
    db.getAllAsync<Category>('SELECT * FROM categories ORDER BY type, sort, name'),
    db.getAllAsync<Tx>('SELECT * FROM transactions ORDER BY date DESC, time DESC, created_at DESC'),
    db.getAllAsync<Budget>('SELECT * FROM budgets'),
    db.getAllAsync<Recurring>('SELECT * FROM recurring ORDER BY day'),
    db.getAllAsync<AccountRule>('SELECT * FROM account_rules ORDER BY created_at'),
    db.getAllAsync<Template>('SELECT * FROM templates ORDER BY sort, name'),
    db.getAllAsync<Goal>('SELECT * FROM goals ORDER BY created_at'),
  ]);
  return { accounts, categories, txs, budgets, recurring, rules, templates, goals };
}

// ---- 거래
export type TxInput = Omit<Tx, 'id' | 'created_at' | 'updated_at' | 'source' | 'source_ref' | 'recurring_id'> &
  Partial<Pick<Tx, 'source' | 'source_ref' | 'recurring_id'>>;

export async function insertTx(db: SQLiteDatabase, t: TxInput, id: string = uid()): Promise<string> {
  const now = nowIso();
  await db.runAsync(
    `INSERT INTO transactions(id,type,amount,date,time,account_id,to_account_id,category_id,merchant,memo,tags,source,source_ref,recurring_id,created_at,updated_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    id, t.type, t.amount, t.date, t.time ?? null, t.account_id, t.type === 'transfer' ? t.to_account_id : null,
    t.type === 'transfer' ? null : t.category_id, t.merchant ?? null, t.memo ?? null, t.tags ?? null,
    t.source ?? 'app', t.source_ref ?? null, t.recurring_id ?? null, now, now,
  );
  return id;
}

export async function updateTx(db: SQLiteDatabase, id: string, t: TxInput): Promise<void> {
  await db.runAsync(
    `UPDATE transactions SET type=?,amount=?,date=?,time=?,account_id=?,to_account_id=?,category_id=?,merchant=?,memo=?,tags=?,updated_at=? WHERE id=?`,
    t.type, t.amount, t.date, t.time ?? null, t.account_id, t.type === 'transfer' ? t.to_account_id : null,
    t.type === 'transfer' ? null : t.category_id, t.merchant ?? null, t.memo ?? null, t.tags ?? null, nowIso(), id,
  );
}

export const deleteTx = (db: SQLiteDatabase, id: string) => db.runAsync('DELETE FROM transactions WHERE id=?', id);

/** 삭제 취소(되살리기)용: 지운 행을 그대로 다시 넣는다 */
export async function restoreTx(db: SQLiteDatabase, t: Tx): Promise<void> {
  await db.runAsync(
    `INSERT OR REPLACE INTO transactions(id,type,amount,date,time,account_id,to_account_id,category_id,merchant,memo,tags,source,source_ref,recurring_id,created_at,updated_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    t.id, t.type, t.amount, t.date, t.time, t.account_id, t.to_account_id, t.category_id, t.merchant, t.memo, t.tags,
    t.source, t.source_ref, t.recurring_id, t.created_at, t.updated_at,
  );
}

// ---- 통장
export async function saveAccount(db: SQLiteDatabase, a: Partial<Account> & Pick<Account, 'name' | 'kind'>): Promise<string> {
  const id = a.id ?? uid();
  const exists = a.id ? await db.getFirstAsync('SELECT 1 FROM accounts WHERE id=?', a.id) : null;
  if (exists) {
    await db.runAsync('UPDATE accounts SET name=?,kind=?,initial_balance=? WHERE id=?', a.name, a.kind, a.initial_balance ?? 0, id);
  } else {
    const max = await db.getFirstAsync<{ m: number | null }>('SELECT MAX(sort) AS m FROM accounts');
    await db.runAsync('INSERT INTO accounts(id,name,kind,initial_balance,is_default,archived,sort,created_at) VALUES(?,?,?,?,0,0,?,?)',
      id, a.name, a.kind, a.initial_balance ?? 0, (max?.m ?? 0) + 1, nowIso());
  }
  return id;
}

/** 기본 통장은 항상 정확히 하나. 보관된 통장은 기본이 될 수 없다 */
export async function setDefaultAccount(db: SQLiteDatabase, id: string): Promise<void> {
  await db.withExclusiveTransactionAsync(async (tx) => {
    await tx.runAsync('UPDATE accounts SET is_default=0');
    await tx.runAsync('UPDATE accounts SET is_default=1, archived=0 WHERE id=?', id);
  });
}

export async function archiveAccount(db: SQLiteDatabase, id: string, archived: boolean): Promise<void> {
  await db.withExclusiveTransactionAsync(async (tx) => {
    await tx.runAsync('UPDATE accounts SET archived=? WHERE id=?', archived ? 1 : 0, id);
    if (archived) {
      const def = await tx.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM accounts WHERE is_default=1 AND archived=0');
      if (!def?.n) {
        const other = await tx.getFirstAsync<{ id: string }>('SELECT id FROM accounts WHERE archived=0 ORDER BY sort LIMIT 1');
        await tx.runAsync('UPDATE accounts SET is_default=0');
        if (other) await tx.runAsync('UPDATE accounts SET is_default=1 WHERE id=?', other.id);
      }
    }
  });
}

/** 거래가 없는 통장만 삭제 가능 (있으면 보관 처리) */
export async function deleteAccount(db: SQLiteDatabase, id: string): Promise<'deleted' | 'in_use'> {
  const used = await db.getFirstAsync('SELECT 1 FROM transactions WHERE account_id=? OR to_account_id=? LIMIT 1', id, id);
  const used2 = await db.getFirstAsync('SELECT 1 FROM recurring WHERE account_id=? OR to_account_id=? LIMIT 1', id, id);
  if (used || used2) return 'in_use';
  await db.runAsync('DELETE FROM account_rules WHERE account_id=?', id);
  await db.runAsync('DELETE FROM accounts WHERE id=?', id);
  return 'deleted';
}

// ---- 카테고리
export async function saveCategory(db: SQLiteDatabase, c: Partial<Category> & Pick<Category, 'name' | 'type'>): Promise<string> {
  const id = c.id ?? `cat_u_${uid()}`;
  const exists = c.id ? await db.getFirstAsync('SELECT 1 FROM categories WHERE id=?', c.id) : null;
  if (exists) await db.runAsync('UPDATE categories SET name=?,color=?,icon=? WHERE id=?', c.name, c.color ?? null, c.icon ?? null, id);
  else {
    const max = await db.getFirstAsync<{ m: number | null }>('SELECT MAX(sort) AS m FROM categories WHERE type=?', c.type);
    await db.runAsync('INSERT INTO categories(id,name,type,parent_id,icon,color,sort,archived) VALUES(?,?,?,?,?,?,?,0)',
      id, c.name, c.type, c.parent_id ?? null, c.icon ?? null, c.color ?? null, (max?.m ?? 0) + 1);
  }
  return id;
}

/** 사용 중이면 보관(숨김), 아니면 삭제 */
export async function removeCategory(db: SQLiteDatabase, id: string): Promise<'deleted' | 'archived'> {
  const used = await db.getFirstAsync(
    'SELECT 1 FROM transactions WHERE category_id=? OR category_id IN (SELECT id FROM categories WHERE parent_id=?) LIMIT 1', id, id);
  const usedR = await db.getFirstAsync('SELECT 1 FROM recurring WHERE category_id=? LIMIT 1', id);
  if (used || usedR) {
    await db.runAsync('UPDATE categories SET archived=1 WHERE id=? OR parent_id=?', id, id);
    return 'archived';
  }
  await db.runAsync('DELETE FROM budgets WHERE category_id=? OR category_id IN (SELECT id FROM categories WHERE parent_id=?)', id, id);
  await db.runAsync('DELETE FROM categories WHERE parent_id=?', id);
  await db.runAsync('DELETE FROM categories WHERE id=?', id);
  return 'deleted';
}

// ---- 예산
export async function setBudget(db: SQLiteDatabase, categoryId: string | null, amount: number): Promise<void> {
  const row = categoryId
    ? await db.getFirstAsync<{ id: string }>('SELECT id FROM budgets WHERE category_id=?', categoryId)
    : await db.getFirstAsync<{ id: string }>('SELECT id FROM budgets WHERE category_id IS NULL');
  if (amount <= 0) { if (row) await db.runAsync('DELETE FROM budgets WHERE id=?', row.id); return; }
  if (row) await db.runAsync('UPDATE budgets SET amount=? WHERE id=?', amount, row.id);
  else await db.runAsync('INSERT INTO budgets(id,category_id,amount) VALUES(?,?,?)', uid(), categoryId, amount);
}

// ---- 규칙
export async function saveRule(db: SQLiteDatabase, r: Pick<AccountRule, 'keyword' | 'match' | 'account_id'>): Promise<void> {
  const k = r.keyword.trim();
  const ex = await db.getFirstAsync<{ id: string }>('SELECT id FROM account_rules WHERE lower(keyword)=lower(?) AND match=?', k, r.match);
  if (ex) await db.runAsync('UPDATE account_rules SET account_id=? WHERE id=?', r.account_id, ex.id);
  else await db.runAsync('INSERT INTO account_rules(id,keyword,match,account_id,created_at) VALUES(?,?,?,?,?)', uid(), k, r.match, r.account_id, nowIso());
}
export const deleteRule = (db: SQLiteDatabase, id: string) => db.runAsync('DELETE FROM account_rules WHERE id=?', id);

// ---- 즐겨찾기 템플릿
export async function saveTemplate(db: SQLiteDatabase, t: Omit<Template, 'id' | 'sort'> & { id?: string }): Promise<string> {
  const id = t.id ?? uid();
  const ex = t.id ? await db.getFirstAsync('SELECT 1 FROM templates WHERE id=?', t.id) : null;
  const to = t.type === 'transfer' ? t.to_account_id : null;
  const cat = t.type === 'transfer' ? null : t.category_id;
  if (ex) {
    await db.runAsync('UPDATE templates SET name=?,type=?,amount=?,account_id=?,to_account_id=?,category_id=?,merchant=?,memo=? WHERE id=?',
      t.name, t.type, t.amount, t.account_id, to, cat, t.merchant ?? null, t.memo ?? null, id);
  } else {
    const max = await db.getFirstAsync<{ m: number | null }>('SELECT MAX(sort) AS m FROM templates');
    await db.runAsync('INSERT INTO templates(id,name,type,amount,account_id,to_account_id,category_id,merchant,memo,sort) VALUES(?,?,?,?,?,?,?,?,?,?)',
      id, t.name, t.type, t.amount, t.account_id, to, cat, t.merchant ?? null, t.memo ?? null, (max?.m ?? 0) + 1);
  }
  return id;
}
export const deleteTemplate = (db: SQLiteDatabase, id: string) => db.runAsync('DELETE FROM templates WHERE id=?', id);

// ---- 저축 목표
export async function saveGoal(db: SQLiteDatabase, g: Omit<Goal, 'id' | 'created_at'> & { id?: string }): Promise<string> {
  const id = g.id ?? uid();
  const ex = g.id ? await db.getFirstAsync('SELECT 1 FROM goals WHERE id=?', g.id) : null;
  if (ex) await db.runAsync('UPDATE goals SET name=?,target=?,account_id=?,saved=?,due_date=? WHERE id=?', g.name, g.target, g.account_id, g.saved, g.due_date, id);
  else await db.runAsync('INSERT INTO goals(id,name,target,account_id,saved,due_date,created_at) VALUES(?,?,?,?,?,?,?)', id, g.name, g.target, g.account_id, g.saved, g.due_date, nowIso());
  return id;
}
export const deleteGoal = (db: SQLiteDatabase, id: string) => db.runAsync('DELETE FROM goals WHERE id=?', id);

// ---- 고정 거래
export async function saveRecurring(db: SQLiteDatabase, r: Omit<Recurring, 'id' | 'last_run'> & { id?: string; last_run?: string | null }): Promise<string> {
  const id = r.id ?? uid();
  const ex = r.id ? await db.getFirstAsync('SELECT 1 FROM recurring WHERE id=?', r.id) : null;
  if (ex) {
    await db.runAsync(
      'UPDATE recurring SET type=?,amount=?,account_id=?,to_account_id=?,category_id=?,merchant=?,memo=?,day=?,start_date=?,end_date=?,active=? WHERE id=?',
      r.type, r.amount, r.account_id, r.type === 'transfer' ? r.to_account_id : null, r.type === 'transfer' ? null : r.category_id,
      r.merchant ?? null, r.memo ?? null, r.day, r.start_date, r.end_date ?? null, r.active, id);
  } else {
    await db.runAsync(
      'INSERT INTO recurring(id,type,amount,account_id,to_account_id,category_id,merchant,memo,day,start_date,end_date,last_run,active) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
      id, r.type, r.amount, r.account_id, r.type === 'transfer' ? r.to_account_id : null, r.type === 'transfer' ? null : r.category_id,
      r.merchant ?? null, r.memo ?? null, r.day, r.start_date, r.end_date ?? null, r.last_run ?? null, r.active);
  }
  return id;
}
export const deleteRecurring = (db: SQLiteDatabase, id: string) => db.runAsync('DELETE FROM recurring WHERE id=?', id);

/** 도래한 고정 거래를 거래로 만든다(멱등: source_ref UNIQUE). 만든 개수를 돌려준다 */
export async function runRecurring(db: SQLiteDatabase, today: string): Promise<number> {
  const list = await db.getAllAsync<Recurring>('SELECT * FROM recurring WHERE active=1');
  let created = 0;
  for (const r of list) {
    const runs = dueRuns(r, today);
    if (!runs.length) continue;
    await db.withExclusiveTransactionAsync(async (tx) => {
      for (const d of runs) {
        const res = await tx.runAsync(
          `INSERT OR IGNORE INTO transactions(id,type,amount,date,time,account_id,to_account_id,category_id,merchant,memo,tags,source,source_ref,recurring_id,created_at,updated_at)
           VALUES(?,?,?,?,NULL,?,?,?,?,?,NULL,'recurring',?,?,?,?)`,
          uid(), r.type, r.amount, d.date, r.account_id, r.to_account_id, r.category_id, r.merchant, r.memo, d.ref, r.id, nowIso(), nowIso());
        created += res.changes;
      }
      await tx.runAsync('UPDATE recurring SET last_run=? WHERE id=?', runs[runs.length - 1].date, r.id);
    });
  }
  return created;
}

// ---- 백업 복원 (검증을 통과한 데이터만, 한 트랜잭션: 실패하면 전부 되돌림)
export async function restoreAll(db: SQLiteDatabase, d: BackupData): Promise<void> {
  await db.withExclusiveTransactionAsync(async (tx) => {
    await tx.execAsync('PRAGMA defer_foreign_keys = ON');
    for (const t of ['transactions', 'account_rules', 'recurring', 'budgets', 'templates', 'goals', 'categories', 'accounts']) await tx.runAsync(`DELETE FROM ${t}`);
    for (const a of d.accounts) {
      await tx.runAsync('INSERT INTO accounts(id,name,kind,initial_balance,is_default,archived,sort,created_at) VALUES(?,?,?,?,?,?,?,?)',
        a.id, a.name, a.kind, a.initial_balance, a.is_default ? 1 : 0, a.archived ? 1 : 0, a.sort ?? 0, a.created_at ?? nowIso());
    }
    for (const c of d.categories) {
      await tx.runAsync('INSERT INTO categories(id,name,type,parent_id,icon,color,sort,archived) VALUES(?,?,?,?,?,?,?,?)',
        c.id, c.name, c.type, c.parent_id ?? null, c.icon ?? null, c.color ?? null, c.sort ?? 0, c.archived ? 1 : 0);
    }
    for (const t of d.transactions) {
      await tx.runAsync(
        `INSERT INTO transactions(id,type,amount,date,time,account_id,to_account_id,category_id,merchant,memo,tags,source,source_ref,recurring_id,created_at,updated_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        t.id, t.type, t.amount, t.date, t.time ?? null, t.account_id, t.to_account_id ?? null, t.category_id ?? null, t.merchant ?? null,
        t.memo ?? null, t.tags ?? null, t.source ?? 'app', t.source_ref ?? null, t.recurring_id ?? null, t.created_at ?? nowIso(), t.updated_at ?? nowIso());
    }
    for (const b of d.budgets) await tx.runAsync('INSERT INTO budgets(id,category_id,amount) VALUES(?,?,?)', b.id, b.category_id ?? null, b.amount);
    for (const r of d.recurring) {
      await tx.runAsync(
        'INSERT INTO recurring(id,type,amount,account_id,to_account_id,category_id,merchant,memo,day,start_date,end_date,last_run,active) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
        r.id, r.type, r.amount, r.account_id, r.to_account_id ?? null, r.category_id ?? null, r.merchant ?? null, r.memo ?? null, r.day, r.start_date, r.end_date ?? null, r.last_run ?? null, r.active ? 1 : 0);
    }
    for (const x of d.templates ?? []) {
      await tx.runAsync('INSERT INTO templates(id,name,type,amount,account_id,to_account_id,category_id,merchant,memo,sort) VALUES(?,?,?,?,?,?,?,?,?,?)',
        x.id, x.name, x.type, x.amount, x.account_id ?? null, x.to_account_id ?? null, x.category_id ?? null, x.merchant ?? null, x.memo ?? null, x.sort ?? 0);
    }
    for (const x of d.goals ?? []) {
      await tx.runAsync('INSERT INTO goals(id,name,target,account_id,saved,due_date,created_at) VALUES(?,?,?,?,?,?,?)', x.id, x.name, x.target, x.account_id ?? null, x.saved ?? 0, x.due_date ?? null, x.created_at ?? nowIso());
    }
    for (const r of d.rules) await tx.runAsync('INSERT INTO account_rules(id,keyword,match,account_id,created_at) VALUES(?,?,?,?,?)', r.id, r.keyword, r.match, r.account_id, r.created_at ?? nowIso());
  });
}

export async function wipeAll(db: SQLiteDatabase): Promise<void> {
  await db.withExclusiveTransactionAsync(async (tx) => {
    for (const t of ['transactions', 'account_rules', 'recurring', 'budgets']) await tx.runAsync(`DELETE FROM ${t}`);
  });
}

// ---- 설정 (kv)
export async function kvGet(db: SQLiteDatabase, key: string): Promise<string | null> {
  const r = await db.getFirstAsync<{ value: string }>('SELECT value FROM kv WHERE key=?', key);
  return r?.value ?? null;
}
export const kvSet = (db: SQLiteDatabase, key: string, value: string) => db.runAsync('INSERT OR REPLACE INTO kv(key,value) VALUES(?,?)', key, value);
