import * as Notifications from 'expo-notifications';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import { LockGate } from '../components/LockGate';
import { LedgerProvider, useLedger } from '../store';
import { useTheme } from '../theme';

// 앱이 열려 있을 때도 예산 알림을 보여 준다
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
});

/** 삭제·빠른 기록 직후 6초간 보이는 안내 바 (되돌리기) */
function NoticeBar() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { notice, clearNotice } = useLedger();
  if (!notice) return null;
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: 16, right: 16, bottom: insets.bottom + 84 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: t.dark ? '#E2E8F0' : '#1E293B', borderRadius: 14, paddingHorizontal: 16, paddingVertical: 12 }}>
        <Text style={{ flex: 1, color: t.dark ? '#0F172A' : '#fff', fontWeight: '600' }} numberOfLines={2}>{notice.text}</Text>
        {notice.action && (
          <Pressable onPress={async () => { const act = notice.action; clearNotice(); await act?.run(); }} accessibilityRole="button" accessibilityLabel={notice.action.label} hitSlop={8}>
            <Text style={{ color: t.dark ? '#0F766E' : '#5EEAD4', fontWeight: '800' }}>{notice.action.label}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

function Shell() {
  const t = useTheme();
  return (
    <>
      <StatusBar style={t.dark ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerStyle: { backgroundColor: t.bg }, headerTintColor: t.text, headerShadowVisible: false, headerTitleStyle: { fontWeight: '700' }, contentStyle: { backgroundColor: t.bg } }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="add" options={{ title: '새 내역', presentation: 'modal' }} />
        <Stack.Screen name="tx/[id]" options={{ title: '내역 수정', presentation: 'modal' }} />
        <Stack.Screen name="insights" options={{ title: '지출 인사이트' }} />
        <Stack.Screen name="more/import" options={{ title: '거래 가져오기' }} />
        <Stack.Screen name="more/accounts" options={{ title: '통장 관리' }} />
        <Stack.Screen name="more/categories" options={{ title: '카테고리 관리' }} />
        <Stack.Screen name="more/budgets" options={{ title: '예산' }} />
        <Stack.Screen name="more/recurring" options={{ title: '고정 거래' }} />
        <Stack.Screen name="more/rules" options={{ title: '통장 자동 지정 규칙' }} />
        <Stack.Screen name="more/backup" options={{ title: '백업 · 내보내기' }} />
        <Stack.Screen name="more/templates" options={{ title: '자주 쓰는 거래' }} />
        <Stack.Screen name="more/goals" options={{ title: '저축 목표' }} />
        <Stack.Screen name="more/purchases" options={{ title: '구매 내역' }} />
        <Stack.Screen name="more/settings" options={{ title: '설정' }} />
      </Stack>
      <NoticeBar />
    </>
  );
}

export default function Root() {
  return (
    <SafeAreaProvider>
      <LedgerProvider>
        <LockGate>
          <Shell />
        </LockGate>
      </LedgerProvider>
    </SafeAreaProvider>
  );
}
