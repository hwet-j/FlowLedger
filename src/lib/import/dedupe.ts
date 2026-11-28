import { merchantKey, similarity } from '../merchants';
import type { Tx } from '../types';
import type { Draft } from './rows';

const REF_DESC_MAX = 24;
const t = (d: Draft) => `${d.type === 'expense' ? 'e' : 'i'}${d.refund ? 'r' : ''}${d.amount}`;

/**
 * 가져오기 멱등 키: `imp:<통장>:<날짜>:<유형+금액>:<정규화 적요>:<순번>`.
 * 같은 파일에서 똑같은 줄이 여러 번(같은 날 같은 가게 같은 금액) 나오면 순번으로 구분한다.
 * 다시 가져와도 같은 줄은 같은 키가 나와서 중복 저장되지 않는다(transactions.source_ref UNIQUE).
 */
export function importRefs(accountId: string, drafts: Draft[]): string[] {
  const seen = new Map<string, number>();
  return drafts.map((d) => {
    const base = `imp:${accountId}:${d.date}:${t(d)}:${merchantKey(d.description).slice(0, REF_DESC_MAX)}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return `${base}:${n}`;
  });
}

/**
 * 이미 있는 거래와 겹치는 초안의 인덱스 집합.
 * 같은 통장·날짜·금액·유형이고, source_ref 가 같거나 가맹점이 비슷하면(또는 한쪽이 비어 있으면) 같은 거래로 본다.
 * 1:1 로만 소진한다(파일에 같은 줄이 둘이고 기존에 하나면 첫 줄만 중복).
 */
export function findDuplicates(drafts: Draft[], refs: string[], existing: Tx[], accountId: string): Set<number> {
  const pool = existing.filter((x) => x.account_id === accountId && x.type !== 'transfer');
  const used = new Set<string>();
  const dup = new Set<number>();
  drafts.forEach((d, i) => {
    const wantType = d.type;
    const hit = pool.find((x) =>
      !used.has(x.id) && x.type === wantType && x.amount === d.amount && x.date === d.date &&
      (x.source_ref === refs[i] || !x.merchant?.trim() || !d.description.trim() || similarity(x.merchant, d.description) >= 0.8));
    if (hit) { used.add(hit.id); dup.add(i); }
  });
  return dup;
}
