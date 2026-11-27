import { biggestExpenses, categoryRanking, computeInsights, daysIn, detectSubscriptions, fixedVariable, frequentPlaces, hourPattern, merchantMonthly, merchantRanking, monthPartPattern, periodRange, smallLeaks, weekdayPattern } from '../src/lib/insights';
import { canonicalMerchant, groupKey, merchantKey, similarity, suggestMerges } from '../src/lib/merchants';
import type { TxItem } from '../src/lib/types';
import { cats, tx } from './helpers';

const R = { from: '2026-11-01', to: '2026-11-30' };
const P = { from: '2026-10-01', to: '2026-10-30' };

describe('가맹점 정규화', () => {
  test('지점·표기 변형이 같은 키로', () => {
    expect(merchantKey('스타벅스 강남점')).toBe(merchantKey('스타벅스'));
    expect(merchantKey('STARBUCKS')).toBe(merchantKey('스타벅스'));
    expect(merchantKey('스타벅스코리아')).toBe(merchantKey('스타벅스'));
    expect(merchantKey('(주)스타벅스')).toBe(merchantKey('스타벅스'));
    expect(merchantKey('GS25 역삼역점')).toBe('gs25');
    expect(merchantKey('Netflix')).toBe('넷플릭스');
  });
  test('짧은 이름은 지나치게 깎지 않는다', () => {
    expect(merchantKey('이마트')).toBe('이마트');
    expect(merchantKey('점')).toBe('점');
  });
  test('별칭이 자동 정규화보다 우선', () => {
    const aliases = new Map([[merchantKey('우리집 앞 카페'), '스타벅스']]);
    expect(canonicalMerchant('우리집 앞 카페', aliases)).toBe('스타벅스');
    expect(groupKey('우리집 앞 카페', aliases)).toBe(merchantKey('스타벅스'));
    expect(canonicalMerchant('김밥천국', aliases)).toBe('김밥천국');
  });
  test('유사도와 합치기 제안', () => {
    expect(similarity('스타벅스 강남점', '스타벅스')).toBe(1);
    expect(similarity('스타벅스리저브', '스타벅스')).toBeGreaterThanOrEqual(0.9);
    expect(similarity('김밥천국', '스타벅스')).toBeLessThan(0.5);
    const s = suggestMerges([{ name: '스타벅스', total: 5 }, { name: '스타벅스리저브', total: 3 }, { name: '이마트', total: 9 }, { name: 'emart', total: 1 }]);
    expect(s.map((x) => [x.a, x.b])).toEqual(expect.arrayContaining([['스타벅스', '스타벅스리저브']]));
    // 이미 합쳐진 쌍은 제안하지 않는다
    const merged = new Map([[merchantKey('스타벅스리저브'), '스타벅스']]);
    expect(suggestMerges([{ name: '스타벅스', total: 5 }, { name: '스타벅스리저브', total: 3 }], merged)).toEqual([]);
  });
});

describe('기간', () => {
  test('이번 달·지난달·3개월·올해와 직전 구간', () => {
    const now = new Date(2026, 10, 27);
    const m = periodRange('month', now);
    expect(m.range).toEqual({ from: '2026-11-01', to: '2026-11-27' });
    expect(m.prev).toEqual({ from: '2026-10-01', to: '2026-10-27' });
    expect(periodRange('lastMonth', now).range).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(periodRange('lastMonth', now).prev).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(periodRange('3m', now).range).toEqual({ from: '2026-09-01', to: '2026-11-27' });
    expect(periodRange('3m', now).prev).toEqual({ from: '2026-06-01', to: '2026-08-31' });
    expect(periodRange('year', now).range).toEqual({ from: '2026-01-01', to: '2026-11-27' });
    expect(periodRange('year', now).prev.to).toBe('2025-11-27');
  });
  test('3월 31일의 이번 달 직전 구간은 2월 말을 넘지 않는다', () => {
    const p = periodRange('month', new Date(2026, 2, 31));
    expect(p.prev).toEqual({ from: '2026-02-01', to: '2026-02-28' });
  });
  test('일수', () => expect(daysIn(R)).toBe(30));
});

