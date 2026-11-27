import type { Account, Category, Tx } from './types';
import { TYPE_LABEL } from './types';

const HEADER = ['날짜', '시간', '유형', '금액', '통장', '입금통장', '대분류', '소분류', '가맹점', '메모', '태그', '출처'];
const SRC = { app: '앱', assistant: '비서', recurring: '고정거래' } as const;

/** 엑셀 수식 주입 방지: = + - @ 로 시작하는 텍스트는 앞에 ' 를 붙인다 */
const safe = (s: string) => (/^[=+\-@\t\r]/.test(s) ? `'${s}` : s);
const cell = (v: string | number | null | undefined) => {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'number' ? String(v) : safe(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** UTF-8 BOM 포함 CSV (엑셀에서 한글이 깨지지 않게). 날짜 오름차순 */
export function toCsv(txs: Tx[], accounts: Account[], cats: Category[]): string {
  const acc = new Map(accounts.map((a) => [a.id, a.name]));
  const cat = new Map(cats.map((c) => [c.id, c]));
  const rows = [...txs]
    .sort((a, b) => (a.date + (a.time ?? '')).localeCompare(b.date + (b.time ?? '')))
    .map((t) => {
      const c = t.category_id ? cat.get(t.category_id) : undefined;
      const parent = c?.parent_id ? cat.get(c.parent_id) : undefined;
      return [
        t.date, t.time, TYPE_LABEL[t.type], t.amount, acc.get(t.account_id), t.to_account_id ? acc.get(t.to_account_id) : '',
        parent ? parent.name : c?.name, parent ? c?.name : '', t.merchant, t.memo, t.tags, SRC[t.source],
      ].map(cell).join(',');
    });
  return `﻿${[HEADER.join(','), ...rows].join('\r\n')}\r\n`;
}
