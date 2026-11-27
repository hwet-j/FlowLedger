import { seedAccounts, seedCategories } from '../src/lib/seed';
import type { Account, AccountRule, Tx } from '../src/lib/types';

export const NOW = '2026-11-27T00:00:00.000Z';
export const cats = seedCategories();
export const accs = (): Account[] => [
  ...seedAccounts(NOW),
  { id: 'acc_card', name: '국민카드', kind: 'card', initial_balance: 0, is_default: 0, archived: 0, sort: 1, created_at: NOW },
  { id: 'acc_cash', name: '현금', kind: 'cash', initial_balance: 50_000, is_default: 0, archived: 0, sort: 2, created_at: NOW },
  { id: 'acc_old', name: '옛 통장', kind: 'bank', initial_balance: 0, is_default: 0, archived: 1, sort: 3, created_at: NOW },
];
let n = 0;
export const tx = (p: Partial<Tx>): Tx => ({
  id: `t${++n}`, type: 'expense', amount: 1000, date: '2026-11-10', time: null, account_id: 'acc_main', to_account_id: null,
  category_id: 'cat_food_eat_out', merchant: null, memo: null, tags: null, source: 'app', source_ref: null, recurring_id: null,
  created_at: NOW, updated_at: NOW, receipt_uri: null, ...p,
});
export const rule = (p: Partial<AccountRule>): AccountRule => ({ id: `r${++n}`, keyword: 'x', match: 'any', account_id: 'acc_card', created_at: NOW, ...p });
