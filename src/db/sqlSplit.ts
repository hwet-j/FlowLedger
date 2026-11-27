/**
 * 여러 문장이 든 SQL 문자열을 문장별로 나눈다 (Android 의 execSQL 은 한 번에 한 문장만 실행한다).
 * 작은따옴표 문자열('..''..'), 큰따옴표 식별자, -- 한 줄 주석, 블록 주석 안의 `;` 는 구분자로 보지 않는다.
 * (트리거의 BEGIN…END 는 지원하지 않는다 — 이 앱의 스키마에는 트리거가 없다)
 */
export function splitSql(sql: string): string[] {
  const out: string[] = [];
  let cur = '';
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i];
    if (c === "'" || c === '"') {
      const q = c;
      cur += c;
      i++;
      while (i < n) {
        cur += sql[i];
        if (sql[i] === q) {
          if (sql[i + 1] === q) { cur += sql[i + 1]; i += 2; continue; } // '' 이스케이프
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (c === '-' && sql[i + 1] === '-') {
      while (i < n && sql[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && sql[i + 1] === '*') {
      i += 2;
      while (i < n && !(sql[i] === '*' && sql[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (c === ';') {
      if (cur.trim()) out.push(cur.trim());
      cur = '';
      i++;
      continue;
    }
    cur += c;
    i++;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
