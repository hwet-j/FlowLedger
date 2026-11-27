import { isHm, isYmd } from './dates';
import { validateItems } from './items';
import type { Account, AccountRule, Budget, Category, Goal, Recurring, Template, Tx, TxItem } from './types';

export interface BackupData {
  v: 1;
  app: 'flowledger';
  exported_at: string;
  accounts: Account[];
  categories: Category[];
  transactions: Tx[];
  budgets: Budget[];
  recurring: Recurring[];
  rules: AccountRule[];
  /** v1.0 초기 백업에는 없을 수 있음 */
  templates?: Template[];
  goals?: Goal[];
  /** 영수증 품목 (이전 백업에는 없을 수 있음) */
  items?: TxItem[];
  /** 가맹점 합치기 별칭 (이전 백업에는 없을 수 있음) */
  merchant_aliases?: { alias_key: string; canonical: string }[];
  /** 가져오기에서 학습한 가맹점 → 분류 */
  merchant_categories?: { merchant_key: string; category_id: string }[];
}

export const makeBackup = (d: Omit<BackupData, 'v' | 'app' | 'exported_at'>, now: Date = new Date()): string =>
  JSON.stringify({ v: 1, app: 'flowledger', exported_at: now.toISOString(), ...d }, null, 1);

const TYPES = ['expense', 'income', 'transfer'];
const KINDS = ['bank', 'card', 'cash', 'savings', 'invest', 'loan', 'other'];
const isInt = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n);

/** 복원 전 검증. 오류 문장 목록(비어 있으면 통과). 참조 무결성(통장·카테고리)과 값 범위까지 본다 */
export function validateBackup(raw: unknown): { ok: true; data: BackupData } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const d = raw as Partial<BackupData> | null;
  if (!d || typeof d !== 'object' || d.app !== 'flowledger' || d.v !== 1) return { ok: false, errors: ['FlowLedger 백업 파일이 아니에요'] };
  for (const k of ['accounts', 'categories', 'transactions', 'budgets', 'recurring', 'rules'] as const) {
    if (!Array.isArray(d[k])) errors.push(`${k} 목록이 없어요`);
  }
  if (errors.length) return { ok: false, errors };
  const accounts = d.accounts as Account[];
  const cats = d.categories as Category[];
  const dup = (ids: string[], what: string) => { if (new Set(ids).size !== ids.length) errors.push(`${what} id 가 중복돼요`); };
  dup(accounts.map((a) => a.id), '통장');
  dup(cats.map((c) => c.id), '카테고리');
  dup((d.transactions as Tx[]).map((t) => t.id), '거래');
  const accIds = new Set(accounts.map((a) => a.id));
  const catIds = new Set(cats.map((c) => c.id));
  if (!accounts.length) errors.push('통장이 하나도 없어요');
  if (accounts.filter((a) => a.is_default).length !== 1) errors.push('기본 통장이 정확히 하나여야 해요');
  accounts.forEach((a) => {
    if (!a.id || !a.name || !KINDS.includes(a.kind) || !isInt(a.initial_balance)) errors.push(`통장 "${a.name ?? a.id}" 값이 올바르지 않아요`);
  });
  cats.forEach((c) => {
    if (!c.id || !c.name || !['expense', 'income'].includes(c.type)) errors.push(`카테고리 "${c.name ?? c.id}" 값이 올바르지 않아요`);
    if (c.parent_id && !catIds.has(c.parent_id)) errors.push(`카테고리 "${c.name}" 의 상위가 없어요`);
  });
  let bad = 0;
  for (const t of d.transactions as Tx[]) {
    const okRef = accIds.has(t.account_id) && (!t.to_account_id || accIds.has(t.to_account_id)) && (!t.category_id || catIds.has(t.category_id));
    const ok = TYPES.includes(t.type) && isInt(t.amount) && t.amount > 0 && isYmd(t.date) && (t.time == null || isHm(t.time)) && okRef &&
      (t.type === 'transfer' ? !!t.to_account_id && t.to_account_id !== t.account_id : !t.to_account_id);
    if (!ok && ++bad <= 5) errors.push(`거래 ${t.id ?? '?'} (${t.date ?? '날짜 없음'}) 값이 올바르지 않아요`);
  }
  if (bad > 5) errors.push(`그 밖에 올바르지 않은 거래 ${bad - 5}건`);
  (d.budgets as Budget[]).forEach((b) => {
    if (!isInt(b.amount) || b.amount <= 0 || (b.category_id && !catIds.has(b.category_id))) errors.push('예산 값이 올바르지 않아요');
  });
  (d.recurring as Recurring[]).forEach((r) => {
    if (!accIds.has(r.account_id) || !isInt(r.amount) || r.amount <= 0 || !(r.day >= 1 && r.day <= 31) || !isYmd(r.start_date)) errors.push(`고정거래 "${r.merchant ?? r.id}" 값이 올바르지 않아요`);
  });
  const txById = new Map((d.transactions as Tx[]).map((t) => [t.id, t]));
  const itemsByTx = new Map<string, TxItem[]>();
  for (const i of d.items ?? []) {
    const t = txById.get(i.transaction_id);
    if (!t || t.type !== 'expense' || !i.id) { errors.push(`품목 "${i.name ?? i.id}" 이 연결된 지출 거래가 없어요`); continue; }
    if (i.category_id && !catIds.has(i.category_id)) errors.push(`품목 "${i.name}" 의 카테고리가 없어요`);
    itemsByTx.set(i.transaction_id, [...(itemsByTx.get(i.transaction_id) ?? []), i]);
  }
  for (const [id, list] of itemsByTx) {
    const e = validateItems(list.map((i) => ({ name: i.name, qty: i.qty ?? 1, unit_price: i.unit_price ?? null, amount: i.amount, category_id: i.category_id ?? null })), txById.get(id)?.amount);
    if (e) errors.push(`거래 ${txById.get(id)?.date ?? id}: ${e}`);
  }
  (d.templates ?? []).forEach((x) => {
    if (!x.name || !isInt(x.amount) || x.amount <= 0 || (x.account_id && !accIds.has(x.account_id)) || (x.category_id && !catIds.has(x.category_id))) errors.push(`즐겨찾기 "${x.name ?? x.id}" 값이 올바르지 않아요`);
  });
  (d.goals ?? []).forEach((x) => {
    if (!x.name || !isInt(x.target) || x.target <= 0 || (x.account_id && !accIds.has(x.account_id))) errors.push(`저축 목표 "${x.name ?? x.id}" 값이 올바르지 않아요`);
  });
  (d.merchant_aliases ?? []).forEach((a) => {
    if (typeof a?.alias_key !== 'string' || !a.alias_key || typeof a.canonical !== 'string' || !a.canonical.trim()) errors.push('가맹점 별칭 값이 올바르지 않아요');
  });
  (d.merchant_categories ?? []).forEach((a) => {
    if (typeof a?.merchant_key !== 'string' || !a.merchant_key || !catIds.has(a.category_id)) errors.push('가맹점 분류 학습 값이 올바르지 않아요');
  });
  (d.rules as AccountRule[]).forEach((r) => {
    if (!r.keyword || !accIds.has(r.account_id)) errors.push(`자동 지정 규칙 "${r.keyword ?? r.id}" 값이 올바르지 않아요`);
  });
  return errors.length ? { ok: false, errors: errors.slice(0, 12) } : { ok: true, data: d as BackupData };
}

export function parseBackup(text: string) {
  try {
    return validateBackup(JSON.parse(text.replace(/^﻿/, '')));
  } catch {
    return { ok: false as const, errors: ['JSON 형식이 올바르지 않아요'] };
  }
}
