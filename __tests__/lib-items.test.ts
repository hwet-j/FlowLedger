import { itemsToCsv } from '../src/lib/csv';
import { expenseParts, groupItems, itemsSum, lineTotal, unitPriceOf, validateItems } from '../src/lib/items';
import { byMerchant, filterPurchases, itemStats, priceHistory, purchaseRows } from '../src/lib/purchases';
import { budgetStatus, monthStats } from '../src/lib/stats';
import type { ItemInput, TxItem } from '../src/lib/types';
import { cats, tx } from './helpers';

const it = (p: Partial<ItemInput> = {}): ItemInput => ({ name: '우유', qty: 1, unit_price: null, amount: 2_980, category_id: null, ...p });
const row = (txId: string, p: Partial<TxItem> = {}, n = 0): TxItem => ({ id: `i${txId}${n}`, transaction_id: txId, name: '우유', qty: 1, unit_price: null, amount: 2_980, category_id: null, sort: n, ...p });

describe('품목 검증', () => {
  test('합계 불변식', () => {
    expect(validateItems([it({ amount: 3_000 }), it({ name: '빵', amount: 2_000 })], 5_000)).toBeNull();
    expect(validateItems([it({ amount: 3_000 })], 5_000)).toBe('품목 합계 3,000원 ≠ 총액 5,000원');
    expect(validateItems([], 5_000)).toBeNull(); // 품목 0개는 기존 동작 그대로
  });
  test('할인/쿠폰 줄은 음수 허용', () => {
    const l = [it({ amount: 10_000 }), it({ name: '쿠폰', amount: -1_000 })];
    expect(itemsSum(l)).toBe(9_000);
    expect(validateItems(l, 9_000)).toBeNull();
  });
  test('이름·금액·수량·개수 검사', () => {
    expect(validateItems([it({ name: '  ' })])).toContain('이름');
    expect(validateItems([it({ name: 'x'.repeat(81) })])).toContain('80자');
    expect(validateItems([it({ amount: 0 })])).toContain('금액');
    expect(validateItems([it({ amount: 1.5 })])).toContain('금액');
    expect(validateItems([it({ qty: 0 })])).toContain('수량');
    expect(validateItems(Array.from({ length: 101 }, () => it()))).toContain('100개');
  });
  test('수량×단가, 단가 계산', () => {
    expect(lineTotal(3, 1_200)).toBe(3_600);
    expect(lineTotal(0.5, 3_001)).toBe(1_501);
    expect(lineTotal(2, null)).toBeNull();
    expect(unitPriceOf({ qty: 2, unit_price: null, amount: 5_000 })).toBe(2_500);
    expect(unitPriceOf({ qty: 2, unit_price: 2_400, amount: 5_000 })).toBe(2_400);
  });
});

describe('품목 반영 통계', () => {
  // 마트 영수증 30,000원: 식비 18,000(장보기) + 생활용품 14,000 − 쿠폰 2,000(분류 없음 → 거래 분류 식비>장보기)
  const receipt = tx({ id: 'r1', amount: 30_000, date: '2026-11-10', category_id: 'cat_food_grocery', merchant: '이마트' });
  const other = tx({ id: 'r2', amount: 10_000, date: '2026-11-11', category_id: 'cat_food_eat_out' });
  const items = groupItems([
    row('r1', { name: '삼겹살', amount: 18_000, category_id: 'cat_food_grocery' }, 0),
    row('r1', { name: '세제', amount: 14_000, category_id: 'cat_shop_living' }, 1),
    row('r1', { name: '쿠폰', amount: -2_000, category_id: null }, 2),
  ]);
  test('expenseParts: 합이 거래 금액과 같고 분류별로 쪼개진다', () => {
    const parts = expenseParts([receipt, other], items);
    expect(parts.filter((p) => p.tx_id === 'r1').reduce((s, p) => s + p.amount, 0)).toBe(30_000);
    expect(parts.find((p) => p.tx_id === 'r1' && p.category_id === 'cat_shop_living')?.amount).toBe(14_000);
    expect(parts.find((p) => p.tx_id === 'r1' && p.category_id === 'cat_food_grocery')?.amount).toBe(16_000); // 18,000 − 쿠폰 2,000
    expect(parts.find((p) => p.tx_id === 'r2')?.category_id).toBe('cat_food_eat_out');
  });
  test('월 통계: 대분류 합산이 품목 분류를 따른다', () => {
    const s = monthStats([receipt, other], cats, '2026-11', items);
    expect(s.expense).toBe(40_000);
    expect(s.byCategory.map((c) => [c.name, c.total])).toEqual([['식비', 26_000], ['쇼핑', 14_000]]);
    expect(s.byCategory[1].children[0]).toMatchObject({ name: '생활용품', total: 14_000 });
    // 품목 정보가 없으면 기존처럼 거래 분류로만
    expect(monthStats([receipt, other], cats, '2026-11').byCategory.map((c) => [c.name, c.total])).toEqual([['식비', 40_000]]);
  });
  test('예산 진행도 같은 규칙', () => {
    const st = budgetStatus([{ id: 'b', category_id: 'cat_shop', amount: 20_000 }, { id: 'f', category_id: 'cat_food', amount: 30_000 }], [receipt, other], cats, '2026-11', items);
    expect(st.find((x) => x.budget.id === 'b')).toMatchObject({ spent: 14_000, level: 'ok' });
    expect(st.find((x) => x.budget.id === 'f')).toMatchObject({ spent: 26_000, level: 'warn' });
  });
  test('수입·이체는 조각에 없다', () => {
    expect(expenseParts([tx({ type: 'income' }), tx({ type: 'transfer', category_id: null, to_account_id: 'acc_cash' })], undefined)).toEqual([]);
  });
});

