import { balances, resolveAccount, totalAssets } from '../src/lib/accounts';
import { addMonths, fmtDateLabel, isHm, isMonth, isYmd, monthRange } from '../src/lib/dates';
import { matchAccount, matchCategory, norm } from '../src/lib/match';
import { fmtShort, fmtSigned, fmtWon, parseAmount } from '../src/lib/money';
import { seedCategories } from '../src/lib/seed';
import { accs, cats, rule, tx } from './helpers';

describe('money', () => {
  test('포맷', () => {
    expect(fmtWon(1234567)).toBe('1,234,567원');
    expect(fmtWon(-5000)).toBe('-5,000원');
    expect(fmtWon(0)).toBe('0원');
    expect(fmtSigned(3000)).toBe('+3,000원');
    expect(fmtShort(12_000)).toBe('1.2만');
    expect(fmtShort(30_000)).toBe('3만');
    expect(fmtShort(250_000_000)).toBe('2.5억');
    expect(fmtShort(999)).toBe('999');
  });
  test('금액 입력 파싱: 숫자 외 제거, 비면 0, 안전 정수만', () => {
    expect(parseAmount('12,000원')).toBe(12000);
    expect(parseAmount('')).toBe(0);
    expect(parseAmount('abc')).toBe(0);
    expect(parseAmount('99999999999999999999')).toBe(0);
  });
});

