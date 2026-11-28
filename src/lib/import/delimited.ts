/** 구분자 텍스트(CSV/TSV) 해석: 따옴표·이스케이프·줄바꿈, BOM, 구분자 자동 추정 */

export type Delimiter = ',' | '\t' | ';' | '|';
const CANDIDATES: Delimiter[] = ['\t', ',', ';', '|'];

/** 앞쪽 몇 줄에서 가장 일관되게 나타나는 구분자를 고른다 (따옴표 안은 세지 않음) */
export function detectDelimiter(text: string): Delimiter {
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 30);
  let best: Delimiter = ',';
  let bestScore = -1;
  for (const d of CANDIDATES) {
    const counts = lines.map((l) => countOutsideQuotes(l, d));
    const multi = counts.filter((c) => c > 0);
    if (multi.length < 2) { if (multi.length === 1 && bestScore < 0.5) { best = d; bestScore = 0.5; } continue; }
    const mode = multi.sort((a, b) => a - b)[Math.floor(multi.length / 2)];
    const score = counts.filter((c) => c === mode).length * mode;
    if (score > bestScore) { best = d; bestScore = score; }
  }
  return best;
}

function countOutsideQuotes(line: string, d: string): number {
  let q = false, n = 0;
  for (const ch of line) { if (ch === '"') q = !q; else if (ch === d && !q) n++; }
  return n;
}

export function parseDelimited(text: string, delimiter?: Delimiter): string[][] {
  const src = text.replace(/^\uFEFF/, '');
  const d = delimiter ?? detectDelimiter(src);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (q) {
      if (ch === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch;
    } else if (ch === '"' && cell === '') q = true;
    else if (ch === d) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      rows.push(row); row = [];
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c !== ''));
}
