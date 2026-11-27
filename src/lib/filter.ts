import { norm } from './match';
import type { Category, Tx, TxType } from './types';

export interface TxFilter {
  query?: string;
  accountId?: string | null;
  categoryId?: string | null; // 대분류면 소분류 포함
  type?: TxType | null;
  from?: string;
  to?: string;
}

/** 검색어: 가맹점·메모·태그·카테고리 이름·금액(숫자만 입력 시 부분일치) */
export function filterTxs(txs: Tx[], f: TxFilter, cats: Category[]): Tx[] {
  const q = norm(f.query ?? '');
  const digits = (f.query ?? '').replace(/[^\d]/g, '');
  const catIds = f.categoryId ? new Set([f.categoryId, ...cats.filter((c) => c.parent_id === f.categoryId).map((c) => c.id)]) : null;
  const catName = (id: string | null) => (id ? cats.find((c) => c.id === id)?.name ?? '' : '');
  return txs.filter((t) => {
    if (f.type && t.type !== f.type) return false;
    if (f.accountId && t.account_id !== f.accountId && t.to_account_id !== f.accountId) return false;
    if (catIds && (!t.category_id || !catIds.has(t.category_id))) return false;
    if (f.from && t.date < f.from) return false;
    if (f.to && t.date > f.to) return false;
    if (q) {
      const hay = norm([t.merchant, t.memo, t.tags, catName(t.category_id)].filter(Boolean).join(' '));
      const amountHit = digits.length >= 2 && String(t.amount).includes(digits) && /^[\d,\s원]+$/.test(f.query ?? '');
      if (!hay.includes(q) && !amountHit) return false;
    }
    return true;
  });
}

/** 날짜(내림차순)별 묶음과 일 합계(수입 +, 지출 −, 이체 제외) */
export function groupByDate(txs: Tx[]): { date: string; items: Tx[]; net: number }[] {
  const sorted = [...txs].sort((a, b) => (b.date + (b.time ?? '99:99')).localeCompare(a.date + (a.time ?? '99:99')) || b.created_at.localeCompare(a.created_at));
  const out: { date: string; items: Tx[]; net: number }[] = [];
  for (const t of sorted) {
    let g = out[out.length - 1];
    if (!g || g.date !== t.date) { g = { date: t.date, items: [], net: 0 }; out.push(g); }
    g.items.push(t);
    if (t.type === 'income') g.net += t.amount;
    else if (t.type === 'expense') g.net -= t.amount;
  }
  return out;
}
