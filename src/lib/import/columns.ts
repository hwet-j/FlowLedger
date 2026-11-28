/** 은행·카드 거래내역의 열(헤더) 이름을 느슨한 별칭 사전으로 알아본다 */

export type Field = 'date' | 'time' | 'desc' | 'memo' | 'withdraw' | 'deposit' | 'amount' | 'balance' | 'kind';
export type Mapping = Partial<Record<Field, number>>;

const ALIASES: Record<Field, string[]> = {
  date: ['거래일', '거래일자', '일자', '이용일', '이용일자', '승인일', '승인일자', '거래일시', '일시', '날짜', '결제일', '사용일', '이용일시', '승인일시', '거래날짜', 'date'],
  time: ['거래시간', '시간', '승인시각', '승인시간', '거래시각', 'time'],
  desc: ['적요', '거래내용', '거래처', '가맹점', '가맹점명', '이용가맹점', '이용처', '사용처', '이용상점', '상호', '기재내용', '거래기록사항', '받는분', '보낸분', '받는분보낸분', '보낸분받는분', '내용', '상대', '이용내역', '거래점', 'description', 'merchant'],
  memo: ['메모', '비고', '거래메모', '내통장메모', '내통장표시내용', 'memo', 'note'],
  withdraw: ['출금', '출금액', '출금금액', '찾으신금액', '지급', '지급금액', '지출', '지출금액', '이용금액', '승인금액', '결제금액', '사용금액', '청구금액', 'withdrawal', 'debit'],
  deposit: ['입금', '입금액', '입금금액', '맡기신금액', '수입', '수입금액', '입금금액', 'deposit', 'credit'],
  amount: ['거래금액', '금액', '거래액', 'amount'],
  balance: ['잔액', '거래후잔액', '거래후잔고', '잔고', 'balance'],
  kind: ['구분', '입출금구분', '거래구분', '승인구분', '취소여부', '거래유형', '입출구분', '유형', '결제구분', '입출'],
};

const norm = (h: string) => h.replace(/\([^)]*\)|\[[^\]]*\]/g, '').replace(/[\s/·_\-.*:]/g, '').toLowerCase();
// 괄호 안(예: 출금(원))은 지웠지만 "원" 이 직접 붙은 경우도 맞춘다
const normWon = (h: string) => norm(h).replace(/원$/, '');

/** 열 하나가 어느 필드로 보이는지 (정확 일치 우선, 그다음 포함) */
export function fieldOf(header: string): Field | null {
  const h = normWon(header);
  if (!h) return null;
  for (const [field, list] of Object.entries(ALIASES) as [Field, string[]][]) if (list.some((a) => normWon(a) === h)) return field;
  for (const [field, list] of Object.entries(ALIASES) as [Field, string[]][]) if (list.some((a) => a.length >= 2 && h.includes(normWon(a)))) return field;
  return null;
}

export interface HeaderGuess { headerRow: number; mapping: Mapping }

/** 앞쪽 줄들 중 헤더로 보이는 줄(날짜 열과 금액 계열 열이 함께 있는 줄)을 찾고 열 매핑을 추정 */
export function guessMapping(rows: string[][]): HeaderGuess {
  const limit = Math.min(rows.length, 40);
  for (let r = 0; r < limit; r++) {
    const mapping: Mapping = {};
    rows[r].forEach((cell, i) => {
      const f = fieldOf(cell);
      if (f && mapping[f] === undefined) mapping[f] = i;
    });
    const hasMoney = mapping.withdraw !== undefined || mapping.deposit !== undefined || mapping.amount !== undefined;
    if (mapping.date !== undefined && hasMoney) return { headerRow: r, mapping };
  }
  return { headerRow: -1, mapping: guessByContent(rows) };
}

const DATE_LIKE = /^\d{2,4}[./-]\d{1,2}[./-]\d{1,2}|^\d{8}$|^\d{1,2}[./]\d{1,2}$/;
const MONEY_LIKE = /^[-+(]?\s*[₩]?\s*\d[\d,]*(\.\d+)?\s*원?\)?$/;

/** 헤더가 없을 때: 값의 모양으로 날짜·금액·내용 열을 추정 */
function guessByContent(rows: string[][]): Mapping {
  const sample = rows.slice(0, 30);
  const cols = Math.max(0, ...sample.map((r) => r.length));
  const m: Mapping = {};
  const score = (i: number, re: RegExp) => sample.filter((r) => re.test((r[i] ?? '').trim())).length;
  let bestDate = -1, bestDateScore = 0;
  for (let i = 0; i < cols; i++) { const s = score(i, DATE_LIKE); if (s > bestDateScore) { bestDate = i; bestDateScore = s; } }
  if (bestDate >= 0) m.date = bestDate;
  const moneyCols: number[] = [];
  for (let i = 0; i < cols; i++) if (i !== bestDate && score(i, MONEY_LIKE) >= Math.max(2, sample.length / 3)) moneyCols.push(i);
  if (moneyCols.length === 1) m.amount = moneyCols[0];
  else if (moneyCols.length >= 2) { m.withdraw = moneyCols[0]; m.deposit = moneyCols[1]; if (moneyCols[2] !== undefined) m.balance = moneyCols[2]; }
  let bestDesc = -1, bestLen = 0;
  for (let i = 0; i < cols; i++) {
    if (i === bestDate || moneyCols.includes(i)) continue;
    const avg = sample.reduce((s, r) => s + (r[i] ?? '').length, 0) / Math.max(sample.length, 1);
    if (avg > bestLen) { bestLen = avg; bestDesc = i; }
  }
  if (bestDesc >= 0) m.desc = bestDesc;
  return m;
}

/** 은행/카드 프리셋 이름 (화면 표시용): 헤더로 추정한 결과가 어떤 양식에 가까운지 짐작 */
export function describeMapping(m: Mapping): string {
  if (m.withdraw !== undefined && m.deposit !== undefined) return '출금/입금이 따로 있는 입출금 내역';
  if (m.amount !== undefined && m.kind !== undefined) return '금액 + 구분(승인/취소 등) 내역';
  if (m.withdraw !== undefined) return '이용금액 내역(카드)';
  if (m.amount !== undefined) return '부호가 있는 금액 내역';
  return '열을 직접 지정해 주세요';
}
