import { Ionicons } from '@expo/vector-icons';
import { router, Tabs } from 'expo-router';
import React from 'react';
import { Pressable, type ColorValue } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '../../theme';

type Icon = keyof typeof Ionicons.glyphMap;
const tab = (title: string, on: Icon, off: Icon) => ({
  title,
  tabBarIcon: ({ color, focused, size }: { color: ColorValue; focused: boolean; size: number }) => <Ionicons name={focused ? on : off} size={size} color={color as string} />,
});

export default function TabsLayout() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <>
      <Tabs screenOptions={{
        headerShown: false, tabBarActiveTintColor: t.primary, tabBarInactiveTintColor: t.faint,
        tabBarStyle: { backgroundColor: t.card, borderTopColor: t.line }, tabBarLabelStyle: { fontWeight: '700', fontSize: 11 },
      }}>
        <Tabs.Screen name="index" options={tab('홈', 'home', 'home-outline')} />
        <Tabs.Screen name="list" options={tab('내역', 'list', 'list-outline')} />
        <Tabs.Screen name="stats" options={tab('통계', 'pie-chart', 'pie-chart-outline')} />
        <Tabs.Screen name="more" options={tab('더보기', 'menu', 'menu-outline')} />
      </Tabs>
      <Pressable
        onPress={() => router.push('/add')} accessibilityRole="button" accessibilityLabel="내역 추가"
        style={{ position: 'absolute', right: 20, bottom: insets.bottom + 72, width: 58, height: 58, borderRadius: 29, backgroundColor: t.primary, alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 12px rgba(0,0,0,0.25)' }}>
        <Ionicons name="add" size={32} color={t.dark ? '#04201D' : '#fff'} />
      </Pressable>
    </>
  );
}
