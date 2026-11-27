import React, { useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { deleteGoal, saveGoal } from '../../db/repo';
import { Bar, Button, Card, Chip, Empty, Field } from '../../components/ui';
import { goalProgress } from '../../lib/goals';
import { isYmd, todayStr } from '../../lib/dates';
import { fmtNum, fmtWon, parseAmount } from '../../lib/money';
import type { Goal } from '../../lib/types';
import { useLedger } from '../../store';
import { useTheme } from '../../theme';

interface Form { id?: string; name: string; target: string; accountId: string | null; saved: string; due: string }

export default function GoalsScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { goals, accounts, balances, mutate } = useLedger();
  const active = accounts.filter((a) => !a.archived);
  const [form, setForm] = useState<Form | null>(null);
  const today = todayStr();

  const open = (g?: Goal) => setForm(g ? { id: g.id, name: g.name, target: fmtNum(g.target), accountId: g.account_id, saved: g.saved ? fmtNum(g.saved) : '', due: g.due_date ?? '' }
    : { name: '', target: '', accountId: null, saved: '', due: '' });
  const save = async () => {
    if (!form) return;
    const target = parseAmount(form.target);
    if (!form.name.trim()) return Alert.alert('목표 이름을 입력해 주세요');
    if (!target) return Alert.alert('목표 금액을 입력해 주세요');
    if (form.due && !isYmd(form.due)) return Alert.alert('목표일을 YYYY-MM-DD 형식으로 입력하거나 비워 두세요');
    await mutate((db) => saveGoal(db, { id: form.id, name: form.name.trim(), target, account_id: form.accountId, saved: parseAmount(form.saved), due_date: form.due || null }));
    setForm(null);
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: insets.bottom + 40 }} keyboardShouldPersistTaps="handled">
      <Text style={{ color: t.sub, lineHeight: 19 }}>목표 금액을 정하고 저축 통장을 연결하면, 그 통장의 잔액으로 진행률을 계산해요. 통장을 연결하지 않으면 직접 입력한 금액으로 계산해요.</Text>
      <Card style={{ gap: 16 }}>
        {goals.length === 0 ? <Empty icon="flag-outline" title="저축 목표가 없어요" /> : goals.map((g) => {
          const p = goalProgress(g, balances, today);
          return (
            <View key={g.id} style={{ gap: 6 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ fontWeight: '800', color: t.text, fontSize: 16 }}>{g.name}</Text>
                <Button title="수정" kind="soft" small onPress={() => open(g)} />
              </View>
              <Bar pct={p.pct} color={p.pct >= 100 ? t.ok : t.primary} height={10} />
              <Text style={{ fontSize: 13, color: t.sub }}>{fmtWon(p.saved)} / {fmtWon(g.target)} ({Math.min(p.pct, 999).toFixed(0)}%)</Text>
              {p.daysLeft !== null && <Text style={{ fontSize: 12.5, color: t.sub }}>{p.daysLeft >= 0 ? `${g.due_date}까지 ${p.daysLeft}일 남음${p.perMonth ? ` · 한 달에 ${fmtWon(p.perMonth)}씩 모으면 돼요` : ''}` : `목표일이 ${-p.daysLeft}일 지났어요`}</Text>}
            </View>
          );
        })}
      </Card>
      {form ? (
        <Card style={{ gap: 12 }}>
          <Text style={{ fontWeight: '800', color: t.text }}>{form.id ? '목표 수정' : '목표 추가'}</Text>
          <Field label="이름" value={form.name} onChangeText={(name) => setForm({ ...form, name })} placeholder="예: 비상금, 여행 자금" />
          <Field label="목표 금액" value={form.target} keyboardType="number-pad" onChangeText={(s) => { const n = parseAmount(s); setForm({ ...form, target: n ? fmtNum(n) : '' }); }} />
          <Text style={{ fontSize: 13, fontWeight: '700', color: t.sub }}>연결 통장 (잔액이 진행액)</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Chip label="연결 안 함" on={form.accountId === null} onPress={() => setForm({ ...form, accountId: null })} />
            {active.map((a) => <Chip key={a.id} label={a.name} on={form.accountId === a.id} onPress={() => setForm({ ...form, accountId: a.id })} />)}
          </View>
          {form.accountId === null && <Field label="현재 모은 금액" value={form.saved} keyboardType="number-pad" onChangeText={(s) => { const n = parseAmount(s); setForm({ ...form, saved: n ? fmtNum(n) : '' }); }} />}
          <Field label="목표일 (선택, YYYY-MM-DD)" value={form.due} onChangeText={(due) => setForm({ ...form, due })} placeholder="예: 2027-06-30" />
          <Button title="저장" onPress={save} />
          <Button title="닫기" kind="soft" onPress={() => setForm(null)} />
          {form.id && <Button title="삭제" kind="danger" onPress={async () => { await mutate((db) => deleteGoal(db, form.id as string)); setForm(null); }} />}
        </Card>
      ) : <Button title="목표 추가" icon="add" onPress={() => open()} />}
    </ScrollView>
  );
}
