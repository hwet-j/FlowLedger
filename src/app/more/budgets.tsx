import React, { useMemo, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { setBudget } from '../../db/repo';
import { CategoryPicker } from '../../components/CategoryPicker';
import { Bar, Button, Card, Chip, Empty, Field } from '../../components/ui';
import { monthKey } from '../../lib/dates';
import { fmtNum, fmtWon, parseAmount } from '../../lib/money';
import { budgetStatus, projectMonthEnd } from '../../lib/stats';
import { useLedger } from '../../store';
import { useTheme } from '../../theme';

export default function BudgetsScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { budgets, txs, categories, mutate } = useLedger();
  const month = monthKey(new Date());
  const st = useMemo(() => budgetStatus(budgets, txs, categories, month), [budgets, txs, categories, month]);
  const proj = useMemo(() => projectMonthEnd(txs, month, new Date()), [txs, month]);
  const [target, setTarget] = useState<string | null>(null); // null = 전체
  const [amount, setAmount] = useState('');

  const save = async () => {
    const n = parseAmount(amount);
    if (!n) return Alert.alert('월 예산 금액을 입력해 주세요');
    await mutate((db) => setBudget(db, target, n));
    setAmount('');
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: insets.bottom + 40 }} keyboardShouldPersistTaps="handled">
      <Text style={{ color: t.sub, lineHeight: 19 }}>매달 쓸 수 있는 한도를 정해요. 80%와 100%에 도달하면 알림을 보내요(설정에서 끌 수 있어요). 대분류 예산은 소분류 지출을 모두 포함해요.</Text>
      {proj && (
        <Card style={{ gap: 4 }}>
          <Text style={{ fontSize: 13, fontWeight: '700', color: t.sub }}>이 속도면 월말 예상 지출</Text>
          <Text style={{ fontSize: 22, fontWeight: '800', color: t.text }}>{fmtWon(proj.projected)}</Text>
          <Text style={{ fontSize: 12.5, color: t.sub }}>지금까지 {fmtWon(proj.spent)} · 하루 평균 {fmtWon(Math.round(proj.dailyAvg))}</Text>
        </Card>
      )}
      <Card style={{ gap: 14 }}>
        {st.length === 0 ? <Empty icon="speedometer-outline" title="예산이 없어요" hint="아래에서 전체 또는 카테고리별 예산을 추가해 보세요." /> : st.map((b) => (
          <View key={b.budget.id} style={{ gap: 6 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ fontWeight: '700', color: t.text }}>{b.label}</Text>
              <Button title="삭제" kind="danger" small onPress={() => mutate((db) => setBudget(db, b.budget.category_id, 0))} />
            </View>
            <Bar pct={b.pct} color={b.level === 'over' ? t.expense : b.level === 'warn' ? t.warn : t.primary} />
            <Text style={{ fontSize: 12.5, color: b.level === 'over' ? t.expense : t.sub }}>
              {fmtNum(b.spent)} / {fmtNum(b.budget.amount)}원 ({b.pct.toFixed(0)}%) · {b.remaining >= 0 ? `${fmtNum(b.remaining)}원 남음` : `${fmtNum(-b.remaining)}원 초과`}
            </Text>
          </View>
        ))}
      </Card>
      <Card style={{ gap: 12 }}>
        <Text style={{ fontWeight: '800', color: t.text }}>예산 설정 / 수정</Text>
        <Chip label="이번 달 전체 지출" on={target === null} onPress={() => setTarget(null)} />
        <CategoryPicker type="expense" value={target} onChange={(id) => setTarget(id)} />
        <Field label="월 예산 (원)" value={amount} keyboardType="number-pad" onChangeText={(s) => { const n = parseAmount(s); setAmount(n ? fmtNum(n) : ''); }} placeholder="예: 500,000" />
        <Button title="저장" onPress={save} />
      </Card>
    </ScrollView>
  );
}
