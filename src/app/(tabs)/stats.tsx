import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Share, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Donut, TrendBars, WeekdayBars } from '../../components/Charts';
import { MonthNav } from '../../components/MonthNav';
import { catStyle } from '../../components/TxRow';
import { Bar, Button, Card, Chip, Empty, SectionTitle } from '../../components/ui';
import { monthKey, WEEKDAYS } from '../../lib/dates';
import { fmtNum, fmtWon } from '../../lib/money';
import { budgetStatus, byWeekday, monthlyReport, monthStats, topMerchants, trend } from '../../lib/stats';
import { useLedger } from '../../store';
import { useTheme } from '../../theme';


export default function StatsScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { txs, categories, catById, budgets, itemsByTx } = useLedger();
  const p = useLocalSearchParams<{ month?: string }>();
  const [period, setPeriod] = useState(monthKey(new Date()));
  // 딥링크 flowledger://stats?month=YYYY-MM (또는 YYYY)
  useEffect(() => {
    const m = Array.isArray(p.month) ? p.month[0] : p.month;
    if (m && (/^\d{4}-(0[1-9]|1[0-2])$/.test(m) || /^\d{4}$/.test(m))) setPeriod(m);
  }, [p.month]);
  const [open, setOpen] = useState<string | null>(null);
  const isYear = period.length === 4;
  const s = useMemo(() => monthStats(txs, categories, period, itemsByTx), [txs, categories, period, itemsByTx]);
  const wk = useMemo(() => byWeekday(txs, period), [txs, period]);
  const merchants = useMemo(() => topMerchants(txs, period, 5), [txs, period]);
  const tr = useMemo(() => trend(txs, isYear ? `${period}-12` : period, 12), [txs, period, isYear]);
  const shareReport = () => {
    const label = isYear ? `${period}년` : `${period.slice(0, 4)}년 ${Number(period.slice(5))}월`;
    const bs = isYear ? [] : budgetStatus(budgets, txs, categories, period, itemsByTx);
    void Share.share({ message: monthlyReport(s, bs, label) });
  };
  const colorOf = (id: string) => catStyle(catById.get(id), catById).color;
  const periodLabel = isYear ? `${period}년` : `${Number(period.slice(5))}월`;
  const listParams = (category?: string) => ({ pathname: '/list' as const, params: isYear ? { category: category ?? '', q: '' } : { month: period, category: category ?? '' } });

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingTop: insets.top + 12, paddingBottom: insets.bottom + 140 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <Text style={{ fontSize: 28, fontWeight: '800', color: t.text }}>통계</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Chip label="월" on={!isYear} onPress={() => setPeriod(isYear ? `${period}-${monthKey(new Date()).slice(5)}` : period)} />
          <Chip label="연" on={isYear} onPress={() => setPeriod(period.slice(0, 4))} />
        </View>
      </View>
      <MonthNav month={period} onChange={setPeriod} />

      <Card style={{ marginTop: 14, gap: 12 }}>
        <View style={{ flexDirection: 'row' }}>
          <View style={{ flex: 1 }}><Text style={{ fontSize: 12, color: t.sub }}>{periodLabel} 지출</Text><Text style={{ fontSize: 22, fontWeight: '800', color: t.expense }}>{fmtWon(s.expense)}</Text></View>
          <View style={{ flex: 1 }}><Text style={{ fontSize: 12, color: t.sub }}>{periodLabel} 수입</Text><Text style={{ fontSize: 22, fontWeight: '800', color: t.income }}>{fmtWon(s.income)}</Text></View>
        </View>
        {s.expenseDeltaPct !== null && (
          <Text style={{ fontSize: 13, color: t.sub }}>
            {isYear ? '전년' : '전월'} 대비 지출 <Text style={{ fontWeight: '800', color: s.expenseDelta > 0 ? t.expense : t.ok }}>{s.expenseDelta > 0 ? '+' : ''}{fmtNum(s.expenseDelta)}원 ({s.expenseDeltaPct > 0 ? '+' : ''}{s.expenseDeltaPct.toFixed(0)}%)</Text>
          </Text>
        )}
      </Card>

      <SectionTitle title="카테고리별 지출" />
      <Card style={{ gap: 14 }}>
        {s.byCategory.length === 0 ? <Empty icon="pie-chart-outline" title="지출 기록이 없어요" /> : (
          <>
            <View style={{ alignItems: 'center' }}>
              <Donut slices={s.byCategory.map((c) => ({ value: c.total, color: colorOf(c.id) }))} center={
                <View style={{ alignItems: 'center' }}><Text style={{ fontSize: 12, color: t.sub }}>총 지출</Text><Text style={{ fontSize: 17, fontWeight: '800', color: t.text }}>{fmtNum(s.expense)}</Text></View>} />
            </View>
            {s.byCategory.map((c, i) => (
              <View key={c.id || 'none'} style={{ gap: 6 }}>
                <Pressable onPress={() => setOpen(open === c.id ? null : c.id)} accessibilityRole="button" accessibilityLabel={`${c.name} ${c.total}원`} style={{ gap: 6 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colorOf(c.id) }} />
                    <Text style={{ flex: 1, fontWeight: '700', color: t.text }}>{i + 1}. {c.name}</Text>
                    <Text style={{ color: t.sub, fontWeight: '600' }}>{fmtWon(c.total)} · {c.pct.toFixed(0)}%</Text>
                  </View>
                  <Bar pct={c.pct} color={colorOf(c.id)} />
                </Pressable>
                {open === c.id && (
                  <View style={{ paddingLeft: 18, gap: 8, paddingTop: 4 }}>
                    {c.children.map((ch) => (
                      <View key={ch.id} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                        <Text style={{ color: t.text }}>{ch.name} <Text style={{ color: t.sub }}>({ch.count}건)</Text></Text>
                        <Text style={{ color: t.sub, fontWeight: '600' }}>{fmtWon(ch.total)}</Text>
                      </View>
                    ))}
                    <Pressable onPress={() => router.push(listParams(c.id))} accessibilityRole="button"><Text style={{ color: t.primary, fontWeight: '700' }}>이 카테고리 내역 보기 →</Text></Pressable>
                  </View>
                )}
              </View>
            ))}
          </>
        )}
      </Card>

      <SectionTitle title="최근 12개월 추이" />
      <Card><TrendBars data={tr.map((x) => ({ label: `${Number(x.month.slice(5))}`, income: x.income, expense: x.expense }))} selected={isYear ? 11 : 11} /></Card>


      {s.expense > 0 && (
        <>
          <SectionTitle title="요일별 지출" />
          <Card><WeekdayBars data={wk.map((w) => ({ label: WEEKDAYS[w.weekday], total: w.total }))} /></Card>
        </>
      )}

      {merchants.length > 0 && (
        <>
          <SectionTitle title="많이 간 곳 TOP 5" />
          <Card style={{ gap: 10 }}>
            {merchants.map((m, i) => (
              <Pressable key={m.merchant} onPress={() => router.push({ pathname: '/list', params: { q: m.merchant } })} accessibilityRole="button" style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ fontWeight: '600', color: t.text }}>{i + 1}. {m.merchant} <Text style={{ color: t.sub }}>({m.count}회)</Text></Text>
                <Text style={{ color: t.sub, fontWeight: '600' }}>{fmtWon(m.total)}</Text>
              </Pressable>
            ))}
          </Card>
        </>
      )}
      <View style={{ marginTop: 18 }}><Button title={`${periodLabel} 리포트 공유`} kind="soft" icon="share-outline" onPress={shareReport} /></View>
    </ScrollView>
  );
}
