import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useMemo } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { catStyle, TxRow } from '../../components/TxRow';
import { Bar, Card, Empty, SectionTitle } from '../../components/ui';
import { totalAssets } from '../../lib/accounts';
import { monthKey, todayStr } from '../../lib/dates';
import { fmtNum, fmtWon } from '../../lib/money';
import { budgetStatus, dailyAllowance, monthStats } from '../../lib/stats';
import { useLedger } from '../../store';
import { useTheme } from '../../theme';

export default function Home() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { ready, error, accounts, categories, txs, budgets, balances, catById, recurringCreated, dismissRecurring } = useLedger();
  const month = monthKey(new Date());
  const today = todayStr();
  const stats = useMemo(() => monthStats(txs, categories, month), [txs, categories, month]);
  const bs = useMemo(() => budgetStatus(budgets, txs, categories, month), [budgets, txs, categories, month]);
  const total = totalAssets(balances);
  const active = accounts.filter((a) => !a.archived);
  const totalBudget = bs.find((b) => b.budget.category_id === null);
  const allowance = totalBudget ? dailyAllowance(totalBudget.remaining, today, month) : null;

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingTop: insets.top + 12, paddingBottom: insets.bottom + 140 }}>
      <Text style={{ fontSize: 28, fontWeight: '800', color: t.text, marginBottom: 14 }}>FlowLedger</Text>
      {error ? <Card style={{ marginBottom: 12 }}><Text style={{ color: t.danger }}>데이터를 불러오지 못했어요: {error}</Text></Card> : null}

      {recurringCreated > 0 && (
        <Pressable onPress={dismissRecurring} accessibilityRole="button" style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: t.primarySoft, borderRadius: 14, padding: 14, marginBottom: 12 }}>
          <Ionicons name="repeat" size={20} color={t.primary} />
          <Text style={{ flex: 1, color: t.primary, fontWeight: '700' }}>고정 거래 {recurringCreated}건이 자동으로 기록됐어요</Text>
          <Ionicons name="close" size={18} color={t.primary} />
        </Pressable>
      )}

      <Card style={{ gap: 4 }}>
        <Text style={{ fontSize: 13, fontWeight: '700', color: t.sub }}>총 자산</Text>
        <Text style={{ fontSize: 34, fontWeight: '800', color: total < 0 ? t.expense : t.text }}>{fmtWon(total)}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingTop: 10 }}>
          {active.map((a) => (
            <Pressable key={a.id} onPress={() => router.push({ pathname: '/list', params: { account: a.id } })} accessibilityRole="button"
              style={{ backgroundColor: t.input, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 }}>
              <Text style={{ fontSize: 12, color: t.sub }}>{a.is_default ? '★ ' : ''}{a.name}</Text>
              <Text style={{ fontSize: 14, fontWeight: '700', color: (balances.get(a.id) ?? 0) < 0 ? t.expense : t.text }}>{fmtWon(balances.get(a.id) ?? 0)}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </Card>

      <SectionTitle title={`${Number(month.slice(5))}월 요약`} />
      <Card>
        <View style={{ flexDirection: 'row' }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 12, color: t.sub }}>수입</Text>
            <Text style={{ fontSize: 18, fontWeight: '800', color: t.income }}>{fmtWon(stats.income)}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 12, color: t.sub }}>지출</Text>
            <Text style={{ fontSize: 18, fontWeight: '800', color: t.expense }}>{fmtWon(stats.expense)}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 12, color: t.sub }}>수지</Text>
            <Text style={{ fontSize: 18, fontWeight: '800', color: stats.net < 0 ? t.expense : t.text }}>{fmtWon(stats.net)}</Text>
          </View>
        </View>
        {stats.expenseDeltaPct !== null && (
          <Text style={{ fontSize: 12.5, color: t.sub, marginTop: 10 }}>
            지난달 같은 달 대비 지출 <Text style={{ fontWeight: '800', color: stats.expenseDelta > 0 ? t.expense : t.ok }}>{stats.expenseDelta > 0 ? '+' : ''}{fmtNum(stats.expenseDelta)}원 ({stats.expenseDeltaPct > 0 ? '+' : ''}{stats.expenseDeltaPct.toFixed(0)}%)</Text>
          </Text>
        )}
      </Card>

      {bs.length > 0 && (
        <>
          <SectionTitle title="예산" right={<Pressable onPress={() => router.push('/more/budgets')}><Text style={{ color: t.primary, fontWeight: '700' }}>관리</Text></Pressable>} />
          <Card style={{ gap: 14 }}>
            {bs.slice(0, 4).map((b) => (
              <View key={b.budget.id} style={{ gap: 6 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ fontWeight: '700', color: t.text }}>{b.label}</Text>
                  <Text style={{ color: b.level === 'over' ? t.expense : t.sub, fontWeight: '600' }}>{fmtNum(b.spent)} / {fmtNum(b.budget.amount)}원</Text>
                </View>
                <Bar pct={b.pct} color={b.level === 'over' ? t.expense : b.level === 'warn' ? t.warn : t.primary} />
              </View>
            ))}
            {allowance !== null && totalBudget && totalBudget.remaining > 0 && (
              <Text style={{ fontSize: 12.5, color: t.sub }}>남은 기간 하루 {fmtWon(allowance)}까지 쓸 수 있어요</Text>
            )}
          </Card>
        </>
      )}

      {stats.byCategory.length > 0 && (
        <>
          <SectionTitle title="이번 달 많이 쓴 곳" right={<Pressable onPress={() => router.push('/stats')}><Text style={{ color: t.primary, fontWeight: '700' }}>통계</Text></Pressable>} />
          <Card style={{ gap: 12 }}>
            {stats.byCategory.slice(0, 3).map((c) => {
              const st = catStyle(catById.get(c.id), catById);
              return (
                <Pressable key={c.id || 'none'} onPress={() => router.push({ pathname: '/list', params: { month, category: c.id } })} accessibilityRole="button" style={{ gap: 6 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ fontWeight: '700', color: t.text }}>{c.name}</Text>
                    <Text style={{ color: t.sub, fontWeight: '600' }}>{fmtWon(c.total)} · {c.pct.toFixed(0)}%</Text>
                  </View>
                  <Bar pct={c.pct} color={st.color} />
                </Pressable>
              );
            })}
          </Card>
        </>
      )}

      <SectionTitle title="최근 내역" right={<Pressable onPress={() => router.push('/list')}><Text style={{ color: t.primary, fontWeight: '700' }}>전체 보기</Text></Pressable>} />
      <Card>
        {!ready ? null : txs.length === 0 ? (
          <Empty title="아직 기록이 없어요" hint="오른쪽 아래 + 버튼으로 첫 내역을 기록하거나, 비서에게 말해 보세요." />
        ) : txs.slice(0, 5).map((x) => <TxRow key={x.id} t={x} showDate onPress={() => router.push(`/tx/${x.id}`)} />)}
      </Card>
    </ScrollView>
  );
}
