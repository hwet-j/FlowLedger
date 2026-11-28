import { classify, transferHint } from '../src/lib/import/classify';
import { fieldOf, guessMapping } from '../src/lib/import/columns';
import { detectDelimiter, parseDelimited } from '../src/lib/import/delimited';
import { findDuplicates, importRefs } from '../src/lib/import/dedupe';
import { buildPlan, learnableChoices, summarizePlan, toImportRows } from '../src/lib/import/plan';
import { normalizeDate, parseMoney, parseTime, rowsToDrafts } from '../src/lib/import/rows';
import { parseSms, splitMessages } from '../src/lib/import/sms';
import { merchantKey } from '../src/lib/merchants';
import { cats, tx } from './helpers';

const NOW = new Date(2026, 10, 27, 15, 0);

describe('구분자 텍스트', () => {
  test('쉼표·탭·따옴표·BOM·줄바꿈', () => {
    expect(parseDelimited('﻿a,b,c\r\n1,"x,y",3\r\n')).toEqual([['a', 'b', 'c'], ['1', 'x,y', '3']]);
    expect(parseDelimited('a\tb\n1\t2')).toEqual([['a', 'b'], ['1', '2']]);
    expect(parseDelimited('a,b\n"he said ""hi""",2\n"줄\n바꿈",3')).toEqual([['a', 'b'], ['he said "hi"', '2'], ['줄\n바꿈', '3']]);
    expect(parseDelimited('a,b\n\n,\n1,2')).toEqual([['a', 'b'], ['1', '2']]);
  });
  test('구분자 추정: 금액의 쉼표(따옴표 안)에 속지 않는다', () => {
    const tsv = '날짜\t내용\t금액\n2026.11.27\t스타벅스\t"4,500"\n2026.11.26\t이디야\t"3,900"';
    expect(detectDelimiter(tsv)).toBe('\t');
    expect(parseDelimited(tsv)[1]).toEqual(['2026.11.27', '스타벅스', '4,500']);
    expect(detectDelimiter('a;b;c\n1;2;3\n4;5;6')).toBe(';');
  });
});

describe('열 이름 알아보기', () => {
  test('별칭·괄호·공백', () => {
    expect(fieldOf('거래일자')).toBe('date');
    expect(fieldOf('출금액(원)')).toBe('withdraw');
    expect(fieldOf('입금 금액')).toBe('deposit');
    expect(fieldOf('이용가맹점')).toBe('desc');
    expect(fieldOf('거래 후 잔액')).toBe('balance');
    expect(fieldOf('승인구분')).toBe('kind');
    expect(fieldOf('알 수 없음')).toBeNull();
  });
  test('앞쪽 계좌 정보 줄을 건너뛰고 헤더를 찾는다', () => {
    const rows = parseDelimited('거래내역조회\n계좌번호,123-456\n\n거래일자,거래시간,적요,출금액,입금액,거래후잔액\n2026.11.27,12:34:56,김밥천국,12000,,988000');
    const g = guessMapping(rows);
    expect(g.headerRow).toBe(2);
    expect(g.mapping).toMatchObject({ date: 0, time: 1, desc: 2, withdraw: 3, deposit: 4, balance: 5 });
  });
  test('헤더가 없으면 값의 모양으로 추정', () => {
    const rows = parseDelimited('2026.11.27,스타벅스 강남점,"4,500"\n2026.11.26,이디야커피,"3,900"\n2026.11.25,김밥천국,"6,000"');
    const g = guessMapping(rows);
    expect(g.headerRow).toBe(-1);
    expect(g.mapping).toMatchObject({ date: 0, amount: 2, desc: 1 });
  });
});