describe('순위·분류', () => {
  const txs = [
    tx({ amount: 5000, merchant: '스타벅스 강남점', date: '2026-11-02', category_id: 'cat_food_cafe' }),
    tx({ amount: 6000, merchant: 'STARBUCKS', date: '2026-11-09', category_id: 'cat_food_cafe' }),
    tx({ amount: 4500, merchant: '스타벅스', date: '2026-11-16', category_id: 'cat_food_cafe' }),
    tx({ amount: 80_000, merchant: '무신사', date: '2026-11-12', category_id: 'cat_shop_clothes' }),
    tx({ amount: 12_000, merchant: '김밥천국', date: '2026-11-03', category_id: 'cat_food_eat_out' }),
    tx({ amount: 4000, merchant: '스타벅스', date: '2026-10-05', category_id: 'cat_food_cafe' }),
    tx({ amount: 60_000, merchant: '무신사', date: '2026-10-07', category_id: 'cat_shop_clothes' }),
    tx({ type: 'income', amount: 3_000_000, date: '2026-11-25', category_id: 'cat_salary', merchant: '월급' }),
    tx({ type: 'transfer', amount: 500_000, date: '2026-11-20', category_id: null, to_account_id: 'acc_cash' }),
  ];
  test('가맹점 순위: 표기 변형을 합치고 전 구간 대비', () => {
    const m = merchantRanking(txs, R, P);

    expect(m[0]).toMatchObject({ name: '무신사', total: 80_000, count: 1, prevTotal: 60_000 });
    expect(m.map((x) => x.name)).toEqual(['무신사', '스타벅스', '김밥천국']);
    expect(m[0].changePct).toBeCloseTo(33.3, 1);
    const sb = m.find((x) => x.name.includes('스타벅스'))!;
    expect(sb).toMatchObject({ total: 15_500, count: 3, avg: 5167 });
    expect(sb.changePct).toBe(287.5);
    expect(m.reduce((s, x) => s + x.pct, 0)).toBeCloseTo(100, 5);
    expect(m.some((x) => x.name === '월급')).toBe(false); // 수입 제외
  });
  test('분류 순위: 대분류 롤업, 소분류, 전 구간 대비, 품목 분류 반영', () => {
    const items: TxItem[] = [
      { id: 'i1', transaction_id: 'mart', name: '우유', qty: 1, unit_price: null, amount: 3000, category_id: null, sort: 0 },
      { id: 'i2', transaction_id: 'mart', name: '세제', qty: 1, unit_price: null, amount: 7000, category_id: 'cat_shop_living', sort: 1 },
    ];
    const withMart = [...txs, tx({ id: 'mart', amount: 10_000, merchant: '마트', date: '2026-11-14', category_id: 'cat_food_grocery' })];
    const c = categoryRanking(withMart, cats, new Map([['mart', items]]), R, P);
    expect(c.map((x) => x.name)).toEqual(['쇼핑', '식비']);
    expect(c[0].total).toBe(87_000); // 의류 80,000 + 세제 7,000
    expect(c[1].total).toBe(5000 + 6000 + 4500 + 12_000 + 3000);
    expect(c[0].prevTotal).toBe(60_000);
    expect(c[1].children[0].name).toBe('카페/간식');
    expect(c.reduce((s, x) => s + x.pct, 0)).toBeCloseTo(100, 5);
  });
  test('자주 가는 곳은 횟수 순', () => {
    expect(frequentPlaces(merchantRanking(txs, R, P))[0].name).toContain('스타벅스');
  });
  test('큰 지출 TOP', () => {
    expect(biggestExpenses(txs, R, 2).map((t) => t.amount)).toEqual([80_000, 12_000]);
  });
  test('빈 데이터', () => {
    const i = computeInsights([], cats, undefined, R, P, undefined, '이번 달');
    expect(i.total).toBe(0);
    expect(i.merchants).toEqual([]);
    expect(i.lines).toEqual(['이 기간에는 지출 기록이 없어요.']);
    expect(i.changePct).toBeNull();
  });
});

