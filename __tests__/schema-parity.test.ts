import fs from 'node:fs';
import path from 'node:path';

import { SCHEMA_V1 } from '../src/db/schema';

const squash = (s: string) => s.replace(/IF NOT EXISTS /g, '').replace(/\s+/g, ' ').replace(/\s*,\s*/g, ',').replace(/\s*\(\s*/g, '(').replace(/\s*\)\s*/g, ')').replace(/\s*([<>=])\s*/g, '$1').trim();
const stmts = (sql: string) => sql.split(';').map(squash).filter(Boolean);

/** 비서 제공자(Kotlin)가 같은 SQLite 파일을 직접 열므로, 앱 스키마와 제공자 테스트 스키마의 공유 테이블이 어긋나면 안 된다 */
test('앱 스키마와 제공자(Python 참조) 스키마의 공유 테이블이 같다', () => {
  const py = fs.readFileSync(path.join(__dirname, '..', 'tests', 'provider', 'schema.py'), 'utf8');
  const m = /SCHEMA = """([\s\S]*?)"""/.exec(py);
  expect(m).toBeTruthy();
  const app = new Map(stmts(SCHEMA_V1).map((s) => [/^CREATE (?:TABLE|INDEX) (\w+)/.exec(s)?.[1] ?? s, s]));
  for (const s of stmts(m![1])) {
    const name = /^CREATE (?:TABLE|INDEX) (\w+)/.exec(s)?.[1] as string;
    expect(app.get(name)).toBe(s);
  }
});