describe('날짜·금액·시각', () => {
  test('날짜 형식들', () => {
    expect(normalizeDate('2026.11.27', NOW)).toEqual({ date: '2026-11-27', time: null });
    expect(normalizeDate('2026-11-27 12:34:56', NOW)).toEqual({ date: '2026-11-27', time: '12:34' });
    expect(normalizeDate('2026/11/27', NOW)?.date).toBe('2026-11-27');
    expect(normalizeDate('20261127', NOW)?.date).toBe('2026-11-27');
    expect(normalizeDate('26.11.27', NOW)?.date).toBe('2026-11-27');
    expect(normalizeDate('2026년 11월 27일', NOW)?.date).toBe('2026-11-27');
    expect(normalizeDate('2026-11-27T09:05', NOW)).toEqual({ date: '2026-11-27', time: '09:05' });
  });
  test('연도 없는 날짜는 가장 가까운 과거', () => {
    expect(normalizeDate('11/27', NOW)?.date).toBe('2026-11-27');
    expect(normalizeDate('12/25', NOW)?.date).toBe('2025-12-25');
    expect(normalizeDate('11/28', NOW)?.date).toBe('2026-11-28'); // 내일까지는 올해로
  });
  test('잘못된 날짜', () => {
    expect(normalizeDate('2026.02.30', NOW)).toBeNull();
    expect(normalizeDate('abc', NOW)).toBeNull();
    expect(normalizeDate('', NOW)).toBeNull();
  });
  test('금액 형식들', () => {
    expect(parseMoney('1,234')).toBe(1234);
    expect(parseMoney('-1,234')).toBe(-1234);
    expect(parseMoney('(1,234)')).toBe(-1234);
    expect(parseMoney('1,234원')).toBe(1234);
    expect(parseMoney('₩ 1,234')).toBe(1234);
    expect(parseMoney('+5,000')).toBe(5000);
    expect(parseMoney('1234.00')).toBe(1234);
    expect(parseMoney('12.6')).toBe(13);
    expect(parseMoney('')).toBeNull();
    expect(parseMoney('abc')).toBeNull();
    expect(parseMoney('1.234.567')).toBeNull();
  });
  test('시각', () => {
    expect(parseTime('12:34')).toBe('12:34');
    expect(parseTime('12:34:56')).toBe('12:34');
    expect(parseTime('123456')).toBe('12:34');
    expect(parseTime('오후 3:05')).toBe('15:05');
    expect(parseTime('오전 12:10')).toBe('00:10');
    expect(parseTime('25:00')).toBeNull();
    expect(parseTime('')).toBeNull();
  });
});

describe('행 → 초안', () => {
  const bank = parseDelimited('거래일자,거래시간,적요,출금액,입금액,거래후잔액\n2026.11.27,12:34:56,김밥천국,"12,000",,"988,000"\n2026.11.26,09:10:00,급여,,"3,000,000","1,000,000"\n2026.11.25,,이상한줄,,,\n잘못된날짜,,x,100,,');
  test('출금/입금 열이 따로 있는 은행 내역', () => {
    const g = guessMapping(bank);
    const { drafts, issues } = rowsToDrafts(bank.slice(g.headerRow + 1), g.mapping, { now: NOW });
    expect(drafts).toHaveLength(2);
    expect(drafts[0]).toMatchObject({ date: '2026-11-27', time: '12:34', description: '김밥천국', amount: 12000, type: 'expense', balance: 988000 });
    expect(drafts[1]).toMatchObject({ type: 'income', amount: 3_000_000, description: '급여' });
    expect(issues.map((i) => i.reason)).toEqual(['금액을 읽지 못했어요', '날짜를 읽지 못했어요']);
  });
  test('카드 내역: 양수는 지출, 승인구분 취소는 환불', () => {
    const rows = parseDelimited('이용일자\t이용가맹점\t이용금액\t승인구분\n2026.11.27\t스타벅스\t4,500\t승인\n2026.11.26\t스타벅스\t4,500\t취소\n2026.11.25\t이마트\t30,000\t승인');
    const g = guessMapping(rows);
    const { drafts } = rowsToDrafts(rows.slice(1), g.mapping, { now: NOW });
    expect(drafts.map((d) => [d.type, d.refund, d.amount])).toEqual([['expense', false, 4500], ['income', true, 4500], ['expense', false, 30000]]);
  });
  test('부호 있는 금액 한 칸(음수=지출)과 양수=수입', () => {
    const rows = [['2026.11.27', '스타벅스', '-4,500'], ['2026.11.26', '월급', '3,000,000']];
    const { drafts } = rowsToDrafts(rows, { date: 0, desc: 1, amount: 2 }, { now: NOW });
    expect(drafts.map((d) => [d.type, d.amount])).toEqual([['expense', 4500], ['income', 3_000_000]]);
  });
  test('음수가 없는 한 칸 금액은 지출로, 옵션으로 바꿀 수 있다', () => {
    const rows = [['2026.11.27', 'A', '4,500'], ['2026.11.26', 'B', '1,000']];
    expect(rowsToDrafts(rows, { date: 0, desc: 1, amount: 2 }, { now: NOW }).drafts.every((d) => d.type === 'expense')).toBe(true);
    expect(rowsToDrafts(rows, { date: 0, desc: 1, amount: 2 }, { now: NOW, positiveIs: 'income' }).drafts.every((d) => d.type === 'income')).toBe(true);
  });
  test('날짜 칸에 시각이 같이 있어도 시각을 뽑는다', () => {
    const { drafts } = rowsToDrafts([['2026-11-27 18:05:00', '식당', '9,000']], { date: 0, desc: 1, amount: 2 }, { now: NOW });
    expect(drafts[0]).toMatchObject({ date: '2026-11-27', time: '18:05' });
  });
});