describe('새는 돈·구독·고정비', () => {
  const coffee = [2, 5, 9, 12].map((d) => tx({ amount: 4500, merchant: '이디야', date: `2026-11-${String(d).padStart(2, '0')}`, category_id: 'cat_food_cafe' }));
  test('소액 반복 지출', () => {
    const l = smallLeaks([...coffee, tx({ amount: 3000, merchant: '한번만', date: '2026-11-10' }), tx({ amount: 50_000, merchant: '큰거', date: '2026-11-11' })], R);
    expect(l).toHaveLength(1);
    expect(l[0]).toMatchObject({ name: '이디야', total: 18_000, count: 4, avg: 4500 });
  });
  const netflix = ['2026-08-15', '2026-09-14', '2026-10-15', '2026-11-14'].map((d, i) => tx({ amount: i === 3 ? 17_000 : 17_000, merchant: i % 2 ? 'NETFLIX' : '넷플릭스', date: d, category_id: 'cat_hobby_sub' }));
  test('구독 후보 감지: 월 간격·비슷한 금액·표기 변형', () => {
    const s = detectSubscriptions([...netflix, ...coffee]);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ name: '넷플릭스', amount: 17_000, months: 4, lastDate: '2026-11-14', nextDate: '2026-12-14' });
  });
  test('금액이 크게 흔들리거나 달이 건너뛰면 구독이 아니다', () => {
    const shaky = ['2026-08-15', '2026-09-14', '2026-10-15'].map((d, i) => tx({ amount: [10_000, 30_000, 12_000][i], merchant: '변동', date: d }));
    expect(detectSubscriptions(shaky)).toEqual([]);
    const gap = ['2026-05-15', '2026-08-14', '2026-11-15'].map((d) => tx({ amount: 9000, merchant: '분기', date: d }));
    expect(detectSubscriptions(gap)).toEqual([]);
    expect(detectSubscriptions(netflix.slice(0, 2))).toEqual([]);
  });
  test('고정비 vs 변동비', () => {
    const subs = detectSubscriptions(netflix);
    const txs = [...netflix, tx({ amount: 500_000, merchant: '월세', date: '2026-11-25', source: 'recurring', recurring_id: 'rc' }), tx({ amount: 30_000, merchant: '식당', date: '2026-11-20' })];
    const f = fixedVariable(txs, R, subs);
    expect(f).toEqual({ fixed: 517_000, variable: 30_000, fixedPct: 94.5 });
  });
});

describe('패턴', () => {
  const txs = [
    tx({ amount: 1000, date: '2026-11-02' }), // 월
    tx({ amount: 3000, date: '2026-11-07' }), // 토
    tx({ amount: 2000, date: '2026-11-14' }), // 토
    tx({ amount: 5000, date: '2026-11-25', time: '12:30' }),
    tx({ amount: 700, date: '2026-11-21', time: '23:40' }),
    tx({ amount: 900, date: '2026-11-03', time: '07:00' }),
  ];
  test('요일별', () => {
    const w = weekdayPattern(txs, R);
    expect(w.find((x) => x.label === '토')).toMatchObject({ total: 3000 + 2000 + 700, count: 3 });
    expect(w.find((x) => x.label === '월')?.total).toBe(1000);
  });
  test('시간대별은 시각 있는 거래만', () => {
    const h = hourPattern(txs, R);
    expect(h.find((x) => x.label === '점심')).toMatchObject({ total: 5000, count: 1 });
    expect(h.find((x) => x.label === '밤')?.total).toBe(700);
    expect(h.find((x) => x.label === '아침')?.total).toBe(900);
    expect(h.reduce((s, x) => s + x.count, 0)).toBe(3);
  });
  test('월 초·중·말', () => {
    const p = monthPartPattern(txs, R);
    expect(p.map((x) => x.total)).toEqual([1000 + 3000 + 900, 2000, 5000 + 700]);
  });
  test('가맹점 월별 추이', () => {
    const t = [tx({ amount: 100, merchant: '스타벅스 강남점', date: '2026-11-02' }), tx({ amount: 200, merchant: '스타벅스', date: '2026-09-02' }), tx({ amount: 999, merchant: '다른곳', date: '2026-11-02' })];
    const m = merchantMonthly(t, groupKey('스타벅스'), '2026-11', 3);
    expect(m).toEqual([{ month: '2026-09', total: 200, count: 1 }, { month: '2026-10', total: 0, count: 0 }, { month: '2026-11', total: 100, count: 1 }]);
  });
});

test('해설 문구: 늘어난 분류·소액 반복·정기 결제', () => {
  const t = [
    ...[2, 5, 9, 12].map((d) => tx({ amount: 4500, merchant: '이디야', date: `2026-11-${String(d).padStart(2, '0')}`, category_id: 'cat_food_cafe' })),
    tx({ amount: 100_000, merchant: '무신사', date: '2026-11-12', category_id: 'cat_shop_clothes' }),
    tx({ amount: 50_000, merchant: '무신사', date: '2026-10-12', category_id: 'cat_shop_clothes' }),
  ];
  const i = computeInsights(t, cats, undefined, R, P, undefined, '이번 달');
  const joined = i.lines.join('\n');
  expect(joined).toContain('쇼핑에 가장 많이 썼어요');
  expect(joined).toContain('가장 많이 쓴 곳은 무신사');
  expect(joined).toContain('늘었어요');
  expect(joined).toContain('이디야 4회');
});
