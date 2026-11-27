import type { Account, Category } from './types';

/** 공백 제거 + 소문자 */
export const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase();

export type MatchResult<T> = { ok: true; item: T } | { ok: false; error: 'not_found' | 'ambiguous'; candidates: T[] };

/**
 * 이름 매칭 규칙: 공백·대소문자 무시 후 완전일치 우선, 없으면 부분일치가 유일할 때만, 모호하면 후보 목록.
 * labels(item) 은 한 항목이 가질 수 있는 이름들(예: 소분류는 '소분류'와 '대분류>소분류').
 */
export function matchByName<T>(items: T[], query: string, labels: (t: T) => string[], idOf: (t: T) => string): MatchResult<T> {
  const q = norm(query);
  if (!q) return { ok: false, error: 'not_found', candidates: [] };
  const byId = items.find((i) => idOf(i) === query);
  if (byId) return { ok: true, item: byId };
  const exact = items.filter((i) => labels(i).some((l) => norm(l) === q));
  if (exact.length === 1) return { ok: true, item: exact[0] };
  if (exact.length > 1) return { ok: false, error: 'ambiguous', candidates: exact };
  const part = items.filter((i) => labels(i).some((l) => norm(l).includes(q)));
  if (part.length === 1) return { ok: true, item: part[0] };
  if (part.length > 1) return { ok: false, error: 'ambiguous', candidates: part };
  return { ok: false, error: 'not_found', candidates: [] };
}

export const matchAccount = (accounts: Account[], query: string) =>
  matchByName(accounts.filter((a) => !a.archived), query, (a) => [a.name], (a) => a.id);

/** "대분류>소분류" 표기용 이름 */
export function categoryPath(c: Category, all: Category[]): string {
  const p = c.parent_id ? all.find((x) => x.id === c.parent_id) : undefined;
  return p ? `${p.name}>${c.name}` : c.name;
}

export function matchCategory(categories: Category[], query: string, type: 'expense' | 'income') {
  const pool = categories.filter((c) => c.type === type && !c.archived);
  return matchByName(pool, query, (c) => [c.name, categoryPath(c, categories)], (c) => c.id);
}
