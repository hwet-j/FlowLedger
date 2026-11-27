export const fmtNum = (n: number) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
export const fmtWon = (n: number) => `${n < 0 ? '-' : ''}${fmtNum(Math.abs(n))}원`;
/** +/- 부호 포함 */
export const fmtSigned = (n: number) => (n > 0 ? `+${fmtNum(n)}원` : fmtWon(n));
/** 큰 금액 축약: 1.2만, 3.4억 (그래프 눈금용) */
export function fmtShort(n: number): string {
  const a = Math.abs(n);
  const s = n < 0 ? '-' : '';
  if (a >= 100_000_000) return `${s}${(a / 100_000_000).toFixed(a % 100_000_000 === 0 ? 0 : 1)}억`;
  if (a >= 10_000) return `${s}${(a / 10_000).toFixed(a % 10_000 === 0 ? 0 : 1)}만`;
  return `${s}${a}`;
}
/** 입력 문자열 → 정수 원. 숫자 외 문자 제거. 비어 있으면 0 */
export function parseAmount(s: string): number {
  const d = s.replace(/[^\d]/g, '');
  if (!d) return 0;
  const n = Number(d);
  return Number.isSafeInteger(n) ? n : 0;
}
