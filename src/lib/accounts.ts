import { categoryPath, norm } from './match';
import type { Account, AccountRule, Category, Tx } from './types';

/** 계좌별 잔액 = 초기 + 수입 − 지출 − 이체출금 + 이체입금 (저장하지 않고 계산) */
export function balances(accounts: Pick<Account, 'id' | 'initial_balance'>[], txs: Pick<Tx, 'type' | 'amount' | 'account_id' | 'to_account_id'>[]): Map<string, number> {
  const m = new Map(accounts.map((a) => [a.id, a.initial_balance]));
  const add = (id: string | null, d: number) => { if (id && m.has(id)) m.set(id, (m.get(id) as number) + d); };
  for (const t of txs) {
    if (t.type === 'income') add(t.account_id, t.amount);
    else if (t.type === 'expense') add(t.account_id, -t.amount);
    else { add(t.account_id, -t.amount); add(t.to_account_id, t.amount); }
  }
  return m;
}

export const totalAssets = (b: Map<string, number>) => [...b.values()].reduce((s, v) => s + v, 0);

export type AccountSource = 'explicit' | 'rule' | 'default';

/**
 * 통장 결정 우선순위: ① 명시한 통장 ② 규칙(가맹점/메모/카테고리 이름에 keyword 포함 — 긴 keyword 우선, 동률이면 먼저 만든 규칙)
 * ③ 기본 통장. 규칙이 가리키는 통장이 보관됐거나 없으면 건너뛴다. provider(Kotlin)도 같은 규칙.
 */
export function resolveAccount(opts: {
  explicitId?: string | null;
  rules: AccountRule[];
  accounts: Account[];
  categories: Category[];
  merchant?: string | null;
  memo?: string | null;
  categoryId?: string | null;
}): { account: Account | null; source: AccountSource; rule?: AccountRule } {
  const { accounts } = opts;
  if (opts.explicitId) {
    const a = accounts.find((x) => x.id === opts.explicitId);
    if (a) return { account: a, source: 'explicit' };
  }
  const cat = opts.categoryId ? opts.categories.find((c) => c.id === opts.categoryId) : undefined;
  const merchant = norm(opts.merchant ?? '');
  const memo = norm(opts.memo ?? '');
  const catNames = cat ? [norm(cat.name), norm(categoryPath(cat, opts.categories))] : [];
  const hits = opts.rules
    .filter((r) => {
      const acc = accounts.find((a) => a.id === r.account_id);
      if (!acc || acc.archived) return false;
      const k = norm(r.keyword);
      if (!k) return false;
      const inM = !!merchant && merchant.includes(k);
      const inMemo = !!memo && memo.includes(k);
      const inC = catNames.some((n) => n.includes(k));
      return r.match === 'merchant' ? inM : r.match === 'memo' ? inMemo : r.match === 'category' ? inC : inM || inMemo || inC;
    })
    .sort((a, b) => norm(b.keyword).length - norm(a.keyword).length || a.created_at.localeCompare(b.created_at));
  if (hits.length) {
    const rule = hits[0];
    return { account: accounts.find((a) => a.id === rule.account_id) as Account, source: 'rule', rule };
  }
  const def = accounts.find((a) => a.is_default && !a.archived) ?? accounts.find((a) => !a.archived) ?? null;
  return { account: def, source: 'default' };
}
