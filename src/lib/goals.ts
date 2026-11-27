import { parseYmd } from './dates';
import type { Goal } from './types';

/** 진행액(연결 통장 잔액, 음수면 0, 없으면 직접 입력액), 진행률, 목표일까지 남은 일수와 월 필요 저축액 */
export function goalProgress(g: Pick<Goal, 'target' | 'account_id' | 'saved' | 'due_date'>, balances: Map<string, number>, today: string) {
  const raw = g.account_id ? balances.get(g.account_id) ?? 0 : g.saved;
  const saved = Math.max(0, raw);
  const pct = g.target > 0 ? (saved / g.target) * 100 : 0;
  let daysLeft: number | null = null;
  let perMonth: number | null = null;
  if (g.due_date) {
    daysLeft = Math.round((parseYmd(g.due_date).getTime() - parseYmd(today).getTime()) / 86_400_000);
    const remaining = g.target - saved;
    if (daysLeft > 0 && remaining > 0) perMonth = Math.ceil(remaining / Math.max(daysLeft / 30.4375, 1));
  }
  return { saved, pct, daysLeft, perMonth };
}
