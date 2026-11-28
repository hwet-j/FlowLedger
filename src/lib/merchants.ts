/**
 * 가맹점 이름 정리: 같은 가게의 표기 변형("스타벅스 강남점" / "STARBUCKS" / "스타벅스코리아")을 한 가게로 합친다.
 * 사용자가 합친 별칭(merchant_aliases)이 자동 정규화보다 우선한다.
 */

// 공백으로 구분된 꼬리표만 지점으로 본다 ("스타벅스 강남점", "GS25 역삼역점", "롯데리아 본점"). 붙여 쓴 이름은 합치기 제안이 맡는다
const BRANCH_TOKEN = /\s+[^\s]{1,8}(?:본점|지점|직영점|역점|점|매장|코리아|korea)$/i;
const NOISE = /(?:\(주\)|주식회사|㈜|\(유\)|유한회사)/g;
const ENGLISH_KO: [RegExp, string][] = [
  [/starbucks/g, '스타벅스'], [/mcdonald'?s?/g, '맥도날드'], [/burgerking/g, '버거킹'], [/lotteria/g, '롯데리아'],
  [/baemin/g, '배달의민족'], [/coupang/g, '쿠팡'], [/netflix/g, '넷플릭스'], [/youtube/g, '유튜브'], [/kakaot/g, '카카오t'],
  [/gs25/g, 'gs25'], [/emart/g, '이마트'],
];

/** 비교용 키: 괄호 안·지점 꼬리표 제거, 공백·특수문자 제거, 소문자, 영문 대표 표기 → 한글 */
export function merchantKey(name: string): string {
  let s = name.normalize('NFKC').toLowerCase().replace(NOISE, '');
  s = s.replace(/\([^)]*\)|\[[^\]]*\]/g, '').trim();
  for (let i = 0; i < 2; i++) { const next = s.replace(BRANCH_TOKEN, ''); if (next === s || next.replace(/\s/g, '').length < 2) break; s = next; }
  s = s.replace(/[\s\-_.·,/*#&'"`~!@^+=|\\:;?<>{}]+/g, '');
  for (const [re, ko] of ENGLISH_KO) s = s.replace(re, ko);
  // 붙여 쓴 국가 꼬리표(스타벅스코리아)도 같은 가게로
  const noCountry = s.replace(/(?:코리아|korea)$/, '');
  if (noCountry.length >= 2) s = noCountry;
  return s;
}

export type AliasMap = ReadonlyMap<string, string>; // merchantKey → 대표 이름

/** 대표 이름 (별칭이 있으면 그것, 없으면 입력 이름 그대로) */
export function canonicalMerchant(name: string, aliases?: AliasMap): string {
  const k = merchantKey(name);
  return aliases?.get(k) ?? name.trim();
}

/** 집계용 키: 별칭 → 대표 이름의 키, 아니면 자기 키 */
export function groupKey(name: string, aliases?: AliasMap): string {
  const canon = aliases?.get(merchantKey(name));
  return merchantKey(canon ?? name) || name.trim().toLowerCase();
}

function distance(a: string, b: string): number {
  if (a === b) return 0;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return dp[a.length][b.length];
}

/** 0~1. 키가 같으면 1, 한쪽이 다른 쪽을 포함(3자 이상)하면 0.9, 그 외 편집거리 기반 */
export function similarity(a: string, b: string): number {
  const ka = merchantKey(a), kb = merchantKey(b);
  if (!ka || !kb) return 0;
  if (ka === kb) return 1;
  const [s, l] = ka.length <= kb.length ? [ka, kb] : [kb, ka];
  if (s.length >= 3 && l.includes(s)) return 0.9;
  return Math.max(0, 1 - distance(ka, kb) / Math.max(ka.length, kb.length));
}

export interface MergeSuggestion { a: string; b: string; score: number }

/**
 * 합칠 만한 이름 쌍 제안. 이미 같은 그룹(별칭으로 합쳐졌거나 키가 같은 것)은 제외.
 * names 는 (이름, 합계) — 합계가 큰 쪽을 대표로 삼도록 a 가 더 큰 쪽이다.
 */
export function suggestMerges(names: { name: string; total: number }[], aliases?: AliasMap, threshold = 0.8, limit = 12): MergeSuggestion[] {
  const list = [...names].sort((x, y) => y.total - x.total).slice(0, 80);
  const out: MergeSuggestion[] = [];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      if (groupKey(list[i].name, aliases) === groupKey(list[j].name, aliases)) continue;
      const score = similarity(list[i].name, list[j].name);
      if (score >= threshold) out.push({ a: list[i].name, b: list[j].name, score });
    }
  }
  return out.sort((x, y) => y.score - x.score).slice(0, limit);
}

const HANGUL = /[가-힣]/;
/** 같은 가게의 여러 표기 중 보여 줄 이름: 별칭 > 한글 이름 > 짧은 이름(브랜드) > 금액 큰 쪽 */
export function pickName(names: Map<string, number>, aliases?: AliasMap): string {
  const list = [...names.entries()];
  const aliased = list.find(([n]) => aliases?.has(merchantKey(n)));
  if (aliased) return aliases!.get(merchantKey(aliased[0])) as string;
  return list.sort((a, b) => Number(HANGUL.test(b[0])) - Number(HANGUL.test(a[0])) || a[0].length - b[0].length || b[1] - a[1])[0][0].trim();
}
