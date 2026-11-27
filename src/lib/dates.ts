const pad = (n: number) => String(n).padStart(2, '0');

export const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const hm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const monthKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
export const todayStr = (now: Date = new Date()) => ymd(now);

export const isYmd = (s: unknown): s is string => {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
};
export const isHm = (s: unknown): s is string => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
export const isMonth = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);

export const parseYmd = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};

export const daysInMonth = (y: number, m1: number) => new Date(y, m1, 0).getDate();

/** 'YYYY-MM' + n개월 */
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return monthKey(d);
}

/** 달의 첫날/마지막날 (YYYY-MM-DD) */
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number);
  return { from: `${month}-01`, to: `${month}-${pad(daysInMonth(y, m))}` };
}

export const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
export const weekdayOf = (date: string) => parseYmd(date).getDay();

export function fmtDateLabel(date: string, now: Date = new Date()): string {
  const d = parseYmd(date);
  const diff = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - d.getTime()) / 86_400_000);
  const base = `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAYS[d.getDay()]})`;
  return diff === 0 ? `오늘 · ${base}` : diff === 1 ? `어제 · ${base}` : d.getFullYear() === now.getFullYear() ? base : `${d.getFullYear()}년 ${base}`;
}

export const fmtMonthLabel = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  return `${y}년 ${m}월`;
};

/** 달력 격자: 첫 주 앞쪽 빈칸(null) + 날짜들 (일요일 시작). 7의 배수 길이로 맞춘다 */
export function monthCells(month: string): (string | null)[] {
  const [y, m] = month.split('-').map(Number);
  const lead = new Date(y, m - 1, 1).getDay();
  const n = daysInMonth(y, m);
  const cells: (string | null)[] = Array.from({ length: lead }, () => null);
  for (let d = 1; d <= n; d++) cells.push(`${month}-${pad(d)}`);
  while (cells.length % 7) cells.push(null);
  return cells;
}
