import * as Notifications from 'expo-notifications';
import type { SQLiteDatabase } from 'expo-sqlite';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';

import { getDb } from './db';
import { deleteTx, insertTx, kvGet, kvSet, loadAll, restoreTx, runRecurring, type Snapshot } from './db/repo';
import { balances, resolveAccount } from './lib/accounts';
import { fmtNum } from './lib/money';
import { monthKey, todayStr } from './lib/dates';
import { MISC_EXPENSE_ID, MISC_INCOME_ID } from './lib/seed';
import { alertsDue, budgetStatus } from './lib/stats';
import type { Account, Category, Template, Tx } from './lib/types';

export interface Settings { appLock: boolean; budgetAlerts: boolean }
export interface Notice { text: string; action?: { label: string; run: () => Promise<void> } }

interface Ctx extends Snapshot {
  ready: boolean;
  error: string | null;
  settings: Settings;
  setSetting<K extends keyof Settings>(key: K, value: Settings[K]): Promise<void>;
  balances: Map<string, number>;
  accountById: Map<string, Account>;
  catById: Map<string, Category>;
  /** 마지막으로 자동 생성된 고정 거래 수 (홈 배너용) */
  recurringCreated: number;
  dismissRecurring(): void;
  /** DB 작업을 실행하고 화면 데이터를 다시 읽는다 */
  mutate<T>(fn: (db: SQLiteDatabase) => Promise<T>): Promise<T>;
  refresh(): Promise<void>;
  /** 거래 삭제 + 되돌리기 */
  removeTx(t: Tx): Promise<void>;
  /** 즐겨찾기 템플릿으로 오늘 날짜에 바로 기록 + 되돌리기 */
  quickRecord(tpl: Template): Promise<void>;
  notice: Notice | null;
  showNotice(n: Notice): void;
  clearNotice(): void;
}

const EMPTY: Snapshot = { accounts: [], categories: [], txs: [], budgets: [], recurring: [], rules: [], templates: [], goals: [] };
const DEFAULT_SETTINGS: Settings = { appLock: false, budgetAlerts: true };
const C = createContext<Ctx>(null as never);
export const useLedger = () => useContext(C);

export function LedgerProvider({ children }: { children: React.ReactNode }) {
  const [snap, setSnap] = useState<Snapshot>(EMPTY);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recurringCreated, setRecurringCreated] = useState(0);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      setSettings({
        appLock: (await kvGet(db, 'app_lock')) === '1',
        budgetAlerts: (await kvGet(db, 'budget_alerts')) !== '0',
      });
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

  const setSetting = useCallback(async <K extends keyof Settings>(key: K, value: Settings[K]) => {
    const db = await getDb();
    await kvSet(db, key === 'appLock' ? 'app_lock' : 'budget_alerts', value ? '1' : '0');
    setSettings((s) => ({ ...s, [key]: value }));
  }, []);

  const clearNotice = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setNotice(null);
  }, []);

  const showNotice = useCallback((n: Notice) => {
    if (timer.current) clearTimeout(timer.current);
    setNotice(n);
    timer.current = setTimeout(() => setNotice(null), 6000);
  }, []);

  const removeTx = useCallback(async (t: Tx) => {
    await mutate((db) => deleteTx(db, t.id));
    showNotice({ text: `삭제했어요 · ${t.merchant ?? ''} ${fmtNum(t.amount)}원`, action: { label: '되돌리기', run: async () => { await mutate((db) => restoreTx(db, t)); } } });
  }, [mutate, showNotice]);

  const quickRecord = useCallback(async (tpl: Template) => {
    const acc = tpl.account_id
      ? snap.accounts.find((a) => a.id === tpl.account_id && !a.archived)
      : resolveAccount({ rules: snap.rules, accounts: snap.accounts, categories: snap.categories, merchant: tpl.merchant, memo: tpl.memo, categoryId: tpl.category_id }).account;
    const fallback = resolveAccount({ rules: snap.rules, accounts: snap.accounts, categories: snap.categories }).account;
    const account = acc ?? fallback;
    if (!account) throw new Error('기록할 통장이 없어요');
    const now = new Date();
    const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const id = await mutate((db) => insertTx(db, {
      type: tpl.type, amount: tpl.amount, date: todayStr(now), time: hhmm, account_id: account.id,
      to_account_id: tpl.type === 'transfer' ? tpl.to_account_id : null,
      category_id: tpl.type === 'transfer' ? null : tpl.category_id ?? (tpl.type === 'income' ? MISC_INCOME_ID : MISC_EXPENSE_ID),
      merchant: tpl.merchant ?? tpl.name, memo: tpl.memo, tags: null,
    }));
    showNotice({ text: `기록했어요 · ${tpl.name} ${fmtNum(tpl.amount)}원 (${account.name})`, action: { label: '되돌리기', run: async () => { await mutate((db) => deleteTx(db, id)); } } });
  }, [snap.accounts, snap.rules, snap.categories, mutate, showNotice]);

  // 예산 80%/100% 도달 시 로컬 알림 (달·예산·단계별로 한 번만)
  useEffect(() => {
    if (!ready || !settings.budgetAlerts || Platform.OS === 'web' || snap.budgets.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const month = monthKey(new Date());
        const due = alertsDue(budgetStatus(snap.budgets, snap.txs, snap.categories, month), month, new Set());
        if (!due.length) return;
        const db = await getDb();
        const sent = new Set<string>(JSON.parse((await kvGet(db, 'budget_alerts_sent')) ?? '[]'));
        const fresh = alertsDue(budgetStatus(snap.budgets, snap.txs, snap.categories, month), month, sent);
        if (!fresh.length || cancelled) return;
        const perm = await Notifications.getPermissionsAsync();
        // 알림 권한이 없어도 "보냈다"고 기록하지 않는다(권한을 켠 뒤에 다시 시도)
        if (!perm.granted) return;
        for (const a of fresh) {
          await Notifications.scheduleNotificationAsync({ content: { title: a.title, body: a.body, data: { type: 'budget' } }, trigger: null });
          sent.add(a.key);
        }
        // 지난 달 키는 정리
        const keep = [...sent].filter((k) => k.startsWith(month));
        await kvSet(db, 'budget_alerts_sent', JSON.stringify(keep));
      } catch {
        /* 알림 실패가 앱 동작을 막지 않게 */
      }
    })();
    return () => { cancelled = true; };
  }, [ready, settings.budgetAlerts, snap.budgets, snap.txs, snap.categories]);

  const value = useMemo<Ctx>(() => ({
    ...snap, ready, error, settings, setSetting,
    balances: balances(snap.accounts, snap.txs),
    accountById: new Map(snap.accounts.map((a) => [a.id, a])),
    catById: new Map(snap.categories.map((c) => [c.id, c])),
    recurringCreated, dismissRecurring: () => setRecurringCreated(0),
    mutate, refresh, removeTx, quickRecord, notice, showNotice, clearNotice,
  }), [snap, ready, error, settings, setSetting, recurringCreated, mutate, refresh, removeTx, quickRecord, notice, showNotice, clearNotice]);

  return <C.Provider value={value}>{children}</C.Provider>;
}
