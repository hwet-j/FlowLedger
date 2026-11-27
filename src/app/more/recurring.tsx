import React, { useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { deleteRecurring, runRecurring, saveRecurring } from '../../db/repo';
import { CategoryPicker } from '../../components/CategoryPicker';
import { Button, Card, Chip, Empty, Field, Row } from '../../components/ui';
import { isYmd, todayStr } from '../../lib/dates';
import { fmtNum, fmtWon, parseAmount } from '../../lib/money';
import { nextRun } from '../../lib/recurring';
import { MISC_EXPENSE_ID, MISC_INCOME_ID } from '../../lib/seed';
import { TYPE_LABEL, type Recurring, type TxType } from '../../lib/types';
import { useLedger } from '../../store';
import { useTheme } from '../../theme';

interface Form { id?: string; type: TxType; amount: string; accountId: string | null; toId: string | null; categoryId: string | null; merchant: string; memo: string; day: number; start: string; end: string; active: boolean }

export default function RecurringScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { recurring, accounts, accountById, catById, mutate } = useLedger();
  const active = accounts.filter((a) => !a.archived);
  const [form, setForm] = useState<Form | null>(null);
  const today = todayStr();

  const open = (r?: Recurring) =>
    setForm(r ? { id: r.id, type: r.type, amount: fmtNum(r.amount), accountId: r.account_id, toId: r.to_account_id, categoryId: r.category_id, merchant: r.merchant ?? '', memo: r.memo ?? '',
      day: r.day, start: r.start_date, end: r.end_date ?? '', active: !!r.active }
      : { type: 'expense', amount: '', accountId: active.find((a) => a.is_default)?.id ?? active[0]?.id ?? null, toId: null, categoryId: null, merchant: '', memo: '', day: new Date().getDate(), start: today, end: '', active: true });

  const save = async () => {
    if (!form) return;
    const amount = parseAmount(form.amount);
    if (!amount) return Alert.alert('금액을 입력해 주세요');
    if (!form.accountId) return Alert.alert('통장을 선택해 주세요');
    if (form.type === 'transfer' && (!form.toId || form.toId === form.accountId)) return Alert.alert('입금 통장을 다르게 선택해 주세요');
    if (!isYmd(form.start)) return Alert.alert('시작일을 YYYY-MM-DD 형식으로 입력해 주세요');
    if (form.end && !isYmd(form.end)) return Alert.alert('종료일을 YYYY-MM-DD 형식으로 입력하거나 비워 두세요');
    if (!form.merchant.trim() && !form.memo.trim()) return Alert.alert('내용(가맹점)을 입력해 주세요', '예: 월세, 넷플릭스');
    const cat = form.type === 'transfer' ? null : form.categoryId ?? (form.type === 'income' ? MISC_INCOME_ID : MISC_EXPENSE_ID);
    await mutate(async (db) => {
      await saveRecurring(db, { id: form.id, type: form.type, amount, account_id: form.accountId as string, to_account_id: form.toId, category_id: cat,
        merchant: form.merchant.trim() || null, memo: form.memo.trim() || null, day: form.day, start_date: form.start, end_date: form.end || null, active: form.active ? 1 : 0 });
      await runRecurring(db, todayStr()); // 시작일이 과거면 바로 따라잡기
    });
    setForm(null);
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: insets.bottom + 40 }} keyboardShouldPersistTaps="handled">
      <Text style={{ color: t.sub, lineHeight: 19 }}>월세·구독·급여처럼 매달 같은 날 반복되는 내역이에요. 앱을 열 때 도래한 건 자동으로 기록하고, 오래 안 열었어도 밀린 달을 한꺼번에 채워요. 말일이 없는 달은 그 달 말일에 기록돼요.</Text>
      <Card>
        {recurring.length === 0 ? <Empty icon="repeat-outline" title="고정 거래가 없어요" hint="아래에서 추가해 보세요." /> : recurring.map((r, i) => {
          const nx = nextRun(r, today);
          return (
            <Row key={r.id} icon="repeat" label={`${r.merchant ?? r.memo ?? TYPE_LABEL[r.type]} · ${fmtWon(r.amount)}`}
              sub={`매달 ${r.day}일 · ${accountById.get(r.account_id)?.name ?? '?'}${r.category_id ? ` · ${catById.get(r.category_id)?.name ?? ''}` : ''}${r.active ? (nx ? ` · 다음 ${nx}` : ' · 종료') : ' · 일시중지'}`}
              onPress={() => open(r)} last={i === recurring.length - 1} />
          );
        })}
      </Card>
      {form ? (
        <Card style={{ gap: 12 }}>
          <Text style={{ fontWeight: '800', color: t.text }}>{form.id ? '고정 거래 수정' : '고정 거래 추가'}</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {(['expense', 'income', 'transfer'] as TxType[]).map((k) => <Chip key={k} label={TYPE_LABEL[k]} on={form.type === k} onPress={() => setForm({ ...form, type: k, categoryId: null })} />)}
          </View>
          <Field label="금액" value={form.amount} keyboardType="number-pad" onChangeText={(s) => { const n = parseAmount(s); setForm({ ...form, amount: n ? fmtNum(n) : '' }); }} placeholder="예: 500,000" />
          <Field label="내용 / 가맹점" value={form.merchant} onChangeText={(merchant) => setForm({ ...form, merchant })} placeholder="예: 월세, 넷플릭스" />
          <Text style={{ fontSize: 13, fontWeight: '700', color: t.sub }}>{form.type === 'transfer' ? '출금 통장' : '통장'}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {active.map((a) => <Chip key={a.id} label={a.name} on={form.accountId === a.id} onPress={() => setForm({ ...form, accountId: a.id })} />)}
          </View>
          {form.type === 'transfer' && (
            <>
              <Text style={{ fontSize: 13, fontWeight: '700', color: t.sub }}>입금 통장</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {active.filter((a) => a.id !== form.accountId).map((a) => <Chip key={a.id} label={a.name} on={form.toId === a.id} onPress={() => setForm({ ...form, toId: a.id })} />)}
              </View>
            </>
          )}
          {form.type !== 'transfer' && <CategoryPicker type={form.type === 'income' ? 'income' : 'expense'} value={form.categoryId} onChange={(categoryId) => setForm({ ...form, categoryId })} allowNone noneLabel="기타" />}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Text style={{ fontWeight: '700', color: t.text }}>매달</Text>
            <Pressable onPress={() => setForm({ ...form, day: form.day <= 1 ? 31 : form.day - 1 })} accessibilityRole="button" accessibilityLabel="날짜 줄이기"><Text style={{ fontSize: 26, color: t.primary }}>−</Text></Pressable>
            <Text style={{ fontSize: 20, fontWeight: '800', color: t.text, minWidth: 40, textAlign: 'center' }}>{form.day}일</Text>
            <Pressable onPress={() => setForm({ ...form, day: form.day >= 31 ? 1 : form.day + 1 })} accessibilityRole="button" accessibilityLabel="날짜 늘리기"><Text style={{ fontSize: 26, color: t.primary }}>＋</Text></Pressable>
          </View>
          <Field label="시작일 (YYYY-MM-DD)" value={form.start} onChangeText={(start) => setForm({ ...form, start })} placeholder={today} />
          <Field label="종료일 (선택)" value={form.end} onChangeText={(end) => setForm({ ...form, end })} placeholder="비워 두면 계속" />
          <Chip label={form.active ? '사용 중' : '일시중지'} on={form.active} onPress={() => setForm({ ...form, active: !form.active })} />
          <Button title="저장" onPress={save} />
          <Button title="닫기" kind="soft" onPress={() => setForm(null)} />
          {form.id && <Button title="삭제 (이미 기록된 내역은 유지)" kind="danger" onPress={() => Alert.alert('고정 거래를 삭제할까요?', '앞으로 자동 기록되지 않아요.', [{ text: '취소', style: 'cancel' }, { text: '삭제', style: 'destructive', onPress: async () => { await mutate((db) => deleteRecurring(db, form.id as string)); setForm(null); } }])} />}
        </Card>
      ) : <Button title="고정 거래 추가" icon="add" onPress={() => open()} />}
    </ScrollView>
  );
}
