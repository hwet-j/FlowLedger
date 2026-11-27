import { isYmd } from '../dates';
import type { Account, Category, Tx } from '../types';
import { categoryPath } from '../match';
import { classify, transferHint, TRANSFER_LABEL, type ClassifySource, type TransferKind } from './classify';
import { findDuplicates, importRefs } from './dedupe';
import type { Draft } from './rows';

export type PlanAction = 'import' | 'skip';

export interface PlanRow {
  /** 화면 안에서의 행 번호 (draft 순서) */
  idx: number;
  draft: Draft;
  action: PlanAction;
  category_id: string | null;
  categorySource: ClassifySource;
  merchant: string | null;
  ref: string;
  duplicate: boolean;
  transfer: TransferKind | null;
  transferLabel: string | null;
}

export interface PlanContext {
  accountId: string;
  categories: Category[];
  existing: Tx[];
  learned?: ReadonlyMap<string, string>;
}

const MISC_EXPENSE = 'cat_misc';
const MISC_INCOME = 'cat_inc_misc';

/**
 * 가져오기 초안 → 미리보기 계획.
 * - 분류: 학습 > 키워드 사전 > 기타(미분류)
 * - 중복(이미 있는 거래)·내부 이동 후보(카드 대금, 현금 인출 등)는 기본 "건너뜀"
 * - 환불은 수입(환급)으로, 날짜/금액이 이상한 행은 계획에서 빠진다
 */
export function buildPlan(drafts: Draft[], ctx: PlanContext): PlanRow[] {
  const ids = new Set(ctx.categories.filter((c) => !c.archived).map((c) => c.id));
  const refs = importRefs(ctx.accountId, drafts);
  const dups = findDuplicates(drafts, refs, ctx.existing, ctx.accountId);
  const fallback = (type: 'expense' | 'income') => (ids.has(type === 'expense' ? MISC_EXPENSE : MISC_INCOME) ? (type === 'expense' ? MISC_EXPENSE : MISC_INCOME) : null);
  return drafts.map((d, i) => {
    const valid = isYmd(d.date) && Number.isSafeInteger(d.amount) && d.amount > 0;
    const c = classify(d.description, d.type, ctx.learned, ids);
    const refundCat = d.refund && ids.has('cat_refund') ? 'cat_refund' : null;
    const category_id = valid ? (c.category_id ?? refundCat ?? fallback(d.type)) : null;
    const transfer = d.type === 'expense' ? transferHint(d.description) : null;
    const duplicate = dups.has(i);
    return {
      idx: i, draft: d, action: valid && !duplicate && !transfer ? 'import' : 'skip', category_id,
      categorySource: c.category_id ? c.source : null, merchant: d.description.trim() ? d.description.trim().slice(0, 80) : null,
      ref: refs[i], duplicate, transfer, transferLabel: transfer ? TRANSFER_LABEL[transfer] : null,
    };
  });
}

export interface PlanSummary {
  total: number; selected: number; expense: number; income: number; skippedDuplicate: number; skippedTransfer: number; skippedOther: number;
  expenseCount: number; incomeCount: number;
}

export function summarizePlan(rows: PlanRow[]): PlanSummary {
  const s: PlanSummary = { total: rows.length, selected: 0, expense: 0, income: 0, skippedDuplicate: 0, skippedTransfer: 0, skippedOther: 0, expenseCount: 0, incomeCount: 0 };
  for (const r of rows) {
    if (r.action === 'import') {
      s.selected++;
      if (r.draft.type === 'expense') { s.expense += r.draft.amount; s.expenseCount++; } else { s.income += r.draft.amount; s.incomeCount++; }
    } else if (r.duplicate) s.skippedDuplicate++;
    else if (r.transfer) s.skippedTransfer++;
    else s.skippedOther++;
  }
  return s;
}

export function categoryLabel(id: string | null, cats: Category[]): string {
  const c = id ? cats.find((x) => x.id === id) : undefined;
  return c ? categoryPath(c, cats) : '미분류';
}

/**
 * 사용자가 미리보기에서 바꾼 분류를 "앞으로도" 학습할 목록으로.
 * 자동 분류 결과와 다르고 가맹점이 있는 선택된 행만.
 */
export function learnableChoices(rows: PlanRow[], original: PlanRow[]): { merchant: string; category_id: string }[] {
  const out = new Map<string, { merchant: string; category_id: string }>();
  rows.forEach((r, i) => {
    if (r.action !== 'import' || !r.merchant || !r.category_id) return;
    if (r.category_id !== original[i]?.category_id) out.set(r.merchant, { merchant: r.merchant, category_id: r.category_id });
  });
  return [...out.values()];
}

/** 선택된 행 → 저장용 행 */
export function toImportRows(rows: PlanRow[], accountId: string) {
  return rows.filter((r) => r.action === 'import').map((r) => ({
    type: r.draft.type as 'expense' | 'income', amount: r.draft.amount, date: r.draft.date, time: r.draft.time, account_id: accountId, to_account_id: null as string | null,
    category_id: r.category_id, merchant: r.merchant, memo: r.draft.refund ? '승인취소·환불' : null, source_ref: r.ref,
  }));
}

export type { Account };
