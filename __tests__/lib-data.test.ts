import { makeBackup, parseBackup, validateBackup } from '../src/lib/backup';
import { toCsv } from '../src/lib/csv';
import { dueRuns, nextRun, runDate } from '../src/lib/recurring';
import { DEFAULT_ACCOUNT_ID, seedAccounts, seedCategories } from '../src/lib/seed';
import { accs, cats, NOW, tx } from './helpers';

describe('고정 거래', () => {
  const r = { id: 'rec1', day: 31, start_date: '2026-01-31', end_date: null as string | null, last_run: null as string | null, active: 1 };
  test('말일 보정', () => {
    expect(runDate('2026-02', 31)).toBe('2026-02-28');
    expect(runDate('2028-02', 30)).toBe('2028-02-29');
    expect(runDate('2026-04', 31)).toBe('2026-04-30');
  });
  test('밀린 달을 한꺼번에 따라잡고, 오늘 이후는 만들지 않는다', () => {
    const d = dueRuns(r, '2026-04-15');
    expect(d.map((x) => x.date)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
    expect(d[0].ref).toBe('rec1:2026-01-31');
  });
  test('last_run 이후만 (멱등)', () => {
    expect(dueRuns({ ...r, last_run: '2026-02-28' }, '2026-04-15').map((x) => x.date)).toEqual(['2026-03-31']);
    expect(dueRuns({ ...r, last_run: '2026-03-31' }, '2026-04-15')).toEqual([]);
  });
  test('오늘이 실행일이면 포함, 시작일 이전 달/종료일 이후는 제외', () => {
    expect(dueRuns({ ...r, day: 10, start_date: '2026-03-20' }, '2026-04-10').map((x) => x.date)).toEqual(['2026-04-10']);
    expect(dueRuns({ ...r, day: 10, start_date: '2026-01-01', end_date: '2026-02-15' }, '2026-06-01').map((x) => x.date)).toEqual(['2026-01-10', '2026-02-10']);
  });
  test('비활성/잘못된 날짜', () => {
    expect(dueRuns({ ...r, active: 0 }, '2026-06-01')).toEqual([]);
    expect(dueRuns({ ...r, start_date: 'bad' }, '2026-06-01')).toEqual([]);
  });
  test('연 경계와 120개 상한', () => {
    expect(dueRuns({ ...r, day: 5, start_date: '2025-11-01' }, '2026-02-05').map((x) => x.date)).toEqual(['2025-11-05', '2025-12-05', '2026-01-05', '2026-02-05']);
    expect(dueRuns({ ...r, day: 5, start_date: '2000-01-01' }, '2026-11-27').length).toBe(120);
  });
  test('다음 실행일', () => {
    expect(nextRun({ day: 25, start_date: '2026-01-01', end_date: null, active: 1 }, '2026-11-27')).toBe('2026-12-25');
    expect(nextRun({ day: 28, start_date: '2026-01-01', end_date: null, active: 1 }, '2026-11-27')).toBe('2026-11-28');
    expect(nextRun({ day: 25, start_date: '2026-01-01', end_date: '2026-11-30', active: 1 }, '2026-11-27')).toBeNull();
    expect(nextRun({ day: 25, start_date: '2027-03-01', end_date: null, active: 1 }, '2026-11-27')).toBe('2027-03-25');
  });
});

describe('CSV', () => {
  const rows = [
    tx({ date: '2026-11-02', time: '12:30', amount: 9000, category_id: 'cat_food_eat_out', merchant: '김밥, "천국"', memo: '줄바꿈\n있음', tags: '점심' }),
    tx({ date: '2026-11-01', type: 'income', amount: 100, category_id: 'cat_salary', merchant: '=SUM(A1)', source: 'assistant' }),
    tx({ date: '2026-11-03', type: 'transfer', amount: 5, category_id: null, to_account_id: 'acc_cash' }),
  ];
  const csv = toCsv(rows, accs(), cats);
  test('BOM·헤더·CRLF, 날짜 오름차순', () => {
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lines = csv.slice(1).split('\r\n');
    expect(lines[0]).toBe('날짜,시간,유형,금액,통장,입금통장,대분류,소분류,가맹점,메모,태그,출처');
    expect(lines[1].startsWith('2026-11-01,')).toBe(true);
    expect(lines.at(-1)).toBe('');
  });
  test('쉼표·따옴표·줄바꿈 이스케이프', () => {
    expect(csv).toContain('"김밥, ""천국"""');
    expect(csv).toContain('"줄바꿈\n있음"');
  });
  test('수식 주입 방지, 대/소분류 분리, 이체', () => {
    expect(csv).toContain("'=SUM(A1)");
    expect(csv).toContain('식비,외식');
    expect(csv).toContain('수입,100,주 통장,,급여,,');
    expect(csv).toContain('이체,5,주 통장,현금');
    expect(csv).toContain(',비서');
  });
});

describe('백업/복원 검증', () => {
  const base = () => ({
    accounts: accs(), categories: cats, transactions: [tx({ date: '2026-11-02', amount: 100 })],
    budgets: [{ id: 'b', category_id: 'cat_food', amount: 1000 }], recurring: [], rules: [],
  });
  test('왕복', () => {
    const r = parseBackup(makeBackup(base(), new Date(NOW)));
    expect(r.ok).toBe(true);
  });
  test('BOM 허용, 깨진 JSON/다른 앱 파일 거부', () => {
    expect(parseBackup('﻿' + makeBackup(base())).ok).toBe(true);
    expect(parseBackup('{oops').ok).toBe(false);
    expect(validateBackup({ app: 'other' }).ok).toBe(false);
    expect(validateBackup(null).ok).toBe(false);
  });
  test('참조 무결성·값 범위 오류를 찾는다', () => {
    const d = base();
    d.transactions = [tx({ account_id: 'ghost' }), tx({ amount: -5 }), tx({ date: '2026-02-30' }), tx({ type: 'transfer', to_account_id: null, category_id: null }), tx({ category_id: 'ghost' })];
    const r = validateBackup({ v: 1, app: 'flowledger', ...d });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.length).toBe(5);
  });
  test('기본 통장은 정확히 하나, id 중복 불가', () => {
    const d = base();
    d.accounts = d.accounts.map((a) => ({ ...a, is_default: 0 }));
    expect(validateBackup({ v: 1, app: 'flowledger', ...d }).ok).toBe(false);
    const dup = base();
    dup.transactions = [tx({ id: 'same' }), tx({ id: 'same' })];
    const r = validateBackup({ v: 1, app: 'flowledger', ...dup });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join()).toContain('중복');
  });
  test('규칙/고정거래의 통장 참조 검사', () => {
    const d = { ...base(), rules: [{ id: 'r', keyword: '넷플릭스', match: 'any' as const, account_id: 'ghost', created_at: NOW }] };
    expect(validateBackup({ v: 1, app: 'flowledger', ...d }).ok).toBe(false);
  });
});

describe('시드', () => {
  test('기본 통장 하나, 카테고리 id 유일, 소분류는 대분류를 가리킴', () => {
    expect(seedAccounts(NOW).filter((a) => a.is_default)).toHaveLength(1);
    expect(seedAccounts(NOW)[0].id).toBe(DEFAULT_ACCOUNT_ID);
    const c = seedCategories();
    expect(new Set(c.map((x) => x.id)).size).toBe(c.length);
    c.filter((x) => x.parent_id).forEach((x) => expect(c.find((p) => p.id === x.parent_id)?.type).toBe(x.type));
    expect(c.find((x) => x.id === 'cat_misc')?.name).toBe('기타');
    expect(c.find((x) => x.id === 'cat_inc_misc')?.type).toBe('income');
  });
});
