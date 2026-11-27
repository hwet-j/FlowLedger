import { weekdayOf } from './dates';
import { expenseParts } from './items';
import { groupKey, pickName, type AliasMap } from './merchants';
import { topCategoryId } from './stats';
import type { Category, Tx, TxItem } from './types';

/** 인사이트에서 쓰는 기간: [from, to] (YYYY-MM-DD, 포함) 과 직전 같은 길이 구간 */
export interface Range { from: string; to: string }

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dayMs = 86_400_000;
const utc = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
export const daysIn = (r: Range) => Math.round((utc(r.to) - utc(r.from)) / dayMs) + 1;
const shiftDay = (s: string, n: number) => new Date(utc(s) + n * dayMs).toISOString().slice(0, 10);

export type PeriodKind = 'month' | 'lastMonth' | '3m' | 'year';
export const PERIOD_LABEL: Record<PeriodKind, string> = { month: '이번 달', lastMonth: '지난달', '3m': '최근 3개월', year: '올해' };

/** 기간 종류 → 범위와 직전 구간(같은 길이, 월/3개월은 달력 기준) */
export function periodRange(kind: PeriodKind, now: Date = new Date()): { range: Range; prev: Range } {
  const y = now.getFullYear(), m = now.getMonth();
  const monthRange = (yy: number, mm: number): Range => ({ from: iso(new Date(yy, mm, 1)), to: iso(new Date(yy, mm + 1, 0)) });
  if (kind === 'month') {
    const range: Range = { from: iso(new Date(y, m, 1)), to: iso(now) };
    const days = now.getDate();
    const pm = monthRange(y, m - 1);
    return { range, prev: { from: pm.from, to: shiftDay(pm.from, days - 1) > pm.to ? pm.to : shiftDay(pm.from, days - 1) } };
  }
  if (kind === 'lastMonth') return { range: monthRange(y, m - 1), prev: monthRange(y, m - 2) };
  if (kind === '3m') return { range: { from: iso(new Date(y, m - 2, 1)), to: iso(now) }, prev: { from: iso(new Date(y, m - 5, 1)), to: iso(new Date(y, m - 2, 0)) } };
  return { range: { from: `${y}-01-01`, to: iso(now) }, prev: { from: `${y - 1}-01-01`, to: `${y - 1}-${pad(m + 1)}-${pad(now.getDate())}` } };
}

const inRange = (d: string, r: Range) => d >= r.from && d <= r.to;
export const expensesIn = (txs: Tx[], r: Range) => txs.filter((t) => t.type === 'expense' && inRange(t.date, r));
const sum = (l: { amount: number }[]) => l.reduce((s, t) => s + t.amount, 0);
const pctChange = (cur: number, prev: number) => (prev > 0 ? Math.round(((cur - prev) / prev) * 1000) / 10 : null);

export interface MerchantStat {
  key: string; name: string; total: number; count: number; avg: number; pct: number; lastDate: string;
  prevTotal: number; changePct: number | null;
}

/** 가맹점별 지출 순위 (별칭 병합 반영, 가맹점이 없는 거래는 제외) */
export function merchantRanking(txs: Tx[], r: Range, prev: Range | null, aliases?: AliasMap): MerchantStat[] {
  const cur = expensesIn(txs, r).filter((t) => t.merchant?.trim());
  const total = sum(cur);
  const prevSums = new Map<string, number>();
  if (prev) for (const t of expensesIn(txs, prev)) if (t.merchant?.trim()) { const k = groupKey(t.merchant, aliases); prevSums.set(k, (prevSums.get(k) ?? 0) + t.amount); }
  const m = new Map<string, MerchantStat & { names: Map<string, number> }>();
  for (const t of cur) {
    const k = groupKey(t.merchant as string, aliases);
    const e = m.get(k) ?? { key: k, name: '', total: 0, count: 0, avg: 0, pct: 0, lastDate: '', prevTotal: 0, changePct: null, names: new Map() };
    e.total += t.amount; e.count++;
    if (t.date > e.lastDate) e.lastDate = t.date;
    e.names.set(t.merchant as string, (e.names.get(t.merchant as string) ?? 0) + t.amount);
    m.set(k, e);
  }
  return [...m.values()].map((e) => {
    // 대표 이름: 별칭이 있으면 그것, 없으면 합계가 가장 큰 표기
    const name = pickName(e.names, aliases);
    const prevTotal = prevSums.get(e.key) ?? 0;
    return { key: e.key, name, total: e.total, count: e.count, avg: Math.round(e.total / e.count), pct: total ? (e.total / total) * 100 : 0, lastDate: e.lastDate, prevTotal, changePct: pctChange(e.total, prevTotal) };
  }).sort((a, b) => b.total - a.total);
}

