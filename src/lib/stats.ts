import { addMonths, monthRange, weekdayOf } from './dates';
import { norm } from './match';
import { expenseParts } from './items';
import type { Budget, Category, Tx, TxItem } from './types';

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

export function monthStats(txs: Tx[], cats: Category[], month: string, itemsByTx?: Map<string, TxItem[]>): MonthStats {
  const cur = txs.filter((t) => inMonth(t, month));
  // month 가 'YYYY' 이면 연 통계 (전년 대비)
  const prevMonth = month.length === 4 ? String(Number(month) - 1) : addMonths(month, -1);
  const prev = txs.filter((t) => inMonth(t, prevMonth));
  const sum = (l: Tx[], type: 'expense' | 'income') => l.filter((t) => t.type === type).reduce((s, t) => s + t.amount, 0);
  const expense = sum(cur, 'expense');
  const income = sum(cur, 'income');
  const prevExpense = sum(prev, 'expense');
  const groups = new Map<string, CatStat>();
  // 품목에 분류가 있으면 품목 금액을 그 분류로 센다 (한 영수증이 여러 분류로 쪼개짐)
  for (const t of expenseParts(cur, itemsByTx)) {
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
export function budgetStatus(budgets: Budget[], txs: Tx[], cats: Category[], month: string, itemsByTx?: Map<string, TxItem[]>): BudgetStatus[] {
  const spend = expenseParts(txs.filter((t) => inMonth(t, month)), itemsByTx);
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

/**
 * 이번 달 일평균 지출 기준 월말 예상 지출. 달이 아직 시작 안 했거나 지났으면 null.
 * 오늘까지 지난 일수(오늘 포함)로 나눈다.
 */
export function projectMonthEnd(txs: Tx[], month: string, now: Date): { spent: number; dailyAvg: number; projected: number; daysLeft: number } | null {
  const [y, m] = month.split('-').map(Number);
  if (now.getFullYear() !== y || now.getMonth() + 1 !== m) return null;
  const spent = txs.filter((t) => inMonth(t, month) && t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  const total = new Date(y, m, 0).getDate();
  const day = now.getDate();
  const dailyAvg = spent / day;
  return { spent, dailyAvg, projected: Math.round(dailyAvg * total), daysLeft: total - day };
}

export interface BudgetAlert { key: string; title: string; body: string }

/**
 * 80% / 100% 도달 알림. sent 에 이미 보낸 키(`월:예산id:80|100`)가 있으면 건너뛴다.
 * 100% 를 넘으면 80% 알림은 따로 보내지 않는다(둘 다 한꺼번에 오지 않게).
 */
export function alertsDue(statuses: BudgetStatus[], month: string, sent: ReadonlySet<string>): BudgetAlert[] {
  const out: BudgetAlert[] = [];
  for (const s of statuses) {
    const k100 = `${month}:${s.budget.id}:100`;
    const k80 = `${month}:${s.budget.id}:80`;
    if (s.pct >= 100) {
      if (!sent.has(k100)) out.push({ key: k100, title: `${s.label} 예산 초과`, body: `${s.spent.toLocaleString('ko-KR')}원 사용 — 예산 ${s.budget.amount.toLocaleString('ko-KR')}원을 ${(-s.remaining).toLocaleString('ko-KR')}원 넘었어요.` });
    } else if (s.pct >= 80 && !sent.has(k80)) {
      out.push({ key: k80, title: `${s.label} 예산 ${Math.floor(s.pct)}% 사용`, body: `${s.remaining.toLocaleString('ko-KR')}원 남았어요.` });
    }
  }
  return out;
}

/** 월간 리포트 텍스트 (공유용) */
export function monthlyReport(
  s: MonthStats, budgets: BudgetStatus[], label: string, topN = 5,
): string {
  const won = (n: number) => `${n < 0 ? '-' : ''}${Math.abs(Math.round(n)).toLocaleString('ko-KR')}원`;
  const lines = [`📊 ${label} 가계부 리포트`, '', `수입 ${won(s.income)}`, `지출 ${won(s.expense)}`, `수지 ${won(s.net)}`];
  if (s.expenseDeltaPct !== null) lines.push(`전월 대비 지출 ${s.expenseDelta >= 0 ? '+' : '-'}${won(Math.abs(s.expenseDelta))} (${s.expenseDeltaPct >= 0 ? '+' : ''}${s.expenseDeltaPct.toFixed(0)}%)`);
  if (s.byCategory.length) {
    lines.push('', `지출 TOP ${Math.min(topN, s.byCategory.length)}`);
    s.byCategory.slice(0, topN).forEach((c, i) => lines.push(`${i + 1}. ${c.name} ${won(c.total)} (${c.pct.toFixed(0)}%)`));
  }
  if (budgets.length) {
    lines.push('', '예산');
    budgets.forEach((b) => lines.push(`- ${b.label}: ${won(b.spent)} / ${won(b.budget.amount)} (${b.pct.toFixed(0)}%)${b.level === 'over' ? ' ⚠ 초과' : ''}`));
  }
  return lines.join('\n');
}
