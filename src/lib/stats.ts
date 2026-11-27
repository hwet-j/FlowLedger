import { addMonths, monthRange, weekdayOf } from './dates';
import { norm } from './match';
import type { Budget, Category, Tx } from './types';

const inMonth = (t: Pick<Tx, 'date'>, month: string) => t.date.startsWith(month);

export interface CatStat {
  id: string; // 대분류 id ('' = 미분류)
  name: string;
  color: string | null;
  total: number;
  count: number;
  pct: number; // 0~100 (총지출 대비)
  children: { id: string; name: string; total: number; count: number }[];
}

export interface MonthStats {
  month: string;
  income: number;
  expense: number;
  net: number;
  count: number;
  byCategory: CatStat[];
  prevExpense: number;
  prevIncome: number;
  /** 전월 대비 지출 증감(원) 과 비율(%, 전월 0 이면 null) */
  expenseDelta: number;
  expenseDeltaPct: number | null;
}

/** 지출 항목의 대분류(상위) id. 대분류 자체면 자기 자신, 없으면 '' */
export function topCategoryId(categoryId: string | null, cats: Category[]): string {
  if (!categoryId) return '';
  const c = cats.find((x) => x.id === categoryId);
  if (!c) return '';
  return c.parent_id ?? c.id;
}

export function monthStats(txs: Tx[], cats: Category[], month: string): MonthStats {
  const cur = txs.filter((t) => inMonth(t, month));
  const prevMonth = addMonths(month, -1);
  const prev = txs.filter((t) => inMonth(t, prevMonth));
  const sum = (l: Tx[], type: 'expense' | 'income') => l.filter((t) => t.type === type).reduce((s, t) => s + t.amount, 0);
  const expense = sum(cur, 'expense');
  const income = sum(cur, 'income');
  const prevExpense = sum(prev, 'expense');
  const groups = new Map<string, CatStat>();
  for (const t of cur) {
    if (t.type !== 'expense') continue;
    const top = topCategoryId(t.category_id, cats);
    const topCat = cats.find((c) => c.id === top);
    let g = groups.get(top);
    if (!g) {
      g = { id: top, name: topCat?.name ?? '미분류', color: topCat?.color ?? null, total: 0, count: 0, pct: 0, children: [] };
      groups.set(top, g);
    }
    g.total += t.amount;
    g.count += 1;
    const sub = t.category_id && t.category_id !== top ? cats.find((c) => c.id === t.category_id) : undefined;
    const sid = sub?.id ?? top;
    const sname = sub?.name ?? (topCat ? `${topCat.name}(기타)` : '미분류');
    let ch = g.children.find((c) => c.id === sid);
    if (!ch) { ch = { id: sid, name: sname, total: 0, count: 0 }; g.children.push(ch); }
    ch.total += t.amount;
    ch.count += 1;
  }
  const byCategory = [...groups.values()].sort((a, b) => b.total - a.total);
  byCategory.forEach((g) => {
    g.pct = expense ? (g.total / expense) * 100 : 0;
    g.children.sort((a, b) => b.total - a.total);
  });
  return {
    month, income, expense, net: income - expense, count: cur.length, byCategory,
    prevExpense, prevIncome: sum(prev, 'income'),
    expenseDelta: expense - prevExpense,
    expenseDeltaPct: prevExpense ? ((expense - prevExpense) / prevExpense) * 100 : null,
  };
}

/** endMonth 까지 최근 n개월의 월별 수입/지출 (오래된 달부터) */
export function trend(txs: Tx[], endMonth: string, n = 12): { month: string; income: number; expense: number }[] {
  const months = Array.from({ length: n }, (_, i) => addMonths(endMonth, i - (n - 1)));
  const idx = new Map(months.map((m, i) => [m, i]));
  const out = months.map((month) => ({ month, income: 0, expense: 0 }));
  for (const t of txs) {
    const i = idx.get(t.date.slice(0, 7));
    if (i === undefined) continue;
    if (t.type === 'income') out[i].income += t.amount;
    else if (t.type === 'expense') out[i].expense += t.amount;
  }
  return out;
}

