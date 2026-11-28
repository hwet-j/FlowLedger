import { isYmd } from '../dates';
import type { Mapping } from './columns';

const pad = (n: number) => String(n).padStart(2, '0');

export interface DateTime { date: string; time: string | null }

/**
 * 날짜 문자열 → YYYY-MM-DD(+시각). 2026.11.27 / 2026-11-27 / 2026/11/27 / 20261127 / 26.11.27 / 11/27 / "2026.11.27 12:34:56" / "2026-11-27T12:34".
 * 연도가 없으면 now 기준 가장 가까운 과거(내일보다 미래면 작년)로 본다.
 */
export function normalizeDate(raw: string, now: Date = new Date()): DateTime | null {
  const s = raw.trim().replace(/[년월]/g, '.').replace(/일/g, '').replace(/\s+/g, ' ');
  if (!s) return null;
  let m: RegExpExecArray | null;
  const time = /(\d{1,2}):(\d{2})(?::\d{2})?/.exec(s);
  let t: string | null = null;
  if (time) { const h = Number(time[1]), mi = Number(time[2]); if (h < 24 && mi < 60) t = `${pad(h)}:${pad(mi)}`; }
  const finish = (y: number, mo: number, d: number): DateTime | null => {
    const full = y < 100 ? 2000 + y : y;
    const date = `${full}-${pad(mo)}-${pad(d)}`;
    return isYmd(date) ? { date, time: t } : null;
  };
  if ((m = /^(\d{4})[./-]\s?(\d{1,2})[./-]\s?(\d{1,2})/.exec(s))) return finish(+m[1], +m[2], +m[3]);
  if ((m = /^(\d{4})(\d{2})(\d{2})(?!\d)/.exec(s))) return finish(+m[1], +m[2], +m[3]);
  if ((m = /^(\d{2})[./-](\d{1,2})[./-](\d{1,2})(?!\d)/.exec(s))) return finish(+m[1], +m[2], +m[3]);
  if ((m = /^(\d{1,2})[./-]\s?(\d{1,2})(?![\d:./-])/.exec(s))) {
    const mo = +m[1], d = +m[2];
    let y = now.getFullYear();
    const cand = finish(y, mo, d);
    if (!cand) return null;
    // 오늘(+1일)보다 미래면 작년 날짜로 본다
    const limit = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    if (new Date(cand.date + 'T00:00:00') > limit) { y -= 1; return finish(y, mo, d); }
    return cand;
  }
  return null;
}

/** "12:34" "12:34:56" "123456" "1234" "오후 3:05" → HH:MM, 아니면 null */
export function parseTime(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  let m = /^(오전|오후)?\s*(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(s);
  if (m) {
    let h = Number(m[2]);
    if (m[1] === '오후' && h < 12) h += 12;
    if (m[1] === '오전' && h === 12) h = 0;
    return h < 24 && Number(m[3]) < 60 ? `${pad(h)}:${m[3]}` : null;
  }
  m = /^(\d{2})(\d{2})(\d{2})?$/.exec(s);
  if (m && Number(m[1]) < 24 && Number(m[2]) < 60) return `${m[1]}:${m[2]}`;
  return null;
}

/** "1,234" "-1,234" "(1,234)" "1,234원" "₩1,234" "+1,234" "1234.00" → 원 단위 부호 있는 정수. 읽을 수 없으면 null (빈 칸 포함) */
export function parseMoney(raw: string): number | null {
  let s = raw.trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (/^[-−–]/.test(s)) { neg = !neg; s = s.slice(1); }
  s = s.replace(/^\+/, '').replace(/[₩원\s]/g, '').replace(/,/g, '');
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Math.round(Number(s));
  if (!Number.isSafeInteger(n)) return null;
  return neg ? -n : n;
}

export type DraftType = 'expense' | 'income';
export interface Draft {
  date: string; time: string | null; description: string; amount: number; type: DraftType;
  /** 승인취소·환불 */
  refund: boolean; balance: number | null; line: number; raw: string;
}
export interface RowIssue { line: number; reason: string; raw: string }

export interface RowOptions {
  /** 금액 칸 하나에 부호만 있을 때 양수의 뜻 (기본: 부호 없는 파일이면 지출) */
  positiveIs?: DraftType;
  now?: Date;
}

const OUT = /출금|지출|승인|결제|사용|이용|출/;
const IN = /입금|수입|입/;
const CANCEL = /취소|환불|반품|환급/;

/** 표의 데이터 행들을 거래 초안으로. 읽지 못한 행은 issues 로 */
export function rowsToDrafts(rows: string[][], map: Mapping, opts: RowOptions = {}): { drafts: Draft[]; issues: RowIssue[] } {
  const drafts: Draft[] = [];
  const issues: RowIssue[] = [];
  const cell = (r: string[], k: keyof Mapping) => (map[k] === undefined ? '' : (r[map[k] as number] ?? '').trim());
  // 금액 칸 하나만 있고 음수가 하나도 없으면 "양수 = 지출"(카드 내역 등)로 본다
  const amountOnly = map.amount !== undefined && map.withdraw === undefined && map.deposit === undefined;
  const anyNegative = amountOnly && rows.some((r) => (parseMoney(cell(r, 'amount')) ?? 0) < 0);
  const positiveIs: DraftType = opts.positiveIs ?? (anyNegative ? 'income' : 'expense');
  rows.forEach((r, idx) => {
    const raw = r.join(' | ');
    const line = idx + 1;
    const dt = normalizeDate(cell(r, 'date'), opts.now);
    if (!dt) { issues.push({ line, reason: '날짜를 읽지 못했어요', raw }); return; }
    const timeCell = cell(r, 'time');
    const tm = parseTime(timeCell);
    let amount: number | null = null;
    let type: DraftType = 'expense';
    let refund = false;
    const kind = cell(r, 'kind');
    const wd = parseMoney(cell(r, 'withdraw'));
    const dp = parseMoney(cell(r, 'deposit'));
    if (map.withdraw !== undefined || map.deposit !== undefined) {
      if (wd && wd !== 0) { amount = Math.abs(wd); type = 'expense'; if (wd < 0) { type = 'income'; refund = true; } }
      else if (dp && dp !== 0) { amount = Math.abs(dp); type = 'income'; if (dp < 0) { type = 'expense'; } }
    } else if (map.amount !== undefined) {
      const a = parseMoney(cell(r, 'amount'));
      if (a !== null && a !== 0) {
        amount = Math.abs(a);
        if (kind && CANCEL.test(kind)) { type = 'income'; refund = true; }
        else if (kind && OUT.test(kind) && !IN.test(kind.replace(OUT, ''))) type = 'expense';
        else if (kind && IN.test(kind)) type = 'income';
        else type = (a > 0) === (positiveIs === 'expense') ? 'expense' : 'income';
      }
    }
    if (amount === null) { issues.push({ line, reason: '금액을 읽지 못했어요', raw }); return; }
    const desc = cell(r, 'desc') || cell(r, 'memo');
    if (CANCEL.test(kind) && type === 'expense') { type = 'income'; refund = true; }
    if (map.withdraw !== undefined && CANCEL.test(desc) && type === 'expense') { type = 'income'; refund = true; }
    drafts.push({ date: dt.date, time: tm ?? dt.time, description: desc, amount, type, refund, balance: parseMoney(cell(r, 'balance')), line, raw });
  });
  return { drafts, issues };
}