describe('구매 내역', () => {
  const t1 = tx({ id: 'p1', date: '2026-09-01', merchant: '이마트', amount: 3_100 });
  const t2 = tx({ id: 'p2', date: '2026-10-01', merchant: '쿠팡', amount: 2_500 });
  const t3 = tx({ id: 'p3', date: '2026-11-01', merchant: '이마트', amount: 6_000 + 1_500 });
  const inc = tx({ id: 'p4', type: 'income', amount: 100, category_id: 'cat_salary' });
  const items = [
    row('p1', { name: '우유 1L', amount: 3_100 }), row('p2', { name: '우유 1L', amount: 2_500 }),
    row('p3', { name: '우유 1L', qty: 2, amount: 6_000 }), row('p3', { name: '라면', amount: 1_500, category_id: 'cat_food_grocery' }, 1),
    row('p4', { name: '월급' }),
  ];
  const rows = purchaseRows([t1, t2, t3, inc], items);
  test('지출 거래의 품목만, 최근 순', () => {
    expect(rows).toHaveLength(4);
    expect(rows[0].date).toBe('2026-11-01');
    expect(rows.every((r) => r.name !== '월급')).toBe(true);
  });
  test('검색(공백·대소문자 무시)·기간·가맹점·분류 필터', () => {
    expect(filterPurchases(rows, { text: '우유' }, cats)).toHaveLength(3);
    expect(filterPurchases(rows, { text: '우 유 1l' }, cats)).toHaveLength(3);
    expect(filterPurchases(rows, { from: '2026-10-01', to: '2026-10-31' }, cats)).toHaveLength(1);
    expect(filterPurchases(rows, { merchant: '이마트' }, cats)).toHaveLength(3);
    expect(filterPurchases(rows, { categoryId: 'cat_food' }, cats).map((r) => r.name).sort()).toEqual(['라면', '우유 1L', '우유 1L', '우유 1L'].sort());
  });
  test('누적 금액/횟수 TOP, 최근 구입가', () => {
    const st = itemStats(rows);
    expect(st[0]).toMatchObject({ name: '우유 1L', total: 11_600, count: 3, qty: 4, lastDate: '2026-11-01', lastUnit: 3_000, lastMerchant: '이마트' });
    expect(st[1]).toMatchObject({ name: '라면', total: 1_500 });
  });
  test('가격 추이(단가, 오래된 순)와 최저/최고/최근', () => {
    const h = priceHistory(rows, '우유 1l')!;
    expect(h.points.map((p) => [p.date, p.unit])).toEqual([['2026-09-01', 3_100], ['2026-10-01', 2_500], ['2026-11-01', 3_000]]);
    expect(h).toMatchObject({ min: 2_500, max: 3_100, last: 3_000, avg: 2_867 });
    expect(priceHistory(rows, '없는품목')).toBeNull();
  });
  test('가맹점별 구매', () => {
    expect(byMerchant(rows)).toEqual([{ merchant: '이마트', total: 10_600, count: 3 }, { merchant: '쿠팡', total: 2_500, count: 1 }]);
  });
  test('품목 CSV: BOM, 분류 대/소, 날짜순', () => {
    const csv = itemsToCsv([t1, t3], items, cats);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('날짜,가맹점,품목,수량,단가,금액,대분류,소분류');
    expect(csv).toContain('2026-11-01,이마트,라면,1,,1500,식비,장보기');
    expect(csv.indexOf('2026-09-01')).toBeLessThan(csv.indexOf('2026-11-01'));
  });
});
