import { detectSubscriptions, type Subscription } from './insights';
import { groupKey, type AliasMap } from './merchants';
import type { Recurring, Tx } from './types';

/**
 * 정기 거래로 등록할 만한 정기 결제 제안: 3개월 이상 반복된 지출 중
 * ① 이미 정기 거래(활성·비활성 모두)로 등록된 가맹점 ② 사용자가 숨긴 것 ③ 최근 두 달 안에 결제가 없는(끊긴) 것은 뺀다.
 */
export function suggestRecurring(txs: Tx[], recurring: Pick<Recurring, 'merchant' | 'memo'>[], dismissed: ReadonlySet<string>, today: string, aliases?: AliasMap): Subscription[] {
  const have = new Set(recurring.map((r) => groupKey(r.merchant ?? r.memo ?? '', aliases)).filter(Boolean));
  const [y, m, d] = today.split('-').map(Number);
  const cut = new Date(y, m - 1 - 2, d);
  const lim = `${cut.getFullYear()}-${String(cut.getMonth() + 1).padStart(2, '0')}-${String(cut.getDate()).padStart(2, '0')}`;
  return detectSubscriptions(txs, aliases).filter((s) => !have.has(s.key) && !dismissed.has(s.key) && s.lastDate >= lim && !!s.day);
}

/** 제안을 정기 거래로 만들 때의 값. 이미 기록된 마지막 결제 다음 달부터 이어지도록 last_run 을 마지막 결제일로 둔다 */
export function recurringFromSuggestion(s: Subscription, fallbackAccountId: string, fallbackCategoryId: string) {
  return {
    type: 'expense' as const,
    amount: s.amount,
    account_id: s.accountId ?? fallbackAccountId,
    to_account_id: null,
    category_id: s.categoryId ?? fallbackCategoryId,
    merchant: s.name,
    memo: null,
    day: s.day as number,
    start_date: s.lastDate,
    end_date: null,
    last_run: s.lastDate,
    active: 1,
  };
}
