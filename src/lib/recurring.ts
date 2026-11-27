import { addMonths, daysInMonth, isYmd } from './dates';
import type { Recurring } from './types';

const pad = (n: number) => String(n).padStart(2, '0');

/** 매달 N일 (말일 초과면 말일) */
export function runDate(month: string, day: number): string {
  const [y, m] = month.split('-').map(Number);
  return `${month}-${pad(Math.min(day, daysInMonth(y, m)))}`;
}

export interface Due { date: string; ref: string }

/**
 * 오늘까지 도래했지만 아직 만들지 않은 실행일. 앱을 오래 안 열어 밀린 달도 한꺼번에 따라잡는다(최대 120개).
 * ref 는 transactions.source_ref(UNIQUE) 멱등 키.
 */
export function dueRuns(r: Pick<Recurring, 'id' | 'day' | 'start_date' | 'end_date' | 'last_run' | 'active'>, today: string): Due[] {
  if (!r.active || !isYmd(r.start_date) || !isYmd(today)) return [];
  const out: Due[] = [];
  let month = r.start_date.slice(0, 7);
  const last = today.slice(0, 7);
  while (month <= last && out.length < 120) {
    const date = runDate(month, r.day);
    const inRange = date >= r.start_date && date <= today && (!r.end_date || date <= r.end_date);
    if (inRange && (!r.last_run || date > r.last_run)) out.push({ date, ref: `${r.id}:${date}` });
    month = addMonths(month, 1);
  }
  return out;
}

/** 다음 실행 예정일 (오늘 이후, 종료일 넘으면 null) */
export function nextRun(r: Pick<Recurring, 'day' | 'start_date' | 'end_date' | 'active'>, today: string): string | null {
  if (!r.active) return null;
  let month = today > r.start_date ? today.slice(0, 7) : r.start_date.slice(0, 7);
  for (let i = 0; i < 14; i++) {
    const date = runDate(month, r.day);
    if (date >= today && date >= r.start_date) return r.end_date && date > r.end_date ? null : date;
    month = addMonths(month, 1);
  }
  return null;
}
