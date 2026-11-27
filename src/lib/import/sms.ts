import { isYmd } from '../dates';
import { parseTime, type Draft, type RowIssue } from './rows';

const pad = (n: number) => String(n).padStart(2, '0');

/** 붙여넣은 글을 문자 한 건씩 나눈다: 빈 줄, [Web발신]/[국제발신] 머리말 기준 */
export function splitMessages(text: string): string[] {
  const src = text.replace(/\r/g, '').trim();
  if (!src) return [];
  return src.split(/\n\s*\n+|\n(?=\[(?:Web발신|국제발신|web발신)\])|(?=^\[(?:Web발신|국제발신)\])/m)
    .map((m) => m.replace(/\[(?:Web발신|국제발신|web발신)\]/g, ' ').replace(/\s*\n\s*/g, ' ').replace(/\s{2,}/g, ' ').trim())
    .filter((m) => /\d/.test(m) && /원/.test(m));
}

const SKIP_BEFORE = /(잔액|누적|한도|잔여|사용가능|가능금액|총|합계|이용한도|포인트)\s*[:：]?\s*$/;

/** 금액 후보 중 잔액·누적·한도가 아닌 첫 번째 */
function pickAmount(msg: string): { amount: number; index: number; end: number } | null {
  const re = /(\d{1,3}(?:,\d{3})+|\d+)\s*원/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(msg))) {
    const before = msg.slice(Math.max(0, m.index - 8), m.index);
    if (SKIP_BEFORE.test(before)) continue;
    const n = Number(m[1].replace(/,/g, ''));
    if (Number.isSafeInteger(n) && n > 0) return { amount: n, index: m.index, end: m.index + m[0].length };
  }
  return null;
}

function pickDate(msg: string, now: Date): { date: string; explicit: boolean } {
  let m: RegExpExecArray | null;
  const full = (y: number, mo: number, d: number) => { const s = `${y}-${pad(mo)}-${pad(d)}`; return isYmd(s) ? s : null; };
  if ((m = /(20\d{2})[-./](\d{1,2})[-./](\d{1,2})/.exec(msg))) { const s = full(+m[1], +m[2], +m[3]); if (s) return { date: s, explicit: true }; }
  if ((m = /(\d{1,2})월\s*(\d{1,2})일/.exec(msg)) || (m = /(?<![\d,])(\d{1,2})\/(\d{1,2})(?![\d/])/.exec(msg))) {
    const mo = +m[1], d = +m[2];
    let y = now.getFullYear();
    let s = full(y, mo, d);
    if (s && new Date(`${s}T00:00:00`) > new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)) s = full(--y, mo, d);
    if (s) return { date: s, explicit: true };
  }
  return { date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`, explicit: false };
}

type Kind = 'expense' | 'income' | 'refund';
function pickKind(msg: string): Kind | null {
  if (/승인\s*취소|결제\s*취소|취소|환불|반품/.test(msg)) return 'refund';
  const out = /출금|승인|결제|사용|일시불|할부|체크|지출|이체\s*출금|자동이체/.test(msg);
  const inn = /입금|급여|이자|환급|받으|받았/.test(msg);
  if (inn && !out) return 'income';
  if (out) return 'expense';
  if (inn) return 'income';
  return null;
}

const NOISE_WORDS = /(?:\[[^\]]*\]|\([^)]*\)|(?:국민|신한|삼성|현대|롯데|하나|우리|비씨|BC|NH|농협|씨티|카카오|토스|케이|K)\s*(?:은행|카드|뱅크|페이)?(?:\w{0,2})?|승인취소|승인|결제취소|결제|출금|입금|사용|취소|환불|일시불|할부\s*\d*\s*(?:개월)?|체크카드|체크|이체|자동이체|잔액|누적|한도|[\d,]+\s*원|\d{1,2}[/.]\d{1,2}|\d{1,2}:\d{2}(?::\d{2})?|20\d{2}[-./]\d{1,2}[-./]\d{1,2}|\d{1,2}월\s*\d{1,2}일|\d{3,}\*+\d*|\d{4}|[가-힣A-Za-z]\*[가-힣A-Za-z*]*|\*+)/gi;

/** 가맹점/내용: 시각 뒤(카드) 또는 금액 뒤(계좌)의 글에서 알려진 잡음 단어를 걷어낸다 */
function pickDescription(msg: string, amount: { index: number; end: number }, timeEnd: number): string {
  const stops = /(누적|잔액|한도|잔여|사용가능|총|합계)/;
  const cut = (s: string) => { const m = stops.exec(s); return m ? s.slice(0, m.index) : s; };
  const clean = (s: string) => cut(s).replace(NOISE_WORDS, ' ').replace(/\s{2,}/g, ' ').trim();
  const candidates = [timeEnd >= 0 ? clean(msg.slice(timeEnd)) : '', clean(msg.slice(amount.end)), clean(msg.slice(0, amount.index))];
  for (const c of candidates) if (c.length >= 1 && c.length <= 40) return c;
  return '';
}

export interface SmsResult { drafts: Draft[]; issues: RowIssue[] }

/** 카드 승인·계좌 입출금 문자(여러 건 가능) → 거래 초안. 읽지 못한 문자는 issues 로 남긴다 */
export function parseSms(text: string, now: Date = new Date()): SmsResult {
  const drafts: Draft[] = [];
  const issues: RowIssue[] = [];
  splitMessages(text).forEach((msg, idx) => {
    const line = idx + 1;
    const amt = pickAmount(msg);
    if (!amt) { issues.push({ line, reason: '금액을 찾지 못했어요', raw: msg }); return; }
    const kind = pickKind(msg);
    if (!kind) { issues.push({ line, reason: '승인/입금/출금 같은 구분을 알아보지 못했어요', raw: msg }); return; }
    const { date, explicit } = pickDate(msg, now);
    const tm = /(\d{1,2}):(\d{2})(?::\d{2})?/.exec(msg);
    const time = tm ? parseTime(`${tm[1]}:${tm[2]}`) : null;
    const timeEnd = tm ? tm.index + tm[0].length : -1;
    const description = pickDescription(msg, amt, timeEnd);
    drafts.push({
      date, time, description, amount: amt.amount, type: kind === 'expense' ? 'expense' : 'income', refund: kind === 'refund',
      balance: null, line, raw: explicit ? msg : `${msg}  (날짜가 없어 오늘로 처리)`,
    });
  });
  return { drafts, issues };
}