describe('자동 분류·내부 이동', () => {
  test('키워드 사전', () => {
    expect(classify('스타벅스 강남점', 'expense').category_id).toBe('cat_food_cafe');
    expect(classify('배달의민족', 'expense').category_id).toBe('cat_food_delivery');
    expect(classify('GS25 역삼점', 'expense').category_id).toBe('cat_food_grocery');
    expect(classify('카카오T택시', 'expense').category_id).toBe('cat_transport_taxi');
    expect(classify('티머니 지하철', 'expense').category_id).toBe('cat_transport_public');
    expect(classify('넷플릭스', 'expense').category_id).toBe('cat_hobby_sub');
    expect(classify('SK텔레콤 통신요금', 'expense').category_id).toBe('cat_housing_phone');
    expect(classify('서울대병원', 'expense').category_id).toBe('cat_health_hospital');
    expect(classify('○○주유소', 'expense').category_id).toBe('cat_transport_fuel');
    expect(classify('급여', 'income').category_id).toBe('cat_salary');
    expect(classify('처음 보는 가게', 'expense')).toEqual({ category_id: null, source: null });
    expect(classify('', 'expense').category_id).toBeNull();
  });
  test('학습한 분류가 사전보다 우선, 지점 변형에도 적용', () => {
    const learned = new Map([[merchantKey('스타벅스'), 'cat_hobby_culture']]);
    expect(classify('스타벅스 강남점', 'expense', learned)).toEqual({ category_id: 'cat_hobby_culture', source: 'learned' });
    expect(classify('스타벅스리저브', 'expense', learned).source).toBe('learned');
    expect(classify('이디야', 'expense', learned).category_id).toBe('cat_food_cafe');
  });
  test('보관/없는 분류는 건너뛴다', () => {
    expect(classify('스타벅스', 'expense', undefined, new Set(['cat_misc'])).category_id).toBeNull();
  });
  test('내부 이동 후보', () => {
    expect(transferHint('신한카드 결제대금')).toBe('card_bill');
    expect(transferHint('삼성카드대금')).toBe('card_bill');
    expect(transferHint('현금인출 ATM')).toBe('atm');
    expect(transferHint('청약저축 납입')).toBe('saving');
    expect(transferHint('카카오페이머니충전')).toBe('wallet_topup');
    expect(transferHint('김밥천국')).toBeNull();
  });
});

