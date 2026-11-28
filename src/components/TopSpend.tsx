import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useMemo } from 'react';
import { Text, View } from 'react-native';

import { computeInsights, periodRange } from '../lib/insights';
import { fmtNum, fmtWon } from '../lib/money';
import { useLedger } from '../store';
import { useTheme } from '../theme';
import { useAliases } from './useAliases';
import { Card } from './ui';

/** 홈: 이번 달 가장 많이 쓴 곳(가맹점 TOP3)·분류 TOP3와 직전 구간 대비. 누르면 인사이트 화면 */
export function TopSpend() {
  const t = useTheme();
  const { txs, categories, itemsByTx } = useLedger();
  const { aliases } = useAliases();
  const ins = useMemo(() => {
    const { range, prev } = periodRange('month');
    return computeInsights(txs, categories, itemsByTx, range, prev, aliases, '이번 달');
  }, [txs, categories, itemsByTx, aliases]);
  if (ins.total === 0) return null;
  const top = ins.merchants.slice(0, 3);
  const cats = ins.categories.slice(0, 3);
  return (
    <Card onPress={() => router.push('/insights' as never)} accessibilityLabel="이번 달 가장 많이 쓴 곳, 인사이트 보기" style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ fontSize: 15, fontWeight: '800', color: t.text }}>이번 달 가장 많이 쓴 곳</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          {ins.changePct !== null && Math.abs(ins.changePct) >= 1 && (
            <Text style={{ fontSize: 12.5, fontWeight: '800', color: ins.changePct > 0 ? t.expense : t.ok }}>
              {ins.changePct > 0 ? '▲' : '▼'} {Math.abs(ins.changePct).toFixed(0)}%
            </Text>
          )}
          <Ionicons name="chevron-forward" size={16} color={t.faint} />
        </View>
      </View>
      {top.length > 0 ? top.map((m, i) => (
        <View key={m.key} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
          <Text style={{ flex: 1, color: t.text, fontWeight: '600' }} numberOfLines={1}>{i + 1}. {m.name} <Text style={{ color: t.sub, fontWeight: '500' }}>({m.count}회)</Text></Text>
          <Text style={{ color: t.sub, fontWeight: '700' }}>{fmtWon(m.total)}</Text>
        </View>
      )) : <Text style={{ color: t.sub, fontSize: 13 }}>가맹점을 적으면 어디에 쓰는지 볼 수 있어요</Text>}
      <View style={{ height: 1, backgroundColor: t.line }} />
      <Text style={{ fontSize: 12.5, color: t.sub, lineHeight: 18 }}>
        {cats.map((c) => `${c.name} ${fmtNum(c.total)}원 (${c.pct.toFixed(0)}%)`).join(' · ')}
      </Text>
    </Card>
  );
}
