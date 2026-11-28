import { useCallback, useEffect, useMemo, useState } from 'react';

import { getDb } from '../db';
import { kvGet, kvSet } from '../db/repo';
import { todayStr } from '../lib/dates';
import { suggestRecurring } from '../lib/suggest';
import { useLedger } from '../store';
import { useAliases } from './useAliases';

const KEY = 'recurring_dismissed';

/** 정기 거래로 등록할 만한 반복 결제 제안 (숨긴 건 제외) */
export function useRecurringSuggestions() {
  const { txs, recurring } = useLedger();
  const { aliases } = useAliases();
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  useEffect(() => {
    getDb().then((db) => kvGet(db, KEY)).then((v) => { try { setDismissed(new Set(JSON.parse(v ?? '[]'))); } catch { /* 없음 */ } }).catch(() => {});
  }, []);
  const today = todayStr();
  const suggestions = useMemo(() => suggestRecurring(txs, recurring, dismissed, today, aliases), [txs, recurring, dismissed, today, aliases]);
  const hide = useCallback(async (key: string) => {
    const next = new Set(dismissed).add(key);
    setDismissed(next);
    await kvSet(await getDb(), KEY, JSON.stringify([...next]));
  }, [dismissed]);
  return { suggestions, hide };
}
