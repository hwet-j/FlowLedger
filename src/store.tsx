import type { SQLiteDatabase } from 'expo-sqlite';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { getDb } from './db';
import { loadAll, restoreTx, runRecurring, deleteTx, type Snapshot } from './db/repo';
import { balances } from './lib/accounts';
import { todayStr } from './lib/dates';
import type { Account, Category, Tx } from './lib/types';

interface Ctx extends Snapshot {
  ready: boolean;
  error: string | null;
  balances: Map<string, number>;
  accountById: Map<string, Account>;
  catById: Map<string, Category>;
  /** 마지막으로 자동 생성된 고정 거래 수 (홈 배너용) */
  recurringCreated: number;
  dismissRecurring(): void;
  /** DB 작업을 실행하고 화면 데이터를 다시 읽는다 */
  mutate<T>(fn: (db: SQLiteDatabase) => Promise<T>): Promise<T>;
  refresh(): Promise<void>;
  /** 거래 삭제 + 되돌리기 스낵바 */
  removeTx(t: Tx): Promise<void>;
  undo: Tx | null;
  undoRemove(): Promise<void>;
  clearUndo(): void;
}

const EMPTY: Snapshot = { accounts: [], categories: [], txs: [], budgets: [], recurring: [], rules: [], templates: [], goals: [] };
const C = createContext<Ctx>(null as never);
export const useLedger = () => useContext(C);

export function LedgerProvider({ children }: { children: React.ReactNode }) {
  const [snap, setSnap] = useState<Snapshot>(EMPTY);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recurringCreated, setRecurringCreated] = useState(0);
  const [undo, setUndo] = useState<Tx | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    const db = await getDb();
    setSnap(await loadAll(db));
  }, []);

  const sync = useCallback(async () => {
    try {
      const db = await getDb();
      const n = await runRecurring(db, todayStr());
      if (n > 0) setRecurringCreated((c) => c + n);
      setSnap(await loadAll(db));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void sync();
    // 비서가 앱 밖에서 기록을 넣을 수 있으므로 포그라운드로 돌아올 때마다 다시 읽는다
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') void sync(); });
    return () => sub.remove();
  }, [sync]);

  const mutate = useCallback(async <T,>(fn: (db: SQLiteDatabase) => Promise<T>): Promise<T> => {
    const db = await getDb();
    const r = await fn(db);
    setSnap(await loadAll(db));
    return r;
  }, []);

  const clearUndo = useCallback(() => {
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = null;
    setUndo(null);
  }, []);

  const removeTx = useCallback(async (t: Tx) => {
    await mutate((db) => deleteTx(db, t.id));
    setUndo(t);
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setUndo(null), 6000);
  }, [mutate]);

  const undoRemove = useCallback(async () => {
    if (!undo) return;
    const t = undo;
    clearUndo();
    await mutate((db) => restoreTx(db, t));
  }, [undo, clearUndo, mutate]);

  const value = useMemo<Ctx>(() => ({
    ...snap, ready, error,
    balances: balances(snap.accounts, snap.txs),
    accountById: new Map(snap.accounts.map((a) => [a.id, a])),
    catById: new Map(snap.categories.map((c) => [c.id, c])),
    recurringCreated, dismissRecurring: () => setRecurringCreated(0),
    mutate, refresh, removeTx, undo, undoRemove, clearUndo,
  }), [snap, ready, error, recurringCreated, mutate, refresh, removeTx, undo, undoRemove, clearUndo]);

  return <C.Provider value={value}>{children}</C.Provider>;
}