describe('중복 감지·멱등 키', () => {
  const d = (date: string, amount: number, description: string) => ({ date, time: null, description, amount, type: 'expense' as const, refund: false, balance: null, line: 1, raw: '' });
  test('같은 줄이 여러 번 나오면 순번으로 구분하고, 다시 가져와도 같은 키', () => {
    const drafts = [d('2026-11-27', 4500, '스타벅스'), d('2026-11-27', 4500, '스타벅스 '), d('2026-11-27', 4500, '이디야')];
    const refs = importRefs('acc_main', drafts);
    expect(refs[0]).not.toBe(refs[1]);
    expect(refs[0].endsWith(':1')).toBe(true);
    expect(refs[1].endsWith(':2')).toBe(true);
    expect(new Set(refs).size).toBe(3);
    expect(importRefs('acc_main', drafts)).toEqual(refs);
    expect(importRefs('acc_card', drafts)[0]).not.toBe(refs[0]);
  });
  test('기존 거래와 겹치면 중복: 통장·날짜·금액이 같고 가맹점이 비슷', () => {
    const drafts = [d('2026-11-27', 4500, '스타벅스 강남점'), d('2026-11-27', 4500, '스타벅스 강남점'), d('2026-11-26', 9000, '김밥천국')];
    const existing = [tx({ amount: 4500, date: '2026-11-27', merchant: '스타벅스' }), tx({ amount: 9000, date: '2026-11-26', merchant: '다른곳' }), tx({ amount: 9000, date: '2026-11-26', merchant: '김밥천국', account_id: 'acc_card' })];
    const refs = importRefs('acc_main', drafts);
    // 파일에 같은 줄이 둘이고 기존에 하나뿐이면 첫 줄만 중복. 가맹점이 다른 같은 금액은 중복이 아님
    expect([...findDuplicates(drafts, refs, existing, 'acc_main')]).toEqual([0]);
  });
  test('가맹점이 비어 있는 기존 거래는 날짜·금액만으로 중복 처리', () => {
    const drafts = [d('2026-11-27', 4500, '스타벅스')];
    expect(findDuplicates(drafts, ['r'], [tx({ amount: 4500, date: '2026-11-27', merchant: null })], 'acc_main').size).toBe(1);
  });
  test('같은 source_ref 면 가맹점이 달라도 중복', () => {
    const drafts = [d('2026-11-27', 4500, '바뀐이름')];
    const refs = importRefs('acc_main', drafts);
    expect(findDuplicates(drafts, refs, [tx({ amount: 4500, date: '2026-11-27', merchant: '원래이름', source_ref: refs[0] })], 'acc_main').size).toBe(1);
  });
  test('수입과 지출은 서로 중복이 아니다', () => {
    const inc = { ...d('2026-11-27', 4500, '환불'), type: 'income' as const };
    expect(findDuplicates([inc], ['r'], [tx({ amount: 4500, date: '2026-11-27', merchant: '환불' })], 'acc_main').size).toBe(0);
  });
});

describe('문자 붙여넣기', () => {
  test('카드 승인 문자 (신한 형식)', () => {
    const r = parseSms('[Web발신]\n신한카드(1234)승인 홍*동 12,300원(일시불) 11/27 12:34 스타벅스 누적1,234,567원', NOW);
    expect(r.issues).toEqual([]);
    expect(r.drafts[0]).toMatchObject({ date: '2026-11-27', time: '12:34', description: '스타벅스', amount: 12300, type: 'expense', refund: false });
  });
  test('카드 승인 문자 (KB 형식, 지점 이름)', () => {
    const r = parseSms('[Web발신] KB국민카드 1234 승인 홍*동 12,300원 일시불 11/27 12:34 스타벅스 강남점 누적 1,234,567원', NOW);
    expect(r.drafts[0]).toMatchObject({ description: '스타벅스 강남점', amount: 12300, type: 'expense' });
  });
  test('승인 취소는 환불(수입)', () => {
    const r = parseSms('[Web발신] 삼성카드 승인취소 12,300원 일시불 11/27 14:00 스타벅스', NOW);
    expect(r.drafts[0]).toMatchObject({ type: 'income', refund: true, amount: 12300, description: '스타벅스' });
  });
  test('계좌 입금·출금 문자(잔액은 금액으로 읽지 않는다)', () => {
    const r = parseSms('[Web발신] 하나은행 11/27 12:34 입금 3,000,000원 급여 잔액 5,000,000원\n\n[Web발신] 우리 11/27 09:10 출금 45,000원 김밥천국 잔액 954,300원', NOW);
    expect(r.drafts.map((x) => [x.type, x.amount, x.description, x.time])).toEqual([['income', 3_000_000, '급여', '12:34'], ['expense', 45_000, '김밥천국', '09:10']]);
  });
  test('여러 건을 머리말로 나누고 연도 있는 날짜도 읽는다', () => {
    const text = '[Web발신]\n현대카드M 승인 홍길동 25,000원 일시불 2026/11/26 18:02 쿠팡 누적5,000,000원\n[Web발신]\n롯데카드 승인 8,000원 11/27 08:15 맘스터치';
    expect(splitMessages(text)).toHaveLength(2);
    const r = parseSms(text, NOW);
    expect(r.drafts.map((x) => [x.date, x.amount, x.description])).toEqual([['2026-11-26', 25000, '쿠팡'], ['2026-11-27', 8000, '맘스터치']]);
  });
  test('날짜가 없으면 오늘로 두고 알린다, 읽지 못한 문자는 이유와 함께', () => {
    const r = parseSms('체크카드 승인 3,500원 편의점', NOW);
    expect(r.drafts[0].date).toBe('2026-11-27');
    expect(r.drafts[0].raw).toContain('오늘로 처리');
    expect(parseSms('안녕하세요 광고입니다 1,000원 할인', NOW).issues[0].reason).toContain('구분');
    expect(parseSms('[Web발신] 승인 홍*동 11/27 12:34 스타벅스', NOW).issues).toEqual([]);
  });
  test('빈 입력', () => {
    expect(parseSms('', NOW)).toEqual({ drafts: [], issues: [] });
    expect(splitMessages('  \n ')).toEqual([]);
  });
});