export interface CategoryStat {
  id: string; name: string; total: number; count: number; pct: number; prevTotal: number; changePct: number | null;
  children: { id: string; name: string; total: number; count: number }[];
}

/** 대분류 기준 분류별 지출 순위 (영수증 품목 분류 반영) + 직전 구간 대비 */
export function categoryRanking(txs: Tx[], cats: Category[], itemsByTx: Map<string, TxItem[]> | undefined, r: Range, prev: Range | null): CategoryStat[] {
  const catName = (id: string) => cats.find((c) => c.id === id)?.name ?? '미분류';
  const group = (range: Range) => {
    const parts = expenseParts(txs.filter((t) => inRange(t.date, range)), itemsByTx);
    const m = new Map<string, { total: number; txs: Set<string>; sub: Map<string, { total: number; txs: Set<string> }> }>();
    for (const p of parts) {
      const top = topCategoryId(p.category_id, cats);
      const e = m.get(top) ?? { total: 0, txs: new Set(), sub: new Map() };
      e.total += p.amount; e.txs.add(p.tx_id);
      const sid = p.category_id && p.category_id !== top ? p.category_id : top;
      const s = e.sub.get(sid) ?? { total: 0, txs: new Set() };
      s.total += p.amount; s.txs.add(p.tx_id);
      e.sub.set(sid, s); m.set(top, e);
    }
    return m;
  };
  const cur = group(r);
  const prevM = prev ? group(prev) : new Map();
  const total = [...cur.values()].reduce((s, e) => s + e.total, 0);
  return [...cur.entries()].map(([id, e]) => {
    const prevTotal = prevM.get(id)?.total ?? 0;
    return {
      id, name: id ? catName(id) : '미분류', total: e.total, count: e.txs.size, pct: total ? (e.total / total) * 100 : 0, prevTotal, changePct: pctChange(e.total, prevTotal),
      children: [...e.sub.entries()].map(([sid, s]) => ({ id: sid, name: sid === id ? `${id ? catName(id) : '미분류'}(기타)` : catName(sid), total: s.total, count: s.txs.size })).sort((a, b) => b.total - a.total),
    };
  }).sort((a, b) => b.total - a.total);
}

/** 가장 자주 가는 곳 (횟수 순, 같으면 금액 순) */
export function frequentPlaces(stats: MerchantStat[], limit = 5): MerchantStat[] {
  return [...stats].sort((a, b) => b.count - a.count || b.total - a.total).slice(0, limit);
}

export interface Leak { key: string; name: string; total: number; count: number; avg: number }
/**
 * 소액 반복 지출("새는 돈" 후보): 건당 금액이 limit 미만인 지출을 가맹점별로 묶어 3회 이상인 곳을 합계 큰 순으로.
 */
