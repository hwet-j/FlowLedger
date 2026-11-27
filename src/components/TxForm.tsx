import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { insertTx, updateTx, type TxInput } from '../db/repo';
import { resolveAccount } from '../lib/accounts';
import { fmtDateLabel, hm, isHm, isYmd, parseYmd, ymd } from '../lib/dates';
import { norm } from '../lib/match';
import { fmtNum, parseAmount } from '../lib/money';
import { MISC_EXPENSE_ID, MISC_INCOME_ID } from '../lib/seed';
import { TYPE_LABEL, type Tx, type TxType } from '../lib/types';
import { useLedger } from '../store';
import { R, useTheme } from '../theme';
import { catStyle } from './TxRow';
import { Button, Chip, Field } from './ui';

export interface FormInit {
  type?: TxType;
  amount?: number;
  date?: string;
  time?: string | null;
  accountId?: string | null;
  toAccountId?: string | null;
  categoryId?: string | null;
  merchant?: string;
  memo?: string;
  tags?: string;
}

const QUICK = [1_000, 10_000, 50_000];

/** 거래 입력/수정 시트. 통장은 (직접 선택 > 규칙 > 기본 통장) 순으로 자동 선택된다 */
export function TxForm({ edit, init }: { edit?: Tx; init?: FormInit }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { accounts, categories, catById, rules, txs, mutate, removeTx } = useLedger();
  const base: FormInit = edit
    ? { type: edit.type, amount: edit.amount, date: edit.date, time: edit.time, accountId: edit.account_id, toAccountId: edit.to_account_id, categoryId: edit.category_id,
        merchant: edit.merchant ?? '', memo: edit.memo ?? '', tags: edit.tags ?? '' }
    : init ?? {};

  const [type, setType] = useState<TxType>(base.type ?? 'expense');
  const [amountText, setAmountText] = useState(base.amount ? fmtNum(base.amount) : '');
  const [date, setDate] = useState(base.date && isYmd(base.date) ? base.date : ymd(new Date()));
  const [time, setTime] = useState<string | null>(base.time && isHm(base.time) ? base.time : null);
  const [accountId, setAccountId] = useState<string | null>(base.accountId ?? null);
  const [accountTouched, setAccountTouched] = useState(!!edit || !!base.accountId);
  const [toAccountId, setToAccountId] = useState<string | null>(base.toAccountId ?? null);
  const [categoryId, setCategoryId] = useState<string | null>(base.categoryId ?? null);
  const [merchant, setMerchant] = useState(base.merchant ?? '');
  const [memo, setMemo] = useState(base.memo ?? '');
  const [tags, setTags] = useState(base.tags ?? '');
  const [picker, setPicker] = useState<null | 'date' | 'time'>(null);
  const [saving, setSaving] = useState(false);
  const [merchantFocus, setMerchantFocus] = useState(false);

  const active = useMemo(() => accounts.filter((a) => !a.archived), [accounts]);
  const amount = parseAmount(amountText);
  const isTransfer = type === 'transfer';

  // ---- 통장 자동 선택: 직접 고르기 전까지 가맹점/메모/카테고리에 맞춰 규칙 → 기본 통장 순으로
  const auto = useMemo(
    () => resolveAccount({ explicitId: null, rules, accounts, categories, merchant, memo, categoryId: isTransfer ? null : categoryId }),
    [rules, accounts, categories, merchant, memo, categoryId, isTransfer],
  );
  useEffect(() => {
    if (!accountTouched && auto.account) setAccountId(auto.account.id);
  }, [auto.account, accountTouched]);
  const accountSource = accountTouched ? 'explicit' : auto.source;

  // 이체 입금 통장은 출금 통장과 달라야 한다
  useEffect(() => {
    if (isTransfer && (!toAccountId || toAccountId === accountId)) setToAccountId(active.find((a) => a.id !== accountId)?.id ?? null);
  }, [isTransfer, accountId, toAccountId, active]);

  // 유형을 바꾸면 맞지 않는 카테고리는 비운다
  useEffect(() => {
    const c = categoryId ? catById.get(categoryId) : undefined;
    if (c && c.type !== type) setCategoryId(null);
  }, [type, categoryId, catById]);

  const pool = categories.filter((c) => c.type === (type === 'income' ? 'income' : 'expense') && !c.archived);
  const tops = pool.filter((c) => !c.parent_id);
  const sel = categoryId ? catById.get(categoryId) : undefined;
  const openTopId = sel ? sel.parent_id ?? sel.id : null;
  const subs = openTopId ? pool.filter((c) => c.parent_id === openTopId) : [];

  // ---- 가맹점 자동완성: 최근에 쓴 가맹점. 고르면 마지막으로 쓴 카테고리도 가져온다
  const recent = useMemo(() => {
    const seen = new Map<string, Tx>();
    for (const x of txs) {
      if (!x.merchant?.trim()) continue;
      const k = norm(x.merchant);
      if (!seen.has(k)) seen.set(k, x);
      if (seen.size >= 60) break;
    }
    return [...seen.values()];
  }, [txs]);
  const q = norm(merchant);
  const suggestions = merchantFocus ? recent.filter((x) => (q ? norm(x.merchant ?? '').includes(q) && norm(x.merchant ?? '') !== q : true)).slice(0, 5) : [];
  const pickMerchant = (x: Tx) => {
    setMerchant(x.merchant ?? '');
    if (!categoryId && x.category_id && x.type === type) setCategoryId(x.category_id);
    setMerchantFocus(false);
  };

  const bump = (n: number) => { Haptics.selectionAsync().catch(() => {}); setAmountText(fmtNum(amount + n)); };

  const save = async (again: boolean) => {
    if (amount <= 0) return Alert.alert('금액을 입력해 주세요');
    if (!accountId) return Alert.alert('통장을 선택해 주세요');
    if (isTransfer && (!toAccountId || toAccountId === accountId)) return Alert.alert('입금 통장은 출금 통장과 달라야 해요');
    setSaving(true);
    try {
      const cat = isTransfer ? null : categoryId ?? (type === 'income' ? MISC_INCOME_ID : MISC_EXPENSE_ID);
      const input: TxInput = {
        type, amount, date, time, account_id: accountId, to_account_id: isTransfer ? toAccountId : null, category_id: cat,
        merchant: merchant.trim() || null, memo: memo.trim() || null, tags: tags.trim() || null,
      };
      await mutate(async (db) => { if (edit) await updateTx(db, edit.id, input); else await insertTx(db, input); });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      if (again && !edit) {
        setAmountText(''); setMerchant(''); setMemo(''); setTags(''); setTime(null); setCategoryId(null);
        if (!base.accountId) setAccountTouched(false);
      } else router.back();
    } catch (e) {
      Alert.alert('저장하지 못했어요', e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const del = () =>
    Alert.alert('이 내역을 삭제할까요?', `${edit?.merchant ?? TYPE_LABEL[type]} ${fmtNum(edit?.amount ?? 0)}원`, [
      { text: '취소', style: 'cancel' },
      { text: '삭제', style: 'destructive', onPress: async () => { if (edit) { await removeTx(edit); router.back(); } } },
    ]);

  const typeColor = type === 'expense' ? t.expense : type === 'income' ? t.income : t.sub;
  const accName = (id: string | null) => accounts.find((a) => a.id === id)?.name ?? '선택';

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: t.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 18, paddingBottom: insets.bottom + 120 }} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: 'row', backgroundColor: t.input, borderRadius: R.md, padding: 4 }}>
          {(['expense', 'income', 'transfer'] as TxType[]).map((k) => (
            <Pressable key={k} onPress={() => setType(k)} accessibilityRole="button" accessibilityState={{ selected: type === k }}
              style={{ flex: 1, height: 40, borderRadius: R.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: type === k ? t.card : 'transparent' }}>
              <Text style={{ fontWeight: '800', fontSize: 15, color: type === k ? (k === 'expense' ? t.expense : k === 'income' ? t.income : t.text) : t.sub }}>{TYPE_LABEL[k]}</Text>
            </Pressable>
          ))}
        </View>

        <View style={{ backgroundColor: t.card, borderRadius: R.lg, padding: 16, gap: 10 }}>
          <Text style={{ fontSize: 13, fontWeight: '700', color: t.sub }}>금액</Text>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
            <TextInput value={amountText} onChangeText={(s) => { const n = parseAmount(s); setAmountText(n ? fmtNum(n) : ''); }}
              keyboardType="number-pad" placeholder="0" placeholderTextColor={t.faint} autoFocus={!edit} accessibilityLabel="금액"
              style={{ flex: 1, fontSize: 38, fontWeight: '800', color: typeColor, padding: 0 }} />
            <Text style={{ fontSize: 22, fontWeight: '700', color: t.sub }}>원</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {QUICK.map((n) => <Chip key={n} label={`+${fmtNum(n)}`} onPress={() => bump(n)} />)}
            {!!amount && <Chip label="지움" onPress={() => setAmountText('')} />}
          </View>
        </View>

        {!isTransfer && (
          <View style={{ gap: 10 }}>
            <Text style={{ fontSize: 13, fontWeight: '700', color: t.sub, marginLeft: 4 }}>카테고리 {sel ? `· ${sel.name}` : '· 미선택 시 기타'}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {tops.map((c) => {
                const st = catStyle(c, catById);
                const on = openTopId === c.id;
                return (
                  <Pressable key={c.id} onPress={() => setCategoryId(c.id)} accessibilityRole="button" accessibilityState={{ selected: on }}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, height: 40, borderRadius: R.pill, backgroundColor: on ? st.color : t.card, borderWidth: 1, borderColor: on ? st.color : t.line }}>
                    <Ionicons name={st.icon} size={16} color={on ? '#fff' : st.color} />
                    <Text style={{ fontSize: 14, fontWeight: '700', color: on ? '#fff' : t.text }}>{c.name}</Text>
                  </Pressable>
                );
              })}
            </View>
            {subs.length > 0 && (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingLeft: 4 }}>
                {subs.map((c) => <Chip key={c.id} label={c.name} on={categoryId === c.id} onPress={() => setCategoryId(categoryId === c.id ? openTopId : c.id)} />)}
              </View>
            )}
          </View>
        )}

        <View style={{ gap: 8 }}>
          <Text style={{ fontSize: 13, fontWeight: '700', color: t.sub, marginLeft: 4 }}>{isTransfer ? '출금 통장' : '통장'}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {active.map((a) => <Chip key={a.id} label={a.name} on={accountId === a.id} onPress={() => { setAccountId(a.id); setAccountTouched(true); }} icon={a.is_default ? 'star' : undefined} />)}
          </ScrollView>
          {!isTransfer && (
            <Text style={{ fontSize: 12.5, color: accountSource === 'rule' ? t.primary : t.sub, marginLeft: 4 }}>
              {accountSource === 'explicit' ? (edit ? '' : '직접 선택한 통장') : accountSource === 'rule' ? `규칙으로 선택됨 · "${auto.rule?.keyword}" → ${accName(accountId)}` : `기본 통장으로 기록돼요 (${accName(accountId)})`}
            </Text>
          )}
        </View>

        {isTransfer && (
          <View style={{ gap: 8 }}>
            <Text style={{ fontSize: 13, fontWeight: '700', color: t.sub, marginLeft: 4 }}>입금 통장</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {active.filter((a) => a.id !== accountId).map((a) => <Chip key={a.id} label={a.name} on={toAccountId === a.id} onPress={() => setToAccountId(a.id)} />)}
            </ScrollView>
          </View>
        )}

        <View style={{ gap: 8 }}>
          <Text style={{ fontSize: 13, fontWeight: '700', color: t.sub, marginLeft: 4 }}>날짜</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {[0, 1, 2].map((d) => {
              const v = ymd(new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() - d));
              return <Chip key={d} label={['오늘', '어제', '그제'][d]} on={date === v} onPress={() => setDate(v)} />;
            })}
            <Chip label={fmtDateLabel(date).replace(/^(오늘|어제) · /, '')} icon="calendar-outline" on onPress={() => setPicker('date')} />
            {time ? <Chip label={time} icon="time-outline" on onPress={() => setPicker('time')} /> : <Chip label="시간" icon="time-outline" onPress={() => { setTime(hm(new Date())); }} />}
            {time && <Chip label="시간 지움" onPress={() => setTime(null)} />}
          </View>
          {picker && (
            <DateTimePicker
              value={picker === 'date' ? parseYmd(date) : new Date(2000, 0, 1, Number((time ?? '00:00').slice(0, 2)), Number((time ?? '00:00').slice(3, 5)))}
              mode={picker}
              display="default"
              onValueChange={(_, d) => { if (picker === 'date') setDate(ymd(d)); else setTime(hm(d)); setPicker(null); }}
              onDismiss={() => setPicker(null)}
            />
          )}
        </View>

        <View style={{ gap: 12 }}>
          <View>
            <Field label="가맹점 / 내용" value={merchant} onChangeText={setMerchant} placeholder="예: 스타벅스, 넷플릭스"
              onFocus={() => setMerchantFocus(true)} onBlur={() => setTimeout(() => setMerchantFocus(false), 150)} autoCorrect={false} />
            {suggestions.length > 0 && (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                {suggestions.map((x) => <Chip key={x.id} label={x.merchant ?? ''} onPress={() => pickMerchant(x)} icon="time-outline" />)}
              </View>
            )}
          </View>
          <Field label="메모" value={memo} onChangeText={setMemo} placeholder="선택" />
          <Field label="태그 (쉼표로 구분)" value={tags} onChangeText={setTags} placeholder="예: 출장, 선물" autoCapitalize="none" />
        </View>

        <View style={{ gap: 8 }}>
          <Button title={saving ? '저장 중…' : edit ? '수정 저장' : '저장'} onPress={() => save(false)} disabled={saving} />
          {!edit && <Button title="저장하고 계속 입력" kind="soft" icon="add" onPress={() => save(true)} disabled={saving} />}
          {edit && <Button title="삭제" kind="danger" onPress={del} />}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
