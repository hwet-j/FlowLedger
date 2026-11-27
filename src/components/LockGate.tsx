import { Ionicons } from '@expo/vector-icons';
import * as LocalAuthentication from 'expo-local-authentication';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Text, View } from 'react-native';

import { useLedger } from '../store';
import { useTheme } from '../theme';
import { Button } from './ui';

const RELOCK_AFTER_MS = 20_000;

/** 앱 잠금: 시작할 때와, 20초 넘게 백그라운드에 있다 돌아올 때 인증을 요구한다 */
export function LockGate({ children }: { children: React.ReactNode }) {
  const t = useTheme();
  const { ready, settings, setSetting } = useLedger();
  const [locked, setLocked] = useState(true);
  const [busy, setBusy] = useState(false);
  const bgAt = useRef<number | null>(null);

  useEffect(() => {
    if (ready && !settings.appLock) setLocked(false);
  }, [ready, settings.appLock]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'background') bgAt.current = Date.now();
      else if (s === 'active') {
        if (bgAt.current && settings.appLock && Date.now() - bgAt.current > RELOCK_AFTER_MS) setLocked(true);
        bgAt.current = null;
      }
    });
    return () => sub.remove();
  }, [settings.appLock]);

  const unlock = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      // 기기 잠금을 해제해서 인증 수단이 없어졌다면 갇히지 않게 잠금을 끈다
      if ((await LocalAuthentication.getEnrolledLevelAsync()) === LocalAuthentication.SecurityLevel.NONE) {
        await setSetting('appLock', false);
        setLocked(false);
        return;
      }
      const r = await LocalAuthentication.authenticateAsync({ promptMessage: 'FlowLedger 잠금 해제', cancelLabel: '취소' });
      if (r.success) setLocked(false);
    } finally {
      setBusy(false);
    }
  }, [busy, setSetting]);

  useEffect(() => {
    if (ready && settings.appLock && locked) void unlock();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, settings.appLock, locked]);

  if (locked) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, backgroundColor: t.bg, padding: 32 }}>
        <Ionicons name="lock-closed" size={48} color={t.primary} />
        <Text style={{ fontSize: 20, fontWeight: '800', color: t.text }}>FlowLedger</Text>
        {ready && settings.appLock ? <Button title="잠금 해제" icon="finger-print" onPress={unlock} disabled={busy} /> : null}
      </View>
    );
  }
  return <>{children}</>;
}