export function smallLeaks(txs: Tx[], r: Range, aliases?: AliasMap, limit = 10_000, minCount = 3): Leak[] {
  const m = new Map<string, Leak & { names: Map<string, number> }>();
  for (const t of expensesIn(txs, r)) {
    if (t.amount >= limit || !t.merchant?.trim()) continue;
    const k = groupKey(t.merchant, aliases);
    const e = m.get(k) ?? { key: k, name: '', total: 0, count: 0, avg: 0, names: new Map() };
    e.total += t.amount; e.count++;
    e.names.set(t.merchant, (e.names.get(t.merchant) ?? 0) + t.amount);
    m.set(k, e);
  }
  return [...m.values()].filter((e) => e.count >= minCount).map((e) => ({
    key: e.key, name: pickName(e.names, aliases), total: e.total, count: e.count, avg: Math.round(e.total / e.count),
  })).sort((a, b) => b.total - a.total);
}

export interface Subscription { key: string; name: string; amount: number; months: number; lastDate: string; nextDate: string; monthlyTotal: number }

/**
 * 구독·정기 결제 후보: 같은 가맹점에서 서로 다른 3개월 이상, 월 간격(25~35일)으로 비슷한 금액(±10%)이 반복.
 * 이미 고정 거래로 만든 것(recurring_id)도 포함한다.
 */
export function detectSubscriptions(txs: Tx[], aliases?: AliasMap, minMonths = 3): Subscription[] {
  const by = new Map<string, Tx[]>();
  for (const t of txs) {
    if (t.type !== 'expense' || !t.merchant?.trim()) continue;
    const k = groupKey(t.merchant, aliases);
    by.set(k, [...(by.get(k) ?? []), t]);
  }
  const out: Subscription[] = [];
  for (const [key, list] of by) {
    const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));
    // 월별로 하나씩만 센다
    const perMonth = new Map<string, Tx>();
    for (const t of sorted) if (!perMonth.has(t.date.slice(0, 7))) perMonth.set(t.date.slice(0, 7), t);
    const seq = [...perMonth.values()];
    if (seq.length < minMonths) continue;
    // 최근 연속 구간에서 금액·간격 검사
    let best: Tx[] = [];
    let run: Tx[] = [];
    for (const t of seq) {
      const last = run[run.length - 1];
      const gap = last ? (utc(t.date) - utc(last.date)) / dayMs : 0;
      const ref = run[0]?.amount ?? t.amount;
      if (!last || (gap >= 25 && gap <= 36 && Math.abs(t.amount - ref) <= ref * 0.1)) run.push(t);
      else run = [t];
      if (run.length >= best.length) best = [...run];
    }
    if (best.length < minMonths) continue;
    const amount = Math.round(sum(best) / best.length);
    const lastT = best[best.length - 1];
    const names = new Map<string, number>();
    for (const t of best) names.set(t.merchant as string, (names.get(t.merchant as string) ?? 0) + t.amount);
    out.push({
      key, name: pickName(names, aliases), amount, months: best.length, lastDate: lastT.date,
      nextDate: shiftDay(lastT.date, 30), monthlyTotal: amount,
    });
  }
  return out.sort((a, b) => b.amount - a.amount);
}

export interface Pattern { label: string; total: number; count: number }

export function weekdayPattern(txs: Tx[], r: Range): Pattern[] {
  const names = ['일', '월', '화', '수', '목', '금', '토'];
  const out = names.map((label) => ({ label, total: 0, count: 0 }));
  for (const t of expensesIn(txs, r)) { const w = out[weekdayOf(t.date)]; w.total += t.amount; w.count++; }
  return out;
}

/** 시각이 있는 거래만: 새벽(0-6) 아침(6-11) 점심(11-14) 오후(14-18) 저녁(18-22) 밤(22-24) */
export function hourPattern(txs: Tx[], r: Range): Pattern[] {
  const bands: [string, number, number][] = [['새벽', 0, 6], ['아침', 6, 11], ['점심', 11, 14], ['오후', 14, 18], ['저녁', 18, 22], ['밤', 22, 24]];
  const out = bands.map(([label]) => ({ label, total: 0, count: 0 }));
  for (const t of expensesIn(txs, r)) {
    if (!t.time) continue;
    const h = Number(t.time.slice(0, 2));
    const i = bands.findIndex(([, a, b]) => h >= a && h < b);
    if (i >= 0) { out[i].total += t.amount; out[i].count++; }
  }
  return out;
}

