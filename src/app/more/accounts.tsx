import React, { useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { archiveAccount, deleteAccount, saveAccount, setDefaultAccount } from '../../db/repo';
import { Button, Card, Chip, Empty, Field, Row } from '../../components/ui';
import { fmtNum, fmtWon, parseAmount } from '../../lib/money';
import { KIND_LABEL, type Account, type AccountKind } from '../../lib/types';
import { useLedger } from '../../store';
import { useTheme } from '../../theme';

const KINDS = Object.keys(KIND_LABEL) as AccountKind[];

export default function AccountsScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { accounts, balances, mutate } = useLedger();
  const [form, setForm] = useState<null | { id?: string; name: string; kind: AccountKind; initial: string; negative: boolean }>(null);
  const fail = (e: unknown) => Alert.alert('저장하지 못했어요', e instanceof Error && /UNIQUE/.test(e.message) ? '같은 이름의 통장이 이미 있어요.' : String(e instanceof Error ? e.message : e));

  const open = (a?: Account) =>
    setForm(a ? { id: a.id, name: a.name, kind: a.kind, initial: a.initial_balance ? fmtNum(Math.abs(a.initial_balance)) : '', negative: a.initial_balance < 0 }
      : { name: '', kind: 'bank', initial: '', negative: false });
  const save = async () => {
    if (!form) return;
    const name = form.name.trim();
    if (!name) return Alert.alert('통장 이름을 입력해 주세요');
    // 대출은 항상 음수 잔액, 그 밖에는 '마이너스 잔액'을 켠 경우만 음수
    const amount = parseAmount(form.initial);
    const bal = form.kind === 'loan' || form.negative ? -amount : amount;
    try {
      await mutate((db) => saveAccount(db, { id: form.id, name, kind: form.kind, initial_balance: bal }));
      setForm(null);
    } catch (e) { fail(e); }
  };
  const remove = (a: Account) =>
    Alert.alert(`"${a.name}" 통장을 삭제할까요?`, '내역이 있는 통장은 삭제되지 않고 보관 처리를 권해요.', [
      { text: '취소', style: 'cancel' },
      { text: '삭제', style: 'destructive', onPress: async () => {
        try {
          const r = await mutate((db) => deleteAccount(db, a.id));
          if (r === 'in_use') Alert.alert('삭제할 수 없어요', '이 통장을 쓴 내역·고정 거래가 있어요. 대신 "보관"하면 목록에서 숨겨져요.');
        } catch (e) { fail(e); }
      } },
    ]);

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: insets.bottom + 40 }} keyboardShouldPersistTaps="handled">
      <Text style={{ color: t.sub, lineHeight: 19 }}>★ 기본 통장: 통장을 말하지 않고 기록하면 여기에 기록돼요. 가맹점·카테고리별 자동 지정은 「통장 자동 지정 규칙」에서 설정해요.</Text>
      {accounts.length === 0 && <Empty title="통장이 없어요" />}
      <Card>
        {accounts.map((a, i) => (
          <Row key={a.id} icon={a.kind === 'card' ? 'card' : a.kind === 'cash' ? 'cash' : a.kind === 'loan' ? 'trending-down' : 'wallet'}
            label={`${a.is_default ? '★ ' : ''}${a.name}${a.archived ? ' (보관)' : ''}`} sub={`${KIND_LABEL[a.kind]} · 잔액 ${fmtWon(balances.get(a.id) ?? 0)}`}
            onPress={() => open(a)} last={i === accounts.length - 1} />
        ))}
      </Card>

      {form ? (
        <Card style={{ gap: 12 }}>
          <Text style={{ fontWeight: '800', color: t.text }}>{form.id ? '통장 수정' : '통장 추가'}</Text>
          <Field label="이름" value={form.name} onChangeText={(name) => setForm({ ...form, name })} placeholder="예: 국민은행, 신한카드, 비상금" />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {KINDS.map((k) => <Chip key={k} label={KIND_LABEL[k]} on={form.kind === k} onPress={() => setForm({ ...form, kind: k })} />)}
          </View>
          <Field label={form.kind === 'loan' ? '대출 잔액 (갚아야 할 금액)' : '시작 잔액'} value={form.initial} keyboardType="number-pad"
            onChangeText={(s) => { const n = parseAmount(s); setForm({ ...form, initial: n ? fmtNum(n) : '' }); }} placeholder="0" />
          {form.kind !== 'loan' && <Chip label="마이너스 잔액" on={form.negative} onPress={() => setForm({ ...form, negative: !form.negative })} />}
          <Button title="저장" onPress={save} />
          <Button title="닫기" kind="soft" onPress={() => setForm(null)} />
          {form.id && (() => {
            const a = accounts.find((x) => x.id === form.id)!;
            return (
              <View style={{ gap: 8 }}>
                {!a.is_default && !a.archived && <Button title="기본 통장으로 지정" kind="soft" icon="star" onPress={async () => { await mutate((db) => setDefaultAccount(db, a.id)); setForm(null); }} />}
                <Button title={a.archived ? '보관 해제' : '보관 (목록에서 숨김)'} kind="soft" onPress={async () => { await mutate((db) => archiveAccount(db, a.id, !a.archived)); setForm(null); }} />
                <Button title="삭제" kind="danger" onPress={() => remove(a)} />
              </View>
            );
          })()}
        </Card>
      ) : <Button title="통장 추가" icon="add" onPress={() => open()} />}
    </ScrollView>
  );
}
