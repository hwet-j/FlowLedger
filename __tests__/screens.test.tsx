/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock 이후에 화면을 불러오려고 require 를 쓴다 */
/**
 * 화면 스모크 테스트: 실제 DB(네이티브) 없이 가짜 저장소로 주요 화면이 예외 없이 그려지는지 확인한다.
 * (기기에서 처음 열었을 때 흔한 런타임 오류 — 훅 순서, undefined 접근, 잘못된 import — 를 잡는 용도)
 */
import React from 'react';
import renderer, { act } from 'react-test-renderer';

import { balances } from '../src/lib/accounts';
import { accs, cats, NOW, rule, tx } from './helpers';

const accounts = accs();
const txs = [
  tx({ type: 'income', amount: 3_000_000, date: '2026-11-25', category_id: 'cat_salary', merchant: '월급' }),
  tx({ amount: 12_000, date: '2026-11-03', category_id: 'cat_food_eat_out', merchant: '김밥천국' }),
  tx({ amount: 60_000, date: '2026-11-07', category_id: 'cat_shop_clothes', merchant: '무신사', account_id: 'acc_card', source: 'assistant' }),
  tx({ type: 'transfer', amount: 500_000, date: '2026-11-26', category_id: null, to_account_id: 'acc_cash' }),
  tx({ amount: 40_000, date: '2026-10-12' }),
  tx({ id: 'mx', amount: 7_980, date: '2026-11-20', category_id: 'cat_food_grocery', merchant: '이마트' }),
];

const mockItems = [
  { id: 'it1', transaction_id: 'mx', name: '우유 1L', qty: 1, unit_price: null, amount: 2_980, category_id: null, sort: 0 },
  { id: 'it2', transaction_id: 'mx', name: '세제', qty: 1, unit_price: 5_000, amount: 5_000, category_id: 'cat_shop_living', sort: 1 },
];
const mockLedger = {
  ready: true, error: null, accounts, categories: cats, txs,
  budgets: [{ id: 'b0', category_id: null, amount: 200_000 }, { id: 'b1', category_id: 'cat_food', amount: 30_000 }],
  recurring: [{ id: 'rc', type: 'expense', amount: 500_000, account_id: 'acc_main', to_account_id: null, category_id: 'cat_housing_rent', merchant: '월세', memo: null, day: 25, start_date: '2026-01-01', end_date: null, last_run: null, active: 1 }],
  rules: [rule({ keyword: '넷플릭스', account_id: 'acc_card' })],
  templates: [{ id: 't1', name: '점심', type: 'expense', amount: 9000, account_id: null, to_account_id: null, category_id: 'cat_food_eat_out', merchant: null, memo: null, sort: 0 }],
  goals: [{ id: 'g1', name: '비상금', target: 1_000_000, account_id: 'acc_cash', saved: 0, due_date: '2027-06-30', created_at: NOW }],
  items: mockItems, itemsByTx: new Map([['mx', mockItems]]),
  settings: { appLock: false, budgetAlerts: true }, setSetting: jest.fn(),
  balances: balances(accounts, txs),
  accountById: new Map(accounts.map((a) => [a.id, a])),
  catById: new Map(cats.map((c) => [c.id, c])),
  recurringCreated: 2, dismissRecurring: jest.fn(),
  mutate: jest.fn(async (fn: (db: unknown) => unknown) => fn({})), refresh: jest.fn(), removeTx: jest.fn(), quickRecord: jest.fn(),
  notice: null, showNotice: jest.fn(), clearNotice: jest.fn(),
};

