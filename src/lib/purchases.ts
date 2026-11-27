import { itemKey, unitPriceOf } from './items';
import type { Category, Tx, TxItem } from './types';

export interface PurchaseRow {
  item_id: string;
  tx_id: string;
  date: string;
  merchant: string | null;
  name: string;
  qty: number;
  unit_price: number; // 단가 (입력값 또는 금액/수량)
  amount: number;
  category_id: string | null; // 품목 분류 또는 거래 분류
  account_id: string;
}

/** 거래 + 품목 → 구매 행(최근 순) */
export function purchaseRows(txs: Tx[], items: TxItem[]): PurchaseRow[] {
  const byId = new Map(txs.map((t) => [t.id, t]));
  const rows: PurchaseRow[] = [];
  for (const i of items) {
    const t = byId.get(i.transaction_id);
    if (!t || t.type !== 'expense') continue;
    rows.push({
      item_id: i.id, tx_id: t.id, date: t.date, merchant: t.merchant, name: i.name, qty: i.qty,
      unit_price: unitPriceOf(i), amount: i.amount, category_id: i.category_id ?? t.category_id, account_id: t.account_id,
    });
  }
  return rows.sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name));
}

export interface PurchaseFilter { text?: string; from?: string; to?: string; merchant?: string | null; categoryId?: string | null }

export function filterPurchases(rows: PurchaseRow[], f: PurchaseFilter, cats: Category[]): PurchaseRow[] {
  const q = itemKey(f.text ?? '');
  const catIds = f.categoryId ? new Set([f.categoryId, ...cats.filter((c) => c.parent_id === f.categoryId).map((c) => c.id)]) : null;
  const mk = f.merchant ? itemKey(f.merchant) : '';
  return rows.filter((r) =>
    (!q || itemKey(r.name).includes(q)) && (!f.from || r.date >= f.from) && (!f.to || r.date <= f.to) &&
    (!mk || itemKey(r.merchant ?? '') === mk) && (!catIds || (r.category_id !== null && catIds.has(r.category_id))));
}

export interface ItemStat { key: string; name: string; total: number; count: number; qty: number; lastDate: string; lastUnit: number; lastMerchant: string | null }

/** 품목별 누적 금액/횟수/최근 구입가. 금액 큰 순 */
export function itemStats(rows: PurchaseRow[]): ItemStat[] {
  const m = new Map<string, ItemStat>();
  for (const r of rows) { // rows 는 최근 순이므로 처음 만난 행이 가장 최근
    const k = itemKey(r.name);
    const s = m.get(k);
    if (!s) m.set(k, { key: k, name: r.name, total: r.amount, count: 1, qty: r.qty, lastDate: r.date, lastUnit: r.unit_price, lastMerchant: r.merchant });
    else { s.total += r.amount; s.count += 1; s.qty += r.qty; }
  }
  return [...m.values()].sort((a, b) => b.total - a.total || b.count - a.count);
}

export interface PricePoint { date: string; unit: number; merchant: string | null }

/** 한 품목의 가격 추이 (오래된 순) + 최저/최고/최근 */
export function priceHistory(rows: PurchaseRow[], name: string): { points: PricePoint[]; min: number; max: number; last: number; avg: number } | null {
  const k = itemKey(name);
  const pts = rows.filter((r) => itemKey(r.name) === k && r.amount > 0).map((r) => ({ date: r.date, unit: r.unit_price, merchant: r.merchant }))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!pts.length) return null;
  const units = pts.map((p) => p.unit);
  return { points: pts, min: Math.min(...units), max: Math.max(...units), last: pts[pts.length - 1].unit, avg: Math.round(units.reduce((s, v) => s + v, 0) / units.length) };
}

/** 가맹점별 구매 금액 */
export function byMerchant(rows: PurchaseRow[]): { merchant: string; total: number; count: number }[] {
  const m = new Map<string, { merchant: string; total: number; count: number }>();
  for (const r of rows) {
    const label = r.merchant?.trim() || '(가맹점 없음)';
    const k = itemKey(label);
    const s = m.get(k) ?? { merchant: label, total: 0, count: 0 };
    s.total += r.amount;
    s.count += 1;
    m.set(k, s);
  }
  return [...m.values()].sort((a, b) => b.total - a.total);
}
