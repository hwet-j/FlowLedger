import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import { fmtNum } from '../lib/money';
import { LedgerProvider, useLedger } from '../store';
import { useTheme } from '../theme';

/** 삭제 직후 6초간 보이는 "되돌리기" 바 */
function UndoBar() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { undo, undoRemove } = useLedger();
  if (!undo) return null;
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: 16, right: 16, bottom: insets.bottom + 84 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: t.dark ? '#E2E8F0' : '#1E293B', borderRadius: 14, paddingHorizontal: 16, paddingVertical: 12 }}>
        <Text style={{ flex: 1, color: t.dark ? '#0F172A' : '#fff', fontWeight: '600' }} numberOfLines={1}>
          삭제했어요 · {undo.merchant ?? ''} {fmtNum(undo.amount)}원
        </Text>
        <Pressable onPress={undoRemove} accessibilityRole="button" accessibilityLabel="삭제 되돌리기" hitSlop={8}>
          <Text style={{ color: t.dark ? '#0F766E' : '#5EEAD4', fontWeight: '800' }}>되돌리기</Text>
        </Pressable>
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
        <Stack.Screen name="more/accounts" options={{ title: '통장 관리' }} />
        <Stack.Screen name="more/categories" options={{ title: '카테고리 관리' }} />
        <Stack.Screen name="more/budgets" options={{ title: '예산' }} />
        <Stack.Screen name="more/recurring" options={{ title: '고정 거래' }} />
        <Stack.Screen name="more/rules" options={{ title: '통장 자동 지정 규칙' }} />
        <Stack.Screen name="more/backup" options={{ title: '백업 · 내보내기' }} />
      </Stack>
      <UndoBar />
    </>
  );
}

export default function Root() {
  return (
    <SafeAreaProvider>
      <LedgerProvider>
        <Shell />
      </LedgerProvider>
    </SafeAreaProvider>
  );
}
