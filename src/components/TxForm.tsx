import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Directory, File, Paths } from 'expo-file-system';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { insertTx, saveTemplate, uid, updateTx, type TxInput } from '../db/repo';
import { resolveAccount } from '../lib/accounts';
import { fmtDateLabel, hm, isHm, isYmd, parseYmd, ymd } from '../lib/dates';
import { norm } from '../lib/match';
import { itemsSum, lineTotal, validateItems } from '../lib/items';
import { fmtNum, parseAmount, parseSigned } from '../lib/money';
import { MISC_EXPENSE_ID, MISC_INCOME_ID } from '../lib/seed';
import { TYPE_LABEL, type ItemInput, type Tx, type TxType } from '../lib/types';
import { useLedger } from '../store';
import { R, useTheme } from '../theme';
import { catStyle } from './TxRow';
import { CategoryPicker } from './CategoryPicker';
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

interface Row { key: string; name: string; qty: string; unit: string; amount: string; categoryId: string | null; open: boolean }
let rowSeq = 0;
const newRow = (p: Partial<Row> = {}): Row => ({ key: `r${++rowSeq}`, name: '', qty: '1', unit: '', amount: '', categoryId: null, open: false, ...p });

/** 화면 행 → 품목 입력값. 금액을 비워 두고 단가가 있으면 수량×단가 */
function toInput(r: Row): ItemInput {
  const q = parseFloat(r.qty.replace(',', '.'));
  const qty = q > 0 && Number.isFinite(q) ? q : 1;
  const unit = r.unit.trim() ? parseSigned(r.unit) : null;
  const amount = r.amount.trim() ? parseSigned(r.amount) : lineTotal(qty, unit) ?? 0;
  return { name: r.name.trim(), qty, unit_price: unit, amount, category_id: r.categoryId };
}

