import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, Text, View } from 'react-native';

import { addMonths, fmtMonthLabel } from '../lib/dates';
import { useTheme } from '../theme';

/** period 가 'YYYY' 면 연 단위, 'YYYY-MM' 이면 월 단위 이동 */
export function MonthNav({ month, onChange }: { month: string; onChange: (m: string) => void }) {
  const t = useTheme();
  const isYear = month.length === 4;
  const move = (n: number) => onChange(isYear ? String(Number(month) + n) : addMonths(month, n));
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
      <Pressable onPress={() => move(-1)} hitSlop={10} accessibilityRole="button" accessibilityLabel={isYear ? '이전 해' : '이전 달'} style={{ padding: 8 }}>
        <Ionicons name="chevron-back" size={22} color={t.text} />
      </Pressable>
      <Text style={{ fontSize: 20, fontWeight: '800', color: t.text, minWidth: 130, textAlign: 'center' }}>{isYear ? `${month}년` : fmtMonthLabel(month)}</Text>
      <Pressable onPress={() => move(1)} hitSlop={10} accessibilityRole="button" accessibilityLabel={isYear ? '다음 해' : '다음 달'} style={{ padding: 8 }}>
        <Ionicons name="chevron-forward" size={22} color={t.text} />
      </Pressable>
    </View>
  );
}
