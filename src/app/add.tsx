import { useLocalSearchParams } from 'expo-router';
import React, { useMemo } from 'react';

import { TxForm, type FormInit } from '../components/TxForm';
import { isHm, isYmd } from '../lib/dates';
import { matchAccount, matchCategory } from '../lib/match';
import { parseAmount } from '../lib/money';
import type { TxType } from '../lib/types';
import { useLedger } from '../store';

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * 새 내역. 딥링크 flowledger://add?type=expense&amount=9000&category=외식&account=국민카드&merchant=...&date=2026-11-27 로
 * 값을 미리 채울 수 있다 (저장은 사용자가). copy=<거래 id> 면 그 내역을 복사해 오늘 날짜로 연다.
 */
export default function AddScreen() {
  const { ready, txs, categories, accounts } = useLedger();
  const p = useLocalSearchParams<Record<string, string | string[]>>();
  const init = useMemo<FormInit | undefined>(() => {
    const copy = one(p.copy);
    if (copy) {
      const s = txs.find((x) => x.id === copy);
      if (s) return { type: s.type, amount: s.amount, accountId: s.account_id, toAccountId: s.to_account_id, categoryId: s.category_id, merchant: s.merchant ?? '', memo: s.memo ?? '', tags: s.tags ?? '' };
    }
    const type = (['expense', 'income', 'transfer'] as const).find((x) => x === one(p.type)) as TxType | undefined;
    const t: TxType = type ?? 'expense';
    const out: FormInit = { type };
    const amount = parseAmount(one(p.amount) ?? '');
    if (amount) out.amount = amount;
    const date = one(p.date);
    if (isYmd(date)) out.date = date;
    const time = one(p.time);
    if (isHm(time)) out.time = time;
    const cat = one(p.category);
    if (cat && t !== 'transfer') { const m = matchCategory(categories, cat, t === 'income' ? 'income' : 'expense'); if (m.ok) out.categoryId = m.item.id; }
    const acc = one(p.account);
    if (acc) { const m = matchAccount(accounts, acc); if (m.ok) out.accountId = m.item.id; }
    const to = one(p.to_account);
    if (to) { const m = matchAccount(accounts, to); if (m.ok) out.toAccountId = m.item.id; }
    out.merchant = (one(p.merchant) ?? '').slice(0, 100);
    out.memo = (one(p.memo) ?? '').slice(0, 500);
    out.tags = (one(p.tags) ?? '').slice(0, 100);
    return out;
  }, [p, txs, categories, accounts]);
  if (!ready) return null;
  return <TxForm init={init} />;
}
