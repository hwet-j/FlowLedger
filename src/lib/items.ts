import type { Category, ItemInput, Tx, TxItem } from './types';

export const MAX_ITEMS = 100;
export const MAX_ITEM_NAME = 80;

export const itemsSum = (items: Pick<ItemInput, 'amount'>[]) => items.reduce((s, i) => s + i.amount, 0);

/** 품목 목록 검증. 문제가 있으면 사람이 읽을 오류 문장, 없으면 null. total 이 주어지면 합계 불변식(품목 합계 == 총액)도 본다 */
export function validateItems(items: ItemInput[], total?: number): string | null {
  if (items.length > MAX_ITEMS) return `품목은 최대 ${MAX_ITEMS}개까지예요`;
  for (const [i, it] of items.entries()) {
    if (!it.name.trim()) return `${i + 1}번째 품목의 이름이 비었어요`;
    if (it.name.trim().length > MAX_ITEM_NAME) return `품목 이름은 ${MAX_ITEM_NAME}자까지예요 (${i + 1}번째)`;
    if (!Number.isSafeInteger(it.amount) || it.amount === 0) return `${i + 1}번째 품목 금액이 올바르지 않아요`;
    if (!(it.qty > 0) || !Number.isFinite(it.qty)) return `${i + 1}번째 품목 수량이 올바르지 않아요`;
    if (it.unit_price !== null && !Number.isSafeInteger(it.unit_price)) return `${i + 1}번째 품목 단가가 올바르지 않아요`;
  }
  if (total !== undefined && items.length > 0) {
    const sum = itemsSum(items);
    if (sum !== total) return `품목 합계 ${sum.toLocaleString('ko-KR')}원 ≠ 총액 ${total.toLocaleString('ko-KR')}원`;
  }
  return null;
}

/** 수량 × 단가 (단가가 없으면 null). 반올림해 정수 원으로 */
export const lineTotal = (qty: number, unit: number | null) => (unit === null ? null : Math.round(qty * unit));

/** 품목 한 개의 단가: 입력된 단가가 있으면 그것, 없으면 금액/수량 */
export const unitPriceOf = (i: Pick<TxItem, 'qty' | 'unit_price' | 'amount'>) => i.unit_price ?? (i.qty > 0 ? Math.round(i.amount / i.qty) : i.amount);

/** 거래 id → 품목 목록 (sort 순) */
export function groupItems(items: TxItem[]): Map<string, TxItem[]> {
  const m = new Map<string, TxItem[]>();
  for (const i of items) {
    const l = m.get(i.transaction_id) ?? [];
    l.push(i);
    m.set(i.transaction_id, l);
  }
  for (const l of m.values()) l.sort((a, b) => a.sort - b.sort);
  return m;
}

export interface ExpensePart { tx_id: string; date: string; category_id: string | null; amount: number; account_id: string; merchant: string | null }

/**
 * 지출 거래를 분류별 "조각"으로 쪼갠다. 품목에 분류가 있으면 그 품목 금액을 그 분류로,
 * 분류가 없는 품목(과 품목 없는 거래)은 거래의 분류로 센다. 한 영수증이 식비/생활용품으로 갈라진다.
 * 조각 금액의 합 == 거래 금액 (품목 합계 불변식 덕분).
 */
export function expenseParts(txs: Tx[], itemsByTx: Map<string, TxItem[]> | undefined): ExpensePart[] {
  const out: ExpensePart[] = [];
  for (const t of txs) {
    if (t.type !== 'expense') continue;
    const items = itemsByTx?.get(t.id);
    const base = { tx_id: t.id, date: t.date, account_id: t.account_id, merchant: t.merchant };
    if (!items || items.length === 0) { out.push({ ...base, category_id: t.category_id, amount: t.amount }); continue; }
    const own = new Map<string | null, number>();
    for (const i of items) own.set(i.category_id ?? t.category_id, (own.get(i.category_id ?? t.category_id) ?? 0) + i.amount);
    for (const [cat, amount] of own) out.push({ ...base, category_id: cat, amount });
  }
  return out;
}

/** 품목 이름 정규화(공백·대소문자 무시) */
export const itemKey = (name: string) => name.replace(/\s+/g, '').toLowerCase();

export const itemCategoryName = (id: string | null, cats: Category[]) => (id ? cats.find((c) => c.id === id)?.name ?? '' : '');