jest.mock('../src/store', () => ({ useLedger: () => mockLedger, LedgerProvider: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), setParams: jest.fn() },
  useLocalSearchParams: () => ({}),
  Stack: { Screen: () => null },
  Tabs: Object.assign(() => null, { Screen: () => null }),
}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }), SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('expo-haptics', () => ({ selectionAsync: jest.fn(), notificationAsync: jest.fn(), NotificationFeedbackType: { Success: 'success' } }));
jest.mock('expo-sqlite', () => ({}));
jest.mock('expo-file-system', () => ({ File: class {}, Directory: class {}, Paths: { cache: '', document: '' } }));
jest.mock('expo-sharing', () => ({}));
jest.mock('expo-document-picker', () => ({}));
jest.mock('expo-local-authentication', () => ({ SecurityLevel: { NONE: 0 } }));
jest.mock('expo-notifications', () => ({}));
jest.mock('expo-image-picker', () => ({}));
jest.mock('@react-native-community/datetimepicker', () => 'DateTimePicker');

const render = async (el: React.ReactElement) => {
  let r!: renderer.ReactTestRenderer;
  await act(async () => { r = renderer.create(el); });
  return r;
};
// 렌더 트리에서 글자만 이어 붙인다 (props 에 순환 참조가 있어 JSON.stringify 는 못 쓴다)
const collect = (n: unknown): string => (n == null ? '' : typeof n === 'string' ? n : Array.isArray(n) ? n.map(collect).join('') : collect((n as { children?: unknown }).children));
const text = (r: renderer.ReactTestRenderer) => collect(r.toJSON());

jest.setTimeout(60_000);
beforeAll(() => { jest.useFakeTimers().setSystemTime(new Date(2026, 10, 27, 12)); });
afterAll(() => { jest.useRealTimers(); });

test('홈', async () => {
  const Home = require('../src/app/(tabs)/index').default;
  const r = await render(<Home />);
  const s = text(r);
  expect(s).toContain('순자산');
  expect(s).toContain('3,000,000원');
  expect(s).toContain('고정 거래 2건');
  expect(s).toContain('이번 달 가장 많이 쓴 곳');
  expect(s).toContain('점심');
  expect(s).toContain('비상금');
});

test('지출 인사이트', async () => {
  const Insights = require('../src/app/insights').default;
  const r = await render(<Insights />);
  const s = text(r);
  expect(s).toContain('이번 달 지출');
  expect(s).toContain('어디에 쓰나');
  expect(s).toContain('가맹점');
  expect(s).toContain('얼마나 자주');
  expect(s).toContain('고정비 vs 변동비');
});

test('내역: 목록과 달력 보기', async () => {
  const List = require('../src/app/(tabs)/list').default;
  const r = await render(<List />);
  expect(text(r)).toContain('월급'); // 긴 목록은 가상화돼 앞쪽 일부만 그려진다
  expect(text(r)).toContain('달력 보기');
});

test('통계', async () => {
  const Stats = require('../src/app/(tabs)/stats').default;
  const r = await render(<Stats />);
  const s = text(r);
  expect(s).toContain('카테고리별 지출');
  expect(s).toContain('순자산 추이');
  expect(s).toContain('리포트 공유');
});

test('더보기 · 통장 · 규칙 · 카테고리 · 예산 · 고정 거래 · 템플릿 · 목표 · 설정 · 백업', async () => {
  for (const path of ['(tabs)/more', 'more/accounts', 'more/rules', 'more/categories', 'more/budgets', 'more/recurring', 'more/templates', 'more/goals', 'more/settings', 'more/backup', 'more/purchases']) {
    const Screen = require(`../src/app/${path}`).default;
    const r = await render(<Screen />);
    expect(text(r).length).toBeGreaterThan(50);
  }
});

test('입력 시트: 새 내역(규칙·기본 통장 안내)과 수정', async () => {
  const { TxForm } = require('../src/components/TxForm');
  const r = await render(<TxForm />);
  expect(text(r)).toContain('기본 통장으로 기록돼요');
  expect(text(r)).toContain('점심');
  const withItems = await render(<TxForm edit={txs[txs.length - 1]} />);
  expect(text(withItems)).toContain('품목 2개');
  expect(text(withItems)).toContain('합계 7,980원');
  const e = await render(<TxForm edit={txs[1]} />);
  expect(text(e)).toContain('삭제');
  expect(e.root.findAllByProps({ value: '김밥천국' }).length).toBeGreaterThan(0); // 가맹점 입력칸에 채워짐
});
