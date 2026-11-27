import { splitSql } from '../src/db/sqlSplit';
import { PRAGMAS, SCHEMA_V1, MIGRATE_V2_ITEMS } from '../src/db/schema';

test('여러 문장을 나눈다', () => {
  expect(splitSql('PRAGMA foreign_keys = ON;\nSELECT 1;')).toEqual(['PRAGMA foreign_keys = ON', 'SELECT 1']);
  expect(splitSql('SELECT 1')).toEqual(['SELECT 1']);
  expect(splitSql('  ;; ')).toEqual([]);
});

test("따옴표 안의 ; 와 '' 이스케이프, 큰따옴표 식별자는 나누지 않는다", () => {
  expect(splitSql("INSERT INTO t VALUES('a;b', 'it''s; ok'); SELECT \"x;y\" FROM t;")).toEqual([
    "INSERT INTO t VALUES('a;b', 'it''s; ok')", 'SELECT "x;y" FROM t',
  ]);
});

test('주석 안의 ; 는 무시하고 주석은 버린다', () => {
  expect(splitSql('SELECT 1; -- 설명; 여기까지\nSELECT 2 /* a; b */;')).toEqual(['SELECT 1', 'SELECT 2']);
});

test('앱 스키마: 모든 문장이 CREATE/ALTER/PRAGMA 로 시작하고 ; 가 남지 않는다', () => {
  for (const sql of [PRAGMAS, SCHEMA_V1, MIGRATE_V2_ITEMS]) {
    const parts = splitSql(sql);
    expect(parts.length).toBeGreaterThan(0);
    for (const p of parts) {
      expect(p).toMatch(/^(CREATE|ALTER|PRAGMA|INSERT|DROP|UPDATE)\b/i);
      expect(p).not.toContain(';');
    }
  }
  expect(splitSql(SCHEMA_V1).filter((s) => /^CREATE TABLE/i.test(s)).length).toBeGreaterThanOrEqual(9);
});
