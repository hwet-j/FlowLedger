import { budgetStatus, byAccount, byWeekday, dailyAllowance, monthStats, topCategoryId, topMerchants, trend } from '../src/lib/stats';
import { filterTxs, groupByDate } from '../src/lib/filter';
import { cats, tx } from './helpers';

const data = [
  tx({ amount: 12_000, date: '2026-11-03', category_id: 'cat_food_eat_out', merchant: '김밥천국' }),
  tx({ amount: 8_000, date: '2026-11-04', category_id: 'cat_food_cafe', merchant: '스타벅스' }),
  tx({ amount: 5_000, date: '2026-11-05', category_id: 'cat_food_cafe', merchant: '스타 벅스' }),
  tx({ amount: 60_000, date: '2026-11-07', category_id: 'cat_shop_clothes', merchant: '무신사', account_id: 'acc_card' }),
  tx({ amount: 20_000, date: '2026-11-08', category_id: 'cat_hobby', merchant: null }),
  tx({ amount: 7_000, date: '2026-11-09', category_id: null }),
  tx({ type: 'income', amount: 3_000_000, date: '2026-11-25', category_id: 'cat_salary' }),
  tx({ type: 'transfer', amount: 500_000, date: '2026-11-26', category_id: null, to_account_id: 'acc_cash' }),
  tx({ amount: 40_000, date: '2026-10-12', category_id: 'cat_food_eat_out' }),
  tx({ amount: 10_000, date: '2026-10-13', category_id: 'cat_shop_clothes' }),
];

describe('월 통계', () => {
  const s = monthStats(data, cats, '2026-11');
  test('수입/지출/수지, 이체는 제외', () => {
    expect(s.expense).toBe(12_000 + 8_000 + 5_000 + 60_000 + 20_000 + 7_000);
    expect(s.income).toBe(3_000_000);
    expect(s.net).toBe(3_000_000 - 112_000);
    expect(s.count).toBe(8);
  });
  test('대분류로 합산(소분류 포함), 큰 순서, 비율', () => {
    expect(s.byCategory.map((c) => [c.name, c.total])).toEqual([['쇼핑', 60_000], ['식비', 25_000], ['취미/여가', 20_000], ['미분류', 7_000]]);
    expect(s.byCategory[0].pct).toBeCloseTo((60_000 / 112_000) * 100);
    const food = s.byCategory.find((c) => c.name === '식비')!;
    expect(food.children.map((c) => [c.name, c.total])).toEqual([['카페/간식', 13_000], ['외식', 12_000]]);
    expect(food.count).toBe(3);
  });
  test('대분류에 직접 기록한 항목은 "(기타)" 소분류로', () => {
    const hobby = s.byCategory.find((c) => c.name === '취미/여가')!;
    expect(hobby.children[0].name).toBe('취미/여가(기타)');
  });
  test('전월 대비', () => {
    expect(s.prevExpense).toBe(50_000);
    expect(s.expenseDelta).toBe(62_000);
    expect(s.expenseDeltaPct).toBeCloseTo(124);
    expect(monthStats(data, cats, '2026-09').expenseDeltaPct).toBeNull();
  });
  test('연 통계: YYYY 로 부르면 전년 대비', () => {
    const y = monthStats(data, cats, '2026');
    expect(y.expense).toBe(112_000 + 50_000);
    expect(y.prevExpense).toBe(0);
    expect(y.expenseDeltaPct).toBeNull();
  });
  test('빈 달', () => {
    const e = monthStats([], cats, '2026-11');
    expect(e).toMatchObject({ income: 0, expense: 0, net: 0, byCategory: [] });
  });
  test('topCategoryId', () => {
    expect(topCategoryId('cat_food_cafe', cats)).toBe('cat_food');
    expect(topCategoryId('cat_food', cats)).toBe('cat_food');
    expect(topCategoryId(null, cats)).toBe('');
    expect(topCategoryId('nope', cats)).toBe('');
  });
});

