export type TxType = 'expense' | 'income' | 'transfer';
export type AccountKind = 'bank' | 'card' | 'cash' | 'savings' | 'invest' | 'loan' | 'other';
export type TxSource = 'app' | 'assistant' | 'recurring';
export type RuleMatch = 'merchant' | 'category' | 'memo' | 'any';

export interface Account {
  id: string;
  name: string;
  kind: AccountKind;
  initial_balance: number;
  is_default: number;
  archived: number;
  sort: number;
  created_at: string;
}

export interface Category {
  id: string;
  name: string;
  type: 'expense' | 'income';
  parent_id: string | null;
  icon: string | null;
  color: string | null;
  sort: number;
  archived: number;
}

export interface Tx {
  id: string;
  type: TxType;
  amount: number;
  date: string; // YYYY-MM-DD
  time: string | null; // HH:MM
  account_id: string;
  to_account_id: string | null;
  category_id: string | null;
  merchant: string | null;
  memo: string | null;
  tags: string | null;
  source: TxSource;
  source_ref: string | null;
  recurring_id: string | null;
  created_at: string;
  updated_at: string;
  /** 앱이 보관한 영수증 사진 경로 (앱 전용, 백업에는 경로만 들어가고 사진 파일은 포함되지 않음) */
  receipt_uri: string | null;
}

export interface TxItem {
  id: string;
  transaction_id: string;
  name: string;
  qty: number;
  unit_price: number | null;
  /** 품목 금액(수량 반영 후). 할인/쿠폰 줄은 음수 */
  amount: number;
  category_id: string | null;
  sort: number;
}

/** 입력 폼/비서가 넘기는 품목 (id 는 저장할 때 만든다) */
export type ItemInput = Pick<TxItem, 'name' | 'qty' | 'unit_price' | 'amount' | 'category_id'>;

export interface Budget {
  id: string;
  category_id: string | null; // null = 월 전체 지출
  amount: number;
}

export interface Recurring {
  id: string;
  type: TxType;
  amount: number;
  account_id: string;
  to_account_id: string | null;
  category_id: string | null;
  merchant: string | null;
  memo: string | null;
  day: number;
  start_date: string;
  end_date: string | null;
  last_run: string | null;
  active: number;
}

export interface AccountRule {
  id: string;
  keyword: string;
  match: RuleMatch;
  account_id: string;
  created_at: string;
}

export const KIND_LABEL: Record<AccountKind, string> = {
  bank: '입출금 통장', card: '카드', cash: '현금', savings: '저축', invest: '투자', loan: '대출', other: '기타',
};
export const TYPE_LABEL: Record<TxType, string> = { expense: '지출', income: '수입', transfer: '이체' };

export interface Template {
  id: string;
  name: string;
  type: TxType;
  amount: number;
  account_id: string | null; // null = 규칙/기본 통장으로
  to_account_id: string | null;
  category_id: string | null;
  merchant: string | null;
  memo: string | null;
  sort: number;
}

export interface Goal {
  id: string;
  name: string;
  target: number;
  account_id: string | null; // 연결 통장(잔액이 진행액)
  saved: number; // 연결 통장이 없을 때 수동 입력 진행액
  due_date: string | null;
  created_at: string;
}