/** 월 초(1~10일) / 중(11~20일) / 말(21일~) */
export function monthPartPattern(txs: Tx[], r: Range): Pattern[] {
  const out = [{ label: '월초(1~10일)', total: 0, count: 0 }, { label: '월중(11~20일)', total: 0, count: 0 }, { label: '월말(21일~)', total: 0, count: 0 }];
  for (const t of expensesIn(txs, r)) { const d = Number(t.date.slice(8)); const p = out[d <= 10 ? 0 : d <= 20 ? 1 : 2]; p.total += t.amount; p.count++; }
  return out;
}

/** 고정비(고정 거래로 생성된 것 + 구독 후보 가맹점) vs 변동비 */
export function fixedVariable(txs: Tx[], r: Range, subs: Subscription[]): { fixed: number; variable: number; fixedPct: number } {
  const subKeys = new Set(subs.map((s) => s.key));
  let fixed = 0, variable = 0;
  for (const t of expensesIn(txs, r)) {
    const isFixed = t.source === 'recurring' || !!t.recurring_id || (!!t.merchant && subKeys.has(groupKey(t.merchant)));
    if (isFixed) fixed += t.amount; else variable += t.amount;
  }
  const total = fixed + variable;
  return { fixed, variable, fixedPct: total ? Math.round((fixed / total) * 1000) / 10 : 0 };
}

export const biggestExpenses = (txs: Tx[], r: Range, n = 5) =>
  [...expensesIn(txs, r)].sort((a, b) => b.amount - a.amount).slice(0, n);

/** 통장별 지출 */
export function accountExpense(txs: Tx[], r: Range): { account_id: string; total: number; count: number; pct: number }[] {
  const list = expensesIn(txs, r);
  const total = sum(list);
  const m = new Map<string, { account_id: string; total: number; count: number; pct: number }>();
  for (const t of list) { const e = m.get(t.account_id) ?? { account_id: t.account_id, total: 0, count: 0, pct: 0 }; e.total += t.amount; e.count++; m.set(t.account_id, e); }
  return [...m.values()].map((e) => ({ ...e, pct: total ? (e.total / total) * 100 : 0 })).sort((a, b) => b.total - a.total);
}