describe('추이·계좌·요일·가맹점', () => {
  test('최근 12개월 추이(연 경계, 빈 달 0)', () => {
    const t = trend(data, '2026-11', 12);
    expect(t).toHaveLength(12);
    expect(t[0].month).toBe('2025-12');
    expect(t[11]).toMatchObject({ month: '2026-11', income: 3_000_000, expense: 112_000 });
    expect(t[10]).toMatchObject({ month: '2026-10', expense: 50_000 });
    expect(t[5]).toMatchObject({ income: 0, expense: 0 });
  });
  test('계좌별', () => {
    expect(byAccount(data, '2026-11')).toEqual([
      { account_id: 'acc_main', expense: 52_000, income: 3_000_000 },
      { account_id: 'acc_card', expense: 60_000, income: 0 },
    ].sort((a, b) => b.expense - a.expense));
  });
  test('요일별 합계 (2026-11-03 = 화)', () => {
    const w = byWeekday(data, '2026-11');
    expect(w[2].total).toBe(12_000); // 11/03 화
    expect(w.reduce((s, x) => s + x.total, 0)).toBe(112_000);
  });
  test('상위 가맹점: 공백 무시 합산, 빈 가맹점 제외', () => {
    const m = topMerchants(data, '2026-11', 3);
    expect(m[0]).toEqual({ merchant: '무신사', total: 60_000, count: 1 });
    expect(m[1]).toMatchObject({ total: 13_000, count: 2 });
  });
});

describe('예산', () => {
  const budgets = [
    { id: 'b0', category_id: null, amount: 100_000 },
    { id: 'b1', category_id: 'cat_food', amount: 30_000 },
    { id: 'b2', category_id: 'cat_food_cafe', amount: 20_000 },
    { id: 'b3', category_id: 'cat_shop', amount: 60_000 },
  ];
  const st = budgetStatus(budgets, data, cats, '2026-11');
  test('전체/대분류(소분류 포함)/소분류, 상태 단계', () => {
    const by = (id: string) => st.find((s) => s.budget.id === id)!;
    expect(by('b0')).toMatchObject({ spent: 112_000, level: 'over', label: '이번 달 전체' });
    expect(by('b1')).toMatchObject({ spent: 25_000, level: 'warn' });
    expect(by('b2')).toMatchObject({ spent: 13_000, level: 'ok' });
    expect(by('b3')).toMatchObject({ spent: 60_000, level: 'over', remaining: 0 });
    expect(st[0].budget.id).toBe('b0'); // 전체 예산이 맨 위
  });
  test('80% 이상이면 warn', () => {
    const s = budgetStatus([{ id: 'x', category_id: 'cat_food', amount: 30_000 }], data, cats, '2026-11')[0];
    expect(s.level).toBe('warn');
    expect(s.pct).toBeCloseTo(83.33, 1);
  });
  test('하루 사용 가능 금액', () => {
    expect(dailyAllowance(300_000, '2026-11-21', '2026-11')).toBe(30_000); // 11/21~30 = 10일
    expect(dailyAllowance(300_000, '2026-12-01', '2026-11')).toBeNull();
  });
});

describe('검색·필터·그룹', () => {
  const list = [...data];
  test('검색어: 가맹점/메모/카테고리 이름/금액', () => {
    expect(filterTxs(list, { query: '스타벅스' }, cats)).toHaveLength(2); // 공백 무시라 '스타 벅스' 도 포함
  });
  test('공백 무시 검색은 둘 다', () => {
    expect(filterTxs(list, { query: '스타 벅스' }, cats).map((t) => t.amount).sort()).toEqual([5_000, 8_000]);
  });
  test('카테고리 이름·금액으로 검색', () => {
    expect(filterTxs(list, { query: '카페' }, cats)).toHaveLength(2);
    expect(filterTxs(list, { query: '60,000' }, cats).map((t) => t.merchant)).toEqual(['무신사']);
  });
  test('필터: 계좌(이체는 양쪽), 카테고리(소분류 포함), 유형, 기간', () => {
    expect(filterTxs(list, { accountId: 'acc_cash' }, cats)).toHaveLength(1);
    expect(filterTxs(list, { categoryId: 'cat_food' }, cats)).toHaveLength(4);
    expect(filterTxs(list, { type: 'income' }, cats)).toHaveLength(1);
    expect(filterTxs(list, { from: '2026-11-05', to: '2026-11-08' }, cats)).toHaveLength(3);
  });
  test('날짜별 묶음: 내림차순, 일 합계(이체 제외)', () => {
    const g = groupByDate([
      tx({ date: '2026-11-02', amount: 100 }), tx({ date: '2026-11-02', type: 'income', amount: 400 }),
      tx({ date: '2026-11-02', type: 'transfer', amount: 9_999, category_id: null, to_account_id: 'acc_cash' }),
      tx({ date: '2026-11-05', amount: 7 }),
    ]);
    expect(g.map((x) => x.date)).toEqual(['2026-11-05', '2026-11-02']);
    expect(g[1].net).toBe(300);
    expect(g[1].items).toHaveLength(3);
  });
});