describe('dates', () => {
  test('검증', () => {
    expect(isYmd('2026-02-29')).toBe(false);
    expect(isYmd('2028-02-29')).toBe(true);
    expect(isYmd('2026-1-1')).toBe(false);
    expect(isHm('23:59')).toBe(true);
    expect(isHm('24:00')).toBe(false);
    expect(isMonth('2026-13')).toBe(false);
  });
  test('월 계산', () => {
    expect(addMonths('2026-11', 2)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(monthRange('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
  });
  test('날짜 라벨', () => {
    const now = new Date(2026, 10, 27, 12);
    expect(fmtDateLabel('2026-11-27', now)).toBe('오늘 · 11월 27일 (금)');
    expect(fmtDateLabel('2026-11-26', now)).toBe('어제 · 11월 26일 (목)');
    expect(fmtDateLabel('2025-01-02', now)).toBe('2025년 1월 2일 (목)');
  });
});

describe('잔액', () => {
  test('초기 + 수입 − 지출, 이체는 양쪽 반영, 카드는 음수 가능', () => {
    const a = accs();
    const b = balances(a, [
      tx({ type: 'income', amount: 3_000_000, category_id: 'cat_salary' }),
      tx({ amount: 10_000 }),
      tx({ amount: 30_000, account_id: 'acc_card' }),
      tx({ type: 'transfer', amount: 100_000, account_id: 'acc_main', to_account_id: 'acc_cash', category_id: null }),
    ]);
    expect(b.get('acc_main')).toBe(3_000_000 - 10_000 - 100_000);
    expect(b.get('acc_card')).toBe(-30_000);
    expect(b.get('acc_cash')).toBe(150_000);
    expect(totalAssets(b)).toBe(2_890_000 - 30_000 + 150_000);
  });
  test('모르는 통장 id 는 무시', () => {
    const b = balances(accs(), [tx({ account_id: 'nope', amount: 5 })]);
    expect(b.get('acc_main')).toBe(0);
  });
});

describe('이름 매칭 규칙', () => {
  const a = accs();
  test('완전일치(공백·대소문자 무시) > 유일한 부분일치 > 모호/없음', () => {
    expect(matchAccount(a, ' 국민 카드 ')).toMatchObject({ ok: true, item: { id: 'acc_card' } });
    expect(matchAccount(a, '국민')).toMatchObject({ ok: true, item: { id: 'acc_card' } });
    expect(matchAccount(a, '통장')).toMatchObject({ ok: true, item: { id: 'acc_main' } }); // 보관된 '옛 통장'은 제외 → 유일
    expect(matchAccount(a, '없는통장')).toMatchObject({ ok: false, error: 'not_found' });
  });
  test('id 로도 찾는다', () => {
    expect(matchAccount(a, 'acc_cash')).toMatchObject({ ok: true, item: { name: '현금' } });
  });
  test('모호하면 후보를 돌려준다', () => {
    const two = [...a, { ...a[1], id: 'acc_card2', name: '신한카드' }];
    const r = matchAccount(two, '카드');
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.error).toBe('ambiguous'); expect(r.candidates.map((c) => c.id).sort()).toEqual(['acc_card', 'acc_card2']); }
  });
  test('카테고리: 소분류 이름 / 대분류>소분류 / 타입 구분', () => {
    expect(matchCategory(cats, '외식', 'expense')).toMatchObject({ ok: true, item: { id: 'cat_food_eat_out' } });
    expect(matchCategory(cats, '식비>배달', 'expense')).toMatchObject({ ok: true, item: { id: 'cat_food_delivery' } });
    expect(matchCategory(cats, '식비', 'expense')).toMatchObject({ ok: true, item: { id: 'cat_food' } });
    expect(matchCategory(cats, '급여', 'income')).toMatchObject({ ok: true, item: { id: 'cat_salary' } });
    expect(matchCategory(cats, '급여', 'expense')).toMatchObject({ ok: false, error: 'not_found' });
  });
  test('"운동" 처럼 겹치는 이름이 없도록 시드 이름은 타입별로 유일', () => {
    for (const type of ['expense', 'income'] as const) {
      const names = seedCategories().filter((c) => c.type === type).map((c) => norm(c.name));
      expect(new Set(names).size).toBe(names.length);
    }
  });
});

describe('통장 자동 지정 (명시 > 규칙 > 기본)', () => {
  const a = accs();
  const base = { accounts: a, categories: cats };
  test('명시한 통장이 최우선', () => {
    const r = resolveAccount({ ...base, explicitId: 'acc_cash', rules: [rule({ keyword: '넷플릭스', account_id: 'acc_card' })], merchant: '넷플릭스' });
    expect(r).toMatchObject({ source: 'explicit', account: { id: 'acc_cash' } });
  });
  test('규칙: 가맹점/메모/카테고리 이름', () => {
    const rules = [rule({ keyword: '넷플릭스', match: 'merchant' }), rule({ keyword: '구독', match: 'category', account_id: 'acc_cash' })];
    expect(resolveAccount({ ...base, rules, merchant: '넷플릭스 월정액' })).toMatchObject({ source: 'rule', account: { id: 'acc_card' } });
    expect(resolveAccount({ ...base, rules, categoryId: 'cat_hobby_sub' })).toMatchObject({ source: 'rule', account: { id: 'acc_cash' } });
    expect(resolveAccount({ ...base, rules, merchant: '편의점' })).toMatchObject({ source: 'default', account: { id: 'acc_main' } });
  });
  test('match 범위가 지켜진다(merchant 규칙은 메모에 안 걸림)', () => {
    const rules = [rule({ keyword: '넷플릭스', match: 'merchant' })];
    expect(resolveAccount({ ...base, rules, memo: '넷플릭스' }).source).toBe('default');
    expect(resolveAccount({ ...base, rules: [rule({ keyword: '넷플릭스', match: 'any' })], memo: '넷플릭스' }).source).toBe('rule');
  });
  test('여러 규칙: 긴 keyword 우선, 동률이면 먼저 만든 규칙', () => {
    const r1 = rule({ keyword: '스타', account_id: 'acc_cash', created_at: '2026-01-01' });
    const r2 = rule({ keyword: '스타벅스', account_id: 'acc_card', created_at: '2026-02-01' });
    expect(resolveAccount({ ...base, rules: [r1, r2], merchant: '스타벅스 강남' }).account?.id).toBe('acc_card');
    const e1 = rule({ keyword: '카페', account_id: 'acc_cash', created_at: '2026-03-01' });
    const e2 = rule({ keyword: '카페', account_id: 'acc_card', created_at: '2026-01-01' });
    expect(resolveAccount({ ...base, rules: [e1, e2], merchant: '카페' }).account?.id).toBe('acc_card');
  });
  test('규칙이 가리키는 통장이 보관됐으면 건너뛴다', () => {
    const r = resolveAccount({ ...base, rules: [rule({ keyword: '옛', account_id: 'acc_old' })], merchant: '옛날 가게' });
    expect(r.source).toBe('default');
  });
  test('기본 통장이 없거나 보관되면 첫 활성 통장', () => {
    const noDef = a.map((x) => ({ ...x, is_default: 0 }));
    expect(resolveAccount({ accounts: noDef, categories: cats, rules: [] }).account?.id).toBe('acc_main');
    expect(resolveAccount({ accounts: [], categories: cats, rules: [] }).account).toBeNull();
  });
  test('공백·대소문자 무시', () => {
    expect(resolveAccount({ ...base, rules: [rule({ keyword: 'GS 25', match: 'merchant' })], merchant: 'gs25 역삼점' }).source).toBe('rule');
  });
});
