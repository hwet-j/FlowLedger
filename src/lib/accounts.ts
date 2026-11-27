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

/** 자산(양수 잔액 합) / 부채(음수 잔액 절댓값 합: 대출·카드 포함) / 순자산(전체 합) */
export function netWorth(balancesByAcc: Map<string, number>, archivedIds: Set<string> = new Set()): { assets: number; debt: number; net: number } {
  let assets = 0, debt = 0;
  for (const [id, b] of balancesByAcc) {
    if (archivedIds.has(id) && b === 0) continue;
    if (b >= 0) assets += b; else debt += -b;
  }
  return { assets, debt, net: assets - debt };
}

const pad2 = (n: number) => String(n).padStart(2, '0');
const lastDayOf = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  return `${month}-${pad2(new Date(y, m, 0).getDate())}`;
};

/**
 * 월말 기준 순자산 추이(최근 n개월, 오래된 달부터). 현재 잔액에서 월말 이후의 거래 영향을 거꾸로 빼서 구한다.
 * 이체는 순자산에 영향이 없다(양쪽 상쇄). 마지막 달(endMonth)이 이번 달이면 "현재"와 같다.
 */
export function netWorthTrend(
  accounts: Pick<Account, 'id' | 'initial_balance'>[],
  txs: Pick<Tx, 'type' | 'amount' | 'date' | 'account_id' | 'to_account_id'>[],
  endMonth: string,
  n = 12,
): { month: string; net: number }[] {
  const nowNet = [...balances(accounts, txs).values()].reduce((s, v) => s + v, 0);
  const months = Array.from({ length: n }, (_, i) => {
    const [y, m] = endMonth.split('-').map(Number);
    const d = new Date(y, m - 1 - (n - 1 - i), 1);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
  });
  return months.map((month) => {
    const end = lastDayOf(month);
    let delta = 0; // end 이후 거래가 순자산에 준 영향
    for (const t of txs) {
      if (t.date <= end) continue;
      if (t.type === 'income') delta += t.amount;
      else if (t.type === 'expense') delta -= t.amount;
    }
    return { month, net: nowNet - delta };
  });
}
