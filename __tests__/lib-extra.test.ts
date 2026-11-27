import { netWorth, netWorthTrend } from '../src/lib/accounts';
import { goalProgress } from '../src/lib/goals';
import { alertsDue, budgetStatus, monthlyReport, monthStats } from '../src/lib/stats';
import { accs, cats, tx } from './helpers';

describe('순자산', () => {
  test('자산/부채/순자산: 카드·대출은 음수 잔액이 부채', () => {
    const b = new Map([['a', 1_000_000], ['c', -200_000], ['l', -5_000_000], ['z', 0]]);
    expect(netWorth(b)).toEqual({ assets: 1_000_000, debt: 5_200_000, net: -4_200_000 });
  });
  test('대출 통장 종류와 시작 잔액', () => {
    const a = [{ id: 'l', initial_balance: -10_000_000 }, { id: 'b', initial_balance: 0 }];
    const t = [tx({ type: 'income', account_id: 'b', amount: 100 })];
    expect(netWorth(new Map([['l', -10_000_000], ['b', 100]])).net).toBe(-9_999_900);
    expect(a).toHaveLength(2);
    expect(t).toHaveLength(1);
  });
  test('월말 기준 추이: 현재에서 이후 거래를 되돌린다, 이체는 영향 없음', () => {
    const a = accs();
    const txs = [
      tx({ type: 'income', amount: 3_000_000, date: '2026-09-25', category_id: 'cat_salary' }),
      tx({ amount: 100_000, date: '2026-10-10' }),
      tx({ type: 'transfer', amount: 500_000, date: '2026-10-20', to_account_id: 'acc_cash', category_id: null }),
      tx({ amount: 40_000, date: '2026-11-05' }),
    ];
    const r = netWorthTrend(a, txs, '2026-11', 4);
    expect(r.map((x) => x.month)).toEqual(['2026-08', '2026-09', '2026-10', '2026-11']);
    const initial = 50_000; // 현금 시작 잔액
    expect(r[0].net).toBe(initial);
    expect(r[1].net).toBe(initial + 3_000_000);
    expect(r[2].net).toBe(initial + 3_000_000 - 100_000);
    expect(r[3].net).toBe(initial + 3_000_000 - 140_000);
  });
  test('연 경계', () => {
    const r = netWorthTrend(accs(), [], '2026-02', 4);
    expect(r.map((x) => x.month)).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
  });
});

describe('예산 알림', () => {
  const data = [tx({ amount: 85_000, date: '2026-11-03', category_id: 'cat_food_eat_out' }), tx({ amount: 60_000, date: '2026-11-04', category_id: 'cat_shop' })];
  const st = budgetStatus([
    { id: 'b1', category_id: 'cat_food', amount: 100_000 },
    { id: 'b2', category_id: 'cat_shop', amount: 50_000 },
    { id: 'b3', category_id: 'cat_hobby', amount: 50_000 },
  ], data, cats, '2026-11');
  test('80%/100% 도달 알림, 100% 초과면 80% 알림은 생략, 안 넘은 건 없음', () => {
    const a = alertsDue(st, '2026-11', new Set());
    expect(a.map((x) => x.key).sort()).toEqual(['2026-11:b1:80', '2026-11:b2:100']);
    expect(a.find((x) => x.key.endsWith('b2:100'))?.body).toContain('10,000원');
  });
  test('이미 보낸 키는 건너뛴다(중복 알림 방지), 다음 달은 다시', () => {
    expect(alertsDue(st, '2026-11', new Set(['2026-11:b1:80', '2026-11:b2:100']))).toEqual([]);
    expect(alertsDue(st, '2026-12', new Set(['2026-11:b1:80'])).length).toBe(2);
  });
});

describe('월간 리포트', () => {
  test('수입/지출/TOP/예산 텍스트', () => {
    const data = [tx({ amount: 12_000, category_id: 'cat_food_eat_out' }), tx({ type: 'income', amount: 100_000, category_id: 'cat_salary' }), tx({ amount: 5_000, date: '2026-10-10' })];
    const s = monthStats(data, cats, '2026-11');
    const bs = budgetStatus([{ id: 'b', category_id: null, amount: 10_000 }], data, cats, '2026-11');
    const text = monthlyReport(s, bs, '2026년 11월');
    expect(text).toContain('2026년 11월 가계부 리포트');
    expect(text).toContain('수입 100,000원');
    expect(text).toContain('지출 12,000원');
    expect(text).toContain('1. 식비 12,000원 (100%)');
    expect(text).toContain('⚠ 초과');
    expect(text).toContain('+7,000원 (+140%)');
  });
});

describe('저축 목표', () => {
  test('연결 통장 잔액으로 진행률, 음수는 0, 수동 입력액', () => {
    const b = new Map([['s', 300_000], ['n', -5]]);
    expect(goalProgress({ target: 1_000_000, account_id: 's', saved: 0, due_date: null }, b, '2026-11-27')).toMatchObject({ saved: 300_000, pct: 30, daysLeft: null });
    expect(goalProgress({ target: 100, account_id: 'n', saved: 0, due_date: null }, b, '2026-11-27').saved).toBe(0);
    expect(goalProgress({ target: 1000, account_id: null, saved: 250, due_date: null }, b, '2026-11-27').pct).toBe(25);
  });
  test('목표일까지 남은 일수와 월 필요액, 지난 목표일', () => {
    const b = new Map<string, number>();
    const g = { target: 1_200_000, account_id: null, saved: 0, due_date: '2027-11-27' };
    const r = goalProgress(g, b, '2026-11-27');
    expect(r.daysLeft).toBe(365);
    expect(r.perMonth).toBe(Math.ceil(1_200_000 / (365 / 30.4375)));
    expect(goalProgress({ ...g, due_date: '2026-11-20' }, b, '2026-11-27')).toMatchObject({ daysLeft: -7, perMonth: null });
  });
});
