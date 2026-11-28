import { recurringFromSuggestion, suggestRecurring } from '../src/lib/suggest';
import type { Tx } from '../src/lib/types';

const tx = (date: string, merchant: string, amount = 9900, extra: Partial<Tx> = {}): Tx => ({
  id: `${merchant}${date}`, type: 'expense', amount, date, time: null, account_id: 'acc_main', to_account_id: null, category_id: 'cat_x', merchant, memo: null,
  tags: null, source: 'app', source_ref: null, recurring_id: null, created_at: '', updated_at: '', receipt_uri: null, ...extra,
} as Tx);

const monthly = (merchant: string, months: string[], day = '12', amount = 9900) => months.map((m) => tx(`${m}-${day}`, merchant, amount));

test('3개월 이상 반복되는 결제를 제안하고, 마지막 결제 다음부터 이어지게 만든다', () => {
  const txs = monthly('넷플릭스', ['2026-08', '2026-09', '2026-10']);
  const s = suggestRecurring(txs, [], new Set(), '2026-11-20');
  expect(s.map((x) => x.name)).toEqual(['넷플릭스']);
  const r = recurringFromSuggestion(s[0], 'acc_main', 'cat_misc');
  expect(r).toMatchObject({ day: 12, amount: 9900, start_date: '2026-10-12', last_run: '2026-10-12', category_id: 'cat_x', merchant: '넷플릭스' });
});

test('이미 정기 거래이거나 숨긴 것, 끊긴 것, 개월 수 부족은 제외', () => {
  const txs = [...monthly('넷플릭스', ['2026-08', '2026-09', '2026-10']), ...monthly('왓챠', ['2026-02', '2026-03', '2026-04']), ...monthly('쿠팡', ['2026-09', '2026-10'])];
  expect(suggestRecurring(txs, [{ merchant: '넷플릭스', memo: null }], new Set(), '2026-11-20')).toEqual([]);
  const key = suggestRecurring(txs, [], new Set(), '2026-11-20')[0].key;
  expect(suggestRecurring(txs, [], new Set([key]), '2026-11-20')).toEqual([]);
  // 왓챠는 마지막 결제가 4월이라 끊긴 것, 쿠팡은 2개월뿐
  expect(suggestRecurring(txs, [], new Set(), '2026-11-20').map((x) => x.name)).toEqual(['넷플릭스']);
});

test('금액이 들쭉날쭉하면 제안하지 않는다', () => {
  const txs = [tx('2026-08-05', '식당', 8000), tx('2026-09-05', '식당', 15000), tx('2026-10-05', '식당', 30000)];
  expect(suggestRecurring(txs, [], new Set(), '2026-11-20')).toEqual([]);
});