/** 가맹점 하나의 월별 지출 추이 (오래된 달부터 n개월) */
export function merchantMonthly(txs: Tx[], key: string, endMonth: string, n = 6, aliases?: AliasMap): { month: string; total: number; count: number }[] {
  const [ey, em] = endMonth.split('-').map(Number);
  const months = Array.from({ length: n }, (_, i) => { const d = new Date(ey, em - 1 - (n - 1 - i), 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; });
  const idx = new Map(months.map((m, i) => [m, i]));
  const out = months.map((month) => ({ month, total: 0, count: 0 }));
  for (const t of txs) {
    if (t.type !== 'expense' || !t.merchant || groupKey(t.merchant, aliases) !== key) continue;
    const i = idx.get(t.date.slice(0, 7));
    if (i !== undefined) { out[i].total += t.amount; out[i].count++; }
  }
  return out;
}

export interface Insights {
  total: number; prevTotal: number; changePct: number | null; days: number; dailyAvg: number; count: number;
  merchants: MerchantStat[]; categories: CategoryStat[]; frequent: MerchantStat[]; leaks: Leak[]; subscriptions: Subscription[];
  weekday: Pattern[]; hour: Pattern[]; monthPart: Pattern[]; fixed: ReturnType<typeof fixedVariable>; biggest: Tx[];
  accounts: ReturnType<typeof accountExpense>; lines: string[];
}

const won = (n: number) => `${Math.round(n).toLocaleString('ko-KR')}원`;

/** 숫자에서 뽑은 한 줄 해설 (AI 호출 없이 템플릿 문구) */
export function insightLines(i: Pick<Insights, 'total' | 'changePct' | 'merchants' | 'categories' | 'leaks' | 'subscriptions' | 'weekday' | 'fixed' | 'days'>, label: string): string[] {
  const out: string[] = [];
  if (i.total === 0) return ['이 기간에는 지출 기록이 없어요.'];
  const topCat = i.categories[0];
  if (topCat) out.push(`${label}엔 ${topCat.name}에 가장 많이 썼어요 (${won(topCat.total)}, ${topCat.pct.toFixed(0)}%).${topCat.children[0] && topCat.children.length > 1 ? ` 그중 ${topCat.children[0].name.replace(/\(기타\)$/, '')}이(가) 가장 커요.` : ''}`);
  const topM = i.merchants[0];
  if (topM) out.push(`가장 많이 쓴 곳은 ${topM.name} (${won(topM.total)}, ${topM.count}회, 건당 ${won(topM.avg)})예요.`);
  if (i.changePct !== null && Math.abs(i.changePct) >= 5) out.push(`직전 같은 기간보다 지출이 ${Math.abs(i.changePct).toFixed(0)}% ${i.changePct > 0 ? '늘었어요' : '줄었어요'}.`);
  const grew = [...i.categories].filter((c) => c.changePct !== null && c.prevTotal > 0 && c.total - c.prevTotal > 0).sort((a, b) => (b.total - b.prevTotal) - (a.total - a.prevTotal))[0];
  if (grew && grew.changePct !== null && grew.changePct >= 15) out.push(`${grew.name}이(가) ${won(grew.total - grew.prevTotal)} (${grew.changePct.toFixed(0)}%) 늘어난 게 눈에 띄어요.`);
  if (i.leaks[0]) out.push(`소액 반복 지출이 새는 돈 후보예요: ${i.leaks[0].name} ${i.leaks[0].count}회, 합계 ${won(i.leaks[0].total)}.`);
  if (i.subscriptions.length) out.push(`매달 빠져나가는 정기 결제로 보이는 곳이 ${i.subscriptions.length}곳(월 ${won(i.subscriptions.reduce((s, x) => s + x.amount, 0))})이에요.`);
  if (i.fixed.fixedPct >= 30) out.push(`지출의 ${i.fixed.fixedPct.toFixed(0)}%가 고정비예요.`);
  const wk = [...i.weekday].sort((a, b) => b.total - a.total)[0];
  if (wk && wk.total > 0 && i.days >= 14) out.push(`요일로는 ${wk.label}요일에 가장 많이 써요 (${won(wk.total)}).`);
  return out;
}

/** 한 번에 계산 (화면·비서 공용) */
export function computeInsights(txs: Tx[], cats: Category[], itemsByTx: Map<string, TxItem[]> | undefined, r: Range, prev: Range | null, aliases: AliasMap | undefined, label: string): Insights {
  const list = expensesIn(txs, r);
  const total = sum(list);
  const prevTotal = prev ? sum(expensesIn(txs, prev)) : 0;
  const merchants = merchantRanking(txs, r, prev, aliases);
  const subscriptions = detectSubscriptions(txs, aliases);
  const days = daysIn(r);
  const base = {
    total, prevTotal, changePct: pctChange(total, prevTotal), days, dailyAvg: Math.round(total / Math.max(days, 1)), count: list.length,
    merchants, categories: categoryRanking(txs, cats, itemsByTx, r, prev), frequent: frequentPlaces(merchants), leaks: smallLeaks(txs, r, aliases), subscriptions,
    weekday: weekdayPattern(txs, r), hour: hourPattern(txs, r), monthPart: monthPartPattern(txs, r), fixed: fixedVariable(txs, r, subscriptions),
    biggest: biggestExpenses(txs, r), accounts: accountExpense(txs, r),
  };
  return { ...base, lines: insightLines(base, label) };
}