describe('가져오기 계획', () => {
  const csv = parseDelimited('거래일자,적요,출금액,입금액\n2026.11.27,스타벅스 강남점,"4,500",\n2026.11.27,신한카드 결제대금,"500,000",\n2026.11.26,급여,,"3,000,000"\n2026.11.25,김밥천국,"9,000",\n2026.11.24,처음보는가게,"7,000",');
  const g = guessMapping(csv);
  const { drafts } = rowsToDrafts(csv.slice(g.headerRow + 1), g.mapping, { now: NOW });
  const existing = [tx({ amount: 9000, date: '2026-11-25', merchant: '김밥천국' })];
  const plan = buildPlan(drafts, { accountId: 'acc_main', categories: cats, existing });
  test('분류·중복·내부 이동 후보를 표시하고 기본은 건너뜀', () => {
    expect(plan.map((r) => [r.draft.description, r.action, r.category_id, r.duplicate, r.transfer])).toEqual([
      ['스타벅스 강남점', 'import', 'cat_food_cafe', false, null],
      ['신한카드 결제대금', 'skip', 'cat_misc', false, 'card_bill'],
      ['급여', 'import', 'cat_salary', false, null],
      ['김밥천국', 'skip', 'cat_food_eat_out', true, null],
      ['처음보는가게', 'import', 'cat_misc', false, null],
    ]);
    const s = summarizePlan(plan);
    expect(s).toMatchObject({ total: 5, selected: 3, expense: 11_500, income: 3_000_000, skippedDuplicate: 1, skippedTransfer: 1 });
  });
  test('저장용 행과 학습 목록', () => {
    const edited = plan.map((r) => (r.draft.description === '처음보는가게' ? { ...r, category_id: 'cat_shop_clothes' } : r));
    expect(learnableChoices(edited, plan)).toEqual([{ merchant: '처음보는가게', category_id: 'cat_shop_clothes' }]);
    const rows = toImportRows(edited, 'acc_main');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ type: 'expense', amount: 4500, account_id: 'acc_main', category_id: 'cat_food_cafe', merchant: '스타벅스 강남점' });
    expect(rows.every((r) => r.source_ref.startsWith('imp:acc_main:'))).toBe(true);
  });
  test('학습한 분류를 다음 가져오기에서 쓴다', () => {
    const learned = new Map([[merchantKey('처음보는가게'), 'cat_shop_clothes']]);
    const p2 = buildPlan(drafts, { accountId: 'acc_main', categories: cats, existing: [], learned });
    expect(p2[4]).toMatchObject({ category_id: 'cat_shop_clothes', categorySource: 'learned' });
  });
  test('환불은 환급 분류로, 이상한 행은 건너뜀', () => {
    const refund = { date: '2026-11-27', time: null, description: '쿠팡', amount: 12000, type: 'income' as const, refund: true, balance: null, line: 1, raw: '' };
    const bad = { ...refund, date: '2026-02-30', refund: false };
    const p = buildPlan([refund, bad], { accountId: 'acc_main', categories: cats, existing: [] });
    expect(p[0]).toMatchObject({ category_id: 'cat_refund', action: 'import' });
    expect(p[1].action).toBe('skip');
    const p3 = buildPlan([{ ...refund, description: '' }], { accountId: 'acc_main', categories: cats, existing: [] });
    expect(p3[0].category_id).toBe('cat_refund');
  });
});