export function byAccount(txs: Tx[], month: string): { account_id: string; expense: number; income: number }[] {
  const m = new Map<string, { account_id: string; expense: number; income: number }>();
  for (const t of txs) {
    if (!inMonth(t, month) || t.type === 'transfer') continue;
    const r = m.get(t.account_id) ?? { account_id: t.account_id, expense: 0, income: 0 };
    if (t.type === 'expense') r.expense += t.amount; else r.income += t.amount;
    m.set(t.account_id, r);
  }
  return [...m.values()].sort((a, b) => b.expense - a.expense);
}

/** 요일별 지출 합계와 건수 (일=0) */
export function byWeekday(txs: Tx[], month: string): { weekday: number; total: number; count: number }[] {
  const out = Array.from({ length: 7 }, (_, weekday) => ({ weekday, total: 0, count: 0 }));
  for (const t of txs) {
    if (!inMonth(t, month) || t.type !== 'expense') continue;
    const w = out[weekdayOf(t.date)];
    w.total += t.amount;
    w.count += 1;
  }
  return out;
}

export function topMerchants(txs: Tx[], month: string, limit = 5): { merchant: string; total: number; count: number }[] {
  const m = new Map<string, { merchant: string; total: number; count: number }>();
  for (const t of txs) {
    if (!inMonth(t, month) || t.type !== 'expense' || !t.merchant?.trim()) continue;
    const k = norm(t.merchant);
    const r = m.get(k) ?? { merchant: t.merchant.trim(), total: 0, count: 0 };
    r.total += t.amount;
    r.count += 1;
    m.set(k, r);
  }
  return [...m.values()].sort((a, b) => b.total - a.total).slice(0, limit);
}

/** 일별 지출 합계 (달력/막대용) */
export function dailyExpense(txs: Tx[], month: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of txs) if (inMonth(t, month) && t.type === 'expense') m.set(t.date, (m.get(t.date) ?? 0) + t.amount);
  return m;
}

export interface BudgetStatus {
  budget: Budget;
  label: string;
  spent: number;
  remaining: number;
  pct: number; // 0~ (100 초과 가능)
  level: 'ok' | 'warn' | 'over';
}

/** 월 예산 진행. 대분류 예산은 소분류 지출을 포함하고, 소분류 예산은 그 소분류만 센다. category_id=null 은 월 전체 지출 */
export function budgetStatus(budgets: Budget[], txs: Tx[], cats: Category[], month: string): BudgetStatus[] {
  const spend = txs.filter((t) => inMonth(t, month) && t.type === 'expense');
  const total = spend.reduce((s, t) => s + t.amount, 0);
  return budgets
    .map((b) => {
      let spent = total;
      let label = '이번 달 전체';
      if (b.category_id) {
        const c = cats.find((x) => x.id === b.category_id);
        label = c?.name ?? '(삭제된 카테고리)';
        spent = spend
          .filter((t) => (c && !c.parent_id ? topCategoryId(t.category_id, cats) === c.id : t.category_id === b.category_id))
          .reduce((s, t) => s + t.amount, 0);
      }
      const pct = (spent / b.amount) * 100;
      return { budget: b, label, spent, remaining: b.amount - spent, pct, level: (pct >= 100 ? 'over' : pct >= 80 ? 'warn' : 'ok') as BudgetStatus['level'] };
    })
    .sort((a, b) => (a.budget.category_id === null ? -1 : b.budget.category_id === null ? 1 : b.pct - a.pct));
}

/** 이번 달 남은 일수 기준 하루 사용 가능 금액 (전체 예산용) */
export function dailyAllowance(remaining: number, today: string, month: string): number | null {
  const { to } = monthRange(month);
  if (today < `${month}-01` || today > to) return null;
  const left = Number(to.slice(8)) - Number(today.slice(8)) + 1;
  return left > 0 ? Math.floor(remaining / left) : null;
}
