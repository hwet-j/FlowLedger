import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, Text, View } from 'react-native';

import { categoryPath } from '../lib/match';
import { fmtNum } from '../lib/money';
import type { Category, Tx } from '../lib/types';
import { useLedger } from '../store';
import { useTheme } from '../theme';

export const catIcon = (c?: Category): keyof typeof Ionicons.glyphMap => {
  const name = c?.icon ?? undefined;
  return name && name in Ionicons.glyphMap ? (name as keyof typeof Ionicons.glyphMap) : 'pricetag';
};

/** 소분류는 부모의 아이콘·색을 따른다 */
export function catStyle(c: Category | undefined, all: Map<string, Category>) {
  const top = c?.parent_id ? all.get(c.parent_id) : c;
  return { icon: catIcon(top ?? c), color: c?.color ?? top?.color ?? '#94A3B8' };
}

export function TxRow({ t, onPress, onLongPress, showDate }: { t: Tx; onPress?: () => void; onLongPress?: () => void; showDate?: boolean }) {
  const th = useTheme();
  const { catById, accountById, categories, itemsByTx } = useLedger();
  const nItems = itemsByTx.get(t.id)?.length ?? 0;
  const cat = t.category_id ? catById.get(t.category_id) : undefined;
  const st = catStyle(cat, catById);
  const isTr = t.type === 'transfer';
  const title = t.merchant?.trim() || (isTr ? '이체' : cat ? categoryPath(cat, categories) : '미분류');
  const acc = accountById.get(t.account_id)?.name ?? '?';
  const to = t.to_account_id ? accountById.get(t.to_account_id)?.name ?? '?' : '';
  const sub = [isTr ? `${acc} → ${to}` : cat ? categoryPath(cat, categories) : '미분류', isTr ? '' : acc, showDate ? t.date.slice(5).replace('-', '/') : '', t.time ?? '']
    .filter(Boolean).join(' · ');
  const color = t.type === 'income' ? th.income : t.type === 'expense' ? th.text : th.sub;
  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} delayLongPress={400} accessibilityRole="button"
      accessibilityLabel={`${title} ${t.amount}원`} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 }}>
      <View style={{ width: 42, height: 42, borderRadius: 14, backgroundColor: isTr ? th.input : st.color + '26', alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name={isTr ? 'swap-horizontal' : t.type === 'income' && !cat ? 'cash' : st.icon} size={20} color={isTr ? th.sub : st.color} />
      </View>
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={{ fontSize: 16, fontWeight: '600', color: th.text }}>{title}</Text>
        <Text numberOfLines={1} style={{ fontSize: 12.5, color: th.sub, marginTop: 2 }}>
          {sub}{t.source === 'assistant' ? ' · 🤖' : t.source === 'recurring' ? ' · 🔁' : ''}{nItems ? ` · 🧾${nItems}` : ''}{t.receipt_uri ? ' · 📎' : ''}
        </Text>
      </View>
      <Text style={{ fontSize: 16, fontWeight: '700', color }}>
        {t.type === 'income' ? '+' : t.type === 'expense' ? '-' : ''}{fmtNum(t.amount)}원
      </Text>
    </Pressable>
  );
}
