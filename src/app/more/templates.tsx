import React, { useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { deleteTemplate, saveTemplate } from '../../db/repo';
import { CategoryPicker } from '../../components/CategoryPicker';
import { Button, Card, Chip, Empty, Field, Row } from '../../components/ui';
import { categoryPath } from '../../lib/match';
import { fmtNum, fmtWon, parseAmount } from '../../lib/money';
import { TYPE_LABEL, type Template, type TxType } from '../../lib/types';
import { useLedger } from '../../store';
import { useTheme } from '../../theme';

interface Form { id?: string; name: string; type: TxType; amount: string; accountId: string | null; toId: string | null; categoryId: string | null; merchant: string }

export default function TemplatesScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { templates, accounts, accountById, catById, categories, mutate } = useLedger();
  const active = accounts.filter((a) => !a.archived);
  const [form, setForm] = useState<Form | null>(null);

  const open = (x?: Template) => setForm(x ? { id: x.id, name: x.name, type: x.type, amount: fmtNum(x.amount), accountId: x.account_id, toId: x.to_account_id, categoryId: x.category_id, merchant: x.merchant ?? '' }
    : { name: '', type: 'expense', amount: '', accountId: null, toId: null, categoryId: null, merchant: '' });
  const save = async () => {
    if (!form) return;
    const amount = parseAmount(form.amount);
    if (!form.name.trim()) return Alert.alert('이름을 입력해 주세요', '예: 점심, 교통카드 충전');
    if (!amount) return Alert.alert('금액을 입력해 주세요');
    if (form.type === 'transfer' && (!form.accountId || !form.toId || form.accountId === form.toId)) return Alert.alert('이체는 출금·입금 통장을 서로 다르게 지정해 주세요');
    await mutate((db) => saveTemplate(db, { id: form.id, name: form.name.trim(), type: form.type, amount, account_id: form.accountId, to_account_id: form.toId, category_id: form.categoryId, merchant: form.merchant.trim() || null, memo: null }));
    setForm(null);
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: insets.bottom + 40 }} keyboardShouldPersistTaps="handled">
      <Text style={{ color: t.sub, lineHeight: 19 }}>자주 쓰는 내역을 저장해 두면 입력 화면과 홈에서 칩 한 번으로 오늘 날짜에 바로 기록해요. 통장을 「자동」으로 두면 규칙 → 기본 통장 순으로 정해져요.</Text>
      <Card>
        {templates.length === 0 ? <Empty icon="flash-outline" title="자주 쓰는 거래가 없어요" hint="내역 입력 화면의 '자주 쓰는 거래로 저장'으로도 추가할 수 있어요." /> : templates.map((x, i) => (
          <Row key={x.id} icon="flash" label={`${x.name} · ${fmtWon(x.amount)}`}
            sub={`${TYPE_LABEL[x.type]} · ${x.account_id ? accountById.get(x.account_id)?.name : '통장 자동'}${x.category_id && catById.get(x.category_id) ? ` · ${categoryPath(catById.get(x.category_id)!, categories)}` : ''}`}
            onPress={() => open(x)} last={i === templates.length - 1} />
        ))}
      </Card>
      {form ? (
        <Card style={{ gap: 12 }}>
          <Text style={{ fontWeight: '800', color: t.text }}>{form.id ? '수정' : '추가'}</Text>
          <Field label="이름" value={form.name} onChangeText={(name) => setForm({ ...form, name })} placeholder="예: 점심, 교통카드 충전" />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {(['expense', 'income', 'transfer'] as TxType[]).map((k) => <Chip key={k} label={TYPE_LABEL[k]} on={form.type === k} onPress={() => setForm({ ...form, type: k, categoryId: null })} />)}
          </View>
          <Field label="금액" value={form.amount} keyboardType="number-pad" onChangeText={(s) => { const n = parseAmount(s); setForm({ ...form, amount: n ? fmtNum(n) : '' }); }} placeholder="예: 9,000" />
          <Field label="가맹점 / 내용 (선택)" value={form.merchant} onChangeText={(merchant) => setForm({ ...form, merchant })} />
          <Text style={{ fontSize: 13, fontWeight: '700', color: t.sub }}>{form.type === 'transfer' ? '출금 통장' : '통장'}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {form.type !== 'transfer' && <Chip label="자동" on={form.accountId === null} onPress={() => setForm({ ...form, accountId: null })} />}
            {active.map((a) => <Chip key={a.id} label={a.name} on={form.accountId === a.id} onPress={() => setForm({ ...form, accountId: a.id })} />)}
          </View>
          {form.type === 'transfer' ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {active.filter((a) => a.id !== form.accountId).map((a) => <Chip key={a.id} label={`→ ${a.name}`} on={form.toId === a.id} onPress={() => setForm({ ...form, toId: a.id })} />)}
            </View>
          ) : <CategoryPicker type={form.type === 'income' ? 'income' : 'expense'} value={form.categoryId} onChange={(categoryId) => setForm({ ...form, categoryId })} allowNone noneLabel="기타" />}
          <Button title="저장" onPress={save} />
          <Button title="닫기" kind="soft" onPress={() => setForm(null)} />
          {form.id && <Button title="삭제" kind="danger" onPress={async () => { await mutate((db) => deleteTemplate(db, form.id as string)); setForm(null); }} />}
        </Card>
      ) : <Button title="자주 쓰는 거래 추가" icon="add" onPress={() => open()} />}
    </ScrollView>
  );
}