/** 거래 입력/수정 시트. 통장은 (직접 선택 > 규칙 > 기본 통장) 순으로 자동 선택된다 */
export function TxForm({ edit, init }: { edit?: Tx; init?: FormInit }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { accounts, categories, catById, rules, txs, templates, itemsByTx, mutate, removeTx, quickRecord } = useLedger();
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

  // ---- 영수증 품목 / 사진
  const existingItems = edit ? itemsByTx.get(edit.id) ?? [] : [];
  const [useItems, setUseItems] = useState(existingItems.length > 0);
  const [rows, setRows] = useState<Row[]>(() => existingItems.map((i) => newRow({
    name: i.name, qty: String(i.qty), unit: i.unit_price === null ? '' : String(i.unit_price), amount: String(i.amount), categoryId: i.category_id })));
  const [receipt, setReceipt] = useState<string | null>(edit?.receipt_uri ?? null);
  const [bigReceipt, setBigReceipt] = useState(false);

  const active = useMemo(() => accounts.filter((a) => !a.archived), [accounts]);
  const isTransfer = type === 'transfer';
  const itemMode = useItems && type === 'expense';
  const itemInputs = useMemo(() => rows.map(toInput), [rows]);
  const amount = itemMode ? itemsSum(itemInputs) : parseAmount(amountText);
  const setRow = (key: string, p: Partial<Row>) => setRows((l) => l.map((r) => (r.key === key ? { ...r, ...p } : r)));

  // ---- 통장 자동 선택: 직접 고르기 전까지 가맹점/메모/카테고리에 맞춰 규칙 → 기본 통장 순으로
  const auto = useMemo(
    () => resolveAccount({ explicitId: null, rules, accounts, categories, merchant, memo, categoryId: isTransfer ? null : categoryId }),
    [rules, accounts, categories, merchant, memo, categoryId, isTransfer],
  );
  useEffect(() => {
    if (!accountTouched && auto.account) setAccountId(auto.account.id);
  }, [auto.account, accountTouched]);

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
    if (amount <= 0) return Alert.alert(itemMode ? '품목 금액의 합계가 0보다 커야 해요' : '금액을 입력해 주세요');
    if (itemMode) {
      if (!rows.length) return Alert.alert('품목을 추가해 주세요', '품목 없이 총액만 기록하려면 "영수증 품목으로 입력"을 끄세요.');
      const err = validateItems(itemInputs, amount);
      if (err) return Alert.alert('품목을 확인해 주세요', err);
    }
    if (!accountId) return Alert.alert('통장을 선택해 주세요');
    if (isTransfer && (!toAccountId || toAccountId === accountId)) return Alert.alert('입금 통장은 출금 통장과 달라야 해요');
    setSaving(true);
    try {
      const cat = isTransfer ? null : categoryId ?? (type === 'income' ? MISC_INCOME_ID : MISC_EXPENSE_ID);
      const input: TxInput = {
        type, amount, date, time, account_id: accountId, to_account_id: isTransfer ? toAccountId : null, category_id: cat,
        merchant: merchant.trim() || null, memo: memo.trim() || null, tags: tags.trim() || null, receipt_uri: receipt,
      };
      const items = itemMode ? itemInputs : [];
      await mutate(async (db) => { if (edit) await updateTx(db, edit.id, input, items); else await insertTx(db, input, undefined, items); });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      if (again && !edit) {
        setAmountText(''); setMerchant(''); setMemo(''); setTags(''); setTime(null); setCategoryId(null); setRows([]); setReceipt(null);
        if (!base.accountId) setAccountTouched(false);
      } else router.back();
    } catch (e) {
      Alert.alert('저장하지 못했어요', e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const toggleItems = () => {
    if (!useItems) {
      setUseItems(true);
      // 이미 입력한 총액이 있으면 첫 품목으로 옮겨 준다
      if (!rows.length) setRows([newRow({ name: merchant.trim(), amount: amountText ? String(parseAmount(amountText)) : '' })]);
      return;
    }
    if (!rows.length) { setUseItems(false); return; }
    Alert.alert('품목 입력을 끌까요?', '입력한 품목은 지워지고, 총액만 남아요.', [
      { text: '취소', style: 'cancel' },
      { text: '끄기', style: 'destructive', onPress: () => { setAmountText(amount ? fmtNum(amount) : ''); setRows([]); setUseItems(false); } },
    ]);
  };

  const attach = async (from: 'camera' | 'library') => {
    try {
      const perm = from === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : { granted: true };
      if (!perm.granted) return Alert.alert('카메라 권한이 필요해요', '휴대폰 설정에서 카메라 권한을 허용해 주세요.');
      const r = from === 'camera' ? await ImagePicker.launchCameraAsync({ quality: 0.7 }) : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
      if (r.canceled || !r.assets?.[0]) return;
      // 선택기가 주는 임시 파일은 사라질 수 있어 앱 문서 폴더로 복사해 둔다
      const dir = new Directory(Paths.document, 'receipts');
      dir.create({ idempotent: true, intermediates: true });
      const dest = new File(dir, `${uid()}.jpg`);
      new File(r.assets[0].uri).copy(dest);
      if (receipt) { try { new File(receipt).delete(); } catch { /* 이미 없으면 무시 */ } }
      setReceipt(dest.uri);
    } catch (e) {
      Alert.alert('사진을 가져오지 못했어요', e instanceof Error ? e.message : String(e));
    }
  };
  const removeReceipt = () => {
    if (receipt) { try { new File(receipt).delete(); } catch { /* 이미 없으면 무시 */ } }
    setReceipt(null);
  };

  const saveAsTemplate = async () => {
    if (amount <= 0) return Alert.alert('금액을 먼저 입력해 주세요');
    const name = merchant.trim() || (sel?.name ?? TYPE_LABEL[type]);
    await mutate((db) => saveTemplate(db, {
      name, type, amount, account_id: accountTouched ? accountId : null, to_account_id: isTransfer ? toAccountId : null,
      category_id: isTransfer ? null : categoryId, merchant: merchant.trim() || null, memo: memo.trim() || null,
    }));
    Alert.alert('자주 쓰는 거래로 저장했어요', `"${name}" — 입력 화면과 홈에서 한 번에 기록할 수 있어요.`);
  };

  const del = () =>
    Alert.alert('이 내역을 삭제할까요?', `${edit?.merchant ?? TYPE_LABEL[type]} ${fmtNum(edit?.amount ?? 0)}원`, [
      { text: '취소', style: 'cancel' },
      { text: '삭제', style: 'destructive', onPress: async () => { if (edit) { await removeTx(edit); router.back(); } } },
    ]);

  const typeColor = type === 'expense' ? t.expense : type === 'income' ? t.income : t.sub;

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: t.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 18, paddingBottom: insets.bottom + 120 }} keyboardShouldPersistTaps="handled">
        {!edit && templates.length > 0 && (
          <View style={{ gap: 8 }}>
            <Text style={{ fontSize: 13, fontWeight: '700', color: t.sub, marginLeft: 4 }}>자주 쓰는 거래 (탭하면 오늘 날짜로 바로 기록)</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} keyboardShouldPersistTaps="handled">
              {templates.map((x) => (
                <Chip key={x.id} label={`${x.name} ${fmtNum(x.amount)}`} icon="flash" onPress={async () => {
                  try { await quickRecord(x); router.back(); } catch (e) { Alert.alert('기록하지 못했어요', e instanceof Error ? e.message : String(e)); }
                }} />
              ))}
            </ScrollView>
          </View>
        )}
        <View style={{ flexDirection: 'row', backgroundColor: t.input, borderRadius: R.md, padding: 4 }}>
          {(['expense', 'income', ...(edit?.type === 'transfer' ? ['transfer' as const] : [])] as TxType[]).map((k) => (
            <Pressable key={k} onPress={() => setType(k)} accessibilityRole="button" accessibilityState={{ selected: type === k }}
              style={{ flex: 1, height: 40, borderRadius: R.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: type === k ? t.card : 'transparent' }}>
              <Text style={{ fontWeight: '800', fontSize: 15, color: type === k ? (k === 'expense' ? t.expense : k === 'income' ? t.income : t.text) : t.sub }}>{TYPE_LABEL[k]}</Text>
            </Pressable>
          ))}
        </View>

        <View style={{ backgroundColor: t.card, borderRadius: R.lg, padding: 16, gap: 10 }}>
          <Text style={{ fontSize: 13, fontWeight: '700', color: t.sub }}>금액</Text>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
            {itemMode ? (
              <Text accessibilityLabel="금액 (품목 합계)" style={{ flex: 1, fontSize: 38, fontWeight: '800', color: typeColor }}>{amount ? fmtNum(amount) : '0'}</Text>
            ) : (
              <TextInput value={amountText} onChangeText={(s) => { const n = parseAmount(s); setAmountText(n ? fmtNum(n) : ''); }}
                keyboardType="number-pad" placeholder="0" placeholderTextColor={t.faint} autoFocus={!edit} accessibilityLabel="금액"
                style={{ flex: 1, fontSize: 38, fontWeight: '800', color: typeColor, padding: 0 }} />
            )}
            <Text style={{ fontSize: 22, fontWeight: '700', color: t.sub }}>원</Text>
          </View>
          {itemMode ? <Text style={{ fontSize: 12.5, color: t.sub }}>품목 금액의 합계가 총액이 돼요.</Text> : (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {QUICK.map((n) => <Chip key={n} label={`+${fmtNum(n)}`} onPress={() => bump(n)} />)}
              {!!amount && <Chip label="지움" onPress={() => setAmountText('')} />}
            </View>
          )}
        </View>

        {type === 'expense' && (
          <View style={{ gap: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Chip label="영수증 품목으로 입력" icon="receipt-outline" on={useItems} onPress={toggleItems} />
            </View>
            {itemMode && (
              <>
                {rows.map((r, idx) => {
                  const inp = itemInputs[idx];
                  const cat = r.categoryId ? catById.get(r.categoryId) : undefined;
                  const small = { flex: 1, height: 44, borderRadius: R.sm, paddingHorizontal: 10, fontSize: 15, color: t.text, backgroundColor: t.input } as const;
                  return (
                    <View key={r.key} style={{ backgroundColor: t.card, borderRadius: R.md, padding: 12, gap: 8 }}>
                      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                        <Text style={{ width: 22, fontWeight: '800', color: t.sub }}>{idx + 1}</Text>
                        <TextInput value={r.name} onChangeText={(name) => setRow(r.key, { name })} placeholder="품목 이름 (예: 우유 1L)" placeholderTextColor={t.faint}
                          accessibilityLabel={`${idx + 1}번 품목 이름`} style={{ ...small, flex: 3 }} />
                      </View>
                      <View style={{ flexDirection: 'row', gap: 8 }}>
                        <TextInput value={r.qty} onChangeText={(qty) => setRow(r.key, { qty })} keyboardType="decimal-pad" placeholder="수량" placeholderTextColor={t.faint} accessibilityLabel="수량" style={small} />
                        <TextInput value={r.unit} onChangeText={(unit) => setRow(r.key, { unit })} keyboardType="numbers-and-punctuation" placeholder="단가" placeholderTextColor={t.faint} accessibilityLabel="단가" style={small} />
                        <TextInput value={r.amount} onChangeText={(a) => setRow(r.key, { amount: a })} keyboardType="numbers-and-punctuation"
                          placeholder={inp.unit_price !== null ? fmtNum(inp.amount) : '금액'} placeholderTextColor={t.faint} accessibilityLabel="금액" style={{ ...small, flex: 1.3, fontWeight: '700' }} />
                      </View>
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                        <Chip label={cat ? `분류: ${cat.name}` : '분류: 거래와 같음'} on={!!cat} onPress={() => setRow(r.key, { open: !r.open })} />
                        <Chip label="삭제" onPress={() => setRows((l) => l.filter((x) => x.key !== r.key))} icon="trash-outline" />
                        {inp.amount < 0 && <Text style={{ color: t.income, fontWeight: '700' }}>할인 {fmtNum(-inp.amount)}원</Text>}
                      </View>
                      {r.open && <CategoryPicker type="expense" value={r.categoryId} onChange={(categoryId) => setRow(r.key, { categoryId })} allowNone noneLabel="거래 분류와 같음" />}
                    </View>
                  );
                })}
                <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                  <Chip label="+ 품목 추가" onPress={() => setRows((l) => [...l, newRow()])} />
                  <Chip label="+ 할인/쿠폰" onPress={() => setRows((l) => [...l, newRow({ name: '할인', amount: '-' })])} />
                </View>
                <Text style={{ fontSize: 12.5, color: t.sub, marginLeft: 4 }}>
                  품목 {rows.length}개 · 합계 {fmtNum(amount)}원. 분류를 정한 품목은 통계·예산에서 그 분류로 계산돼요. 할인은 금액에 -를 붙여 입력해요.
                </Text>
              </>
            )}
          </View>
        )}

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
          <Text style={{ fontSize: 13, fontWeight: '700', color: t.sub, marginLeft: 4 }}>영수증 사진</Text>
          {receipt ? (
            <View style={{ gap: 8 }}>
              <Pressable onPress={() => setBigReceipt((b) => !b)} accessibilityRole="button" accessibilityLabel="영수증 사진 크게 보기">
                <Image source={{ uri: receipt }} resizeMode="contain" style={{ width: '100%', height: bigReceipt ? 440 : 150, borderRadius: R.md, backgroundColor: t.input }} />
              </Pressable>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Chip label={bigReceipt ? '작게' : '크게 보기'} onPress={() => setBigReceipt((b) => !b)} />
                <Chip label="사진 삭제" icon="trash-outline" onPress={removeReceipt} />
              </View>
            </View>
          ) : (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Chip label="카메라" icon="camera-outline" onPress={() => attach('camera')} />
              <Chip label="앨범" icon="image-outline" onPress={() => attach('library')} />
            </View>
          )}
          <Text style={{ fontSize: 12, color: t.faint, lineHeight: 17, marginLeft: 4 }}>
            이 앱은 영수증을 자동으로 읽지 않아요. 비서 앱에 영수증 사진을 보여 주면 품목째 기록해 줘요. 사진은 이 기기에만 보관되고 백업 파일에는 포함되지 않아요.
          </Text>
        </View>

        <View style={{ gap: 8 }}>
          <Button title={saving ? '저장 중…' : edit ? '수정 저장' : '저장'} onPress={() => save(false)} disabled={saving} />
          {!edit && <Button title="저장하고 계속 입력" kind="soft" icon="add" onPress={() => save(true)} disabled={saving} />}
          <Button title="자주 쓰는 거래로 저장" kind="soft" icon="flash" onPress={saveAsTemplate} disabled={saving} />
          {edit && <Button title="삭제" kind="danger" onPress={del} />}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
