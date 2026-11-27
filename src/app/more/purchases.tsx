import { router } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LineChart } from '../../components/Charts';
import { CategoryPicker } from '../../components/CategoryPicker';
import { Card, Chip, Empty, SectionTitle } from '../../components/ui';
import { addMonths, monthKey, todayStr } from '../../lib/dates';
import { itemKey } from '../../lib/items';
import { fmtWon } from '../../lib/money';
import { byMerchant, filterPurchases, itemStats, priceHistory, purchaseRows } from '../../lib/purchases';
import { useLedger } from '../../store';
import { R, useTheme } from '../../theme';

const PERIODS: [string, string, number | null][] = [['month', '이번 달', 0], ['3m', '3개월', 2], ['year', '1년', 11], ['all', '전체', null]];

/** 영수증 품목으로 본 구매 내역: 품목 검색, 누적 금액/횟수, 최근 구입가, 가격 추이, 가맹점별 구매 */
export default function PurchasesScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { txs, items, categories, catById } = useLedger();
  const [text, setText] = useState('');
  const [period, setPeriod] = useState('year');
  const [merchant, setMerchant] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [catOpen, setCatOpen] = useState(false);

  const all = useMemo(() => purchaseRows(txs, items), [txs, items]);
  const filter = useMemo(() => {
    const p = PERIODS.find((x) => x[0] === period);
    const back = p?.[2];
    return { text, merchant, categoryId, ...(back === null || back === undefined ? {} : { from: `${addMonths(monthKey(new Date()), -back)}-01`, to: todayStr() }) };
  }, [text, period, merchant, categoryId]);
  const rows = useMemo(() => filterPurchases(all, filter, categories), [all, filter, categories]);
  const stats = useMemo(() => itemStats(rows), [rows]);
  const merchants = useMemo(() => byMerchant(filterPurchases(all, { ...filter, merchant: null }, categories)), [all, filter, categories]);
  const total = rows.reduce((s, r) => s + r.amount, 0);
  // 검색어가 한 품목으로 좁혀지면 그 품목의 가격 추이를 보여 준다
  const focus = text.trim() && stats.length > 0 && stats.filter((s) => s.key.includes(itemKey(text))).length >= 1 ? stats.find((s) => s.key.includes(itemKey(text))) : null;
  const hist = useMemo(() => (focus ? priceHistory(rows, focus.name) : null), [rows, focus]);

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: insets.bottom + 40 }} keyboardShouldPersistTaps="handled">
      <TextInput value={text} onChangeText={setText} placeholder="품목 검색 (예: 우유, 휴지)" placeholderTextColor={t.faint} accessibilityLabel="품목 검색"
        style={{ height: 48, borderRadius: R.md, paddingHorizontal: 14, fontSize: 16, color: t.text, backgroundColor: t.input }} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {PERIODS.map(([k, l]) => <Chip key={k} label={l} on={period === k} onPress={() => setPeriod(k)} />)}
        <Chip label={categoryId ? `분류: ${catById.get(categoryId)?.name}` : '분류'} on={!!categoryId} onPress={() => setCatOpen((o) => !o)} icon="pricetags-outline" />
        {merchant && <Chip label={`가맹점: ${merchant}`} on onPress={() => setMerchant(null)} />}
      </ScrollView>
      {catOpen && (
        <Card><CategoryPicker type="expense" value={categoryId} onChange={(id) => setCategoryId(id)} allowNone noneLabel="전체" /></Card>
      )}

      {all.length === 0 ? (
        <Card><Empty icon="receipt-outline" title="아직 품목이 없어요" hint={'내역 입력 화면의 "영수증 품목으로 입력"으로 직접 적거나, 비서 앱에 영수증 사진을 보여 주면 품목째 기록돼요.'} /></Card>
      ) : (
        <>
          <Card style={{ gap: 2 }}>
            <Text style={{ fontSize: 12, color: t.sub }}>조건에 맞는 구매</Text>
            <Text style={{ fontSize: 24, fontWeight: '800', color: t.text }}>{fmtWon(total)}</Text>
            <Text style={{ fontSize: 13, color: t.sub }}>{rows.length}건 · 품목 {stats.length}종</Text>
          </Card>

          {focus && hist && (
            <>
              <SectionTitle title={`「${focus.name}」 가격 추이`} />
              <Card style={{ gap: 10 }}>
                <Text style={{ color: t.text, fontWeight: '800', fontSize: 16 }}>마지막 {fmtWon(hist.last)} <Text style={{ color: t.sub, fontWeight: '500', fontSize: 13 }}>({focus.lastDate.slice(5).replace('-', '/')}{focus.lastMerchant ? ` ${focus.lastMerchant}` : ''})</Text></Text>
                <Text style={{ color: t.sub, fontSize: 13 }}>최저 {fmtWon(hist.min)} · 평균 {fmtWon(hist.avg)} · 최고 {fmtWon(hist.max)} (단가 기준)</Text>
                {hist.points.length >= 2 && <LineChart color={t.primary} points={hist.points.map((p) => ({ label: p.date.slice(2).replace(/-/g, '.'), value: p.unit }))} />}
              </Card>
            </>
          )}

          <SectionTitle title="많이 산 품목 (누적 금액)" />
          <Card style={{ gap: 10 }}>
            {stats.length === 0 ? <Empty title="조건에 맞는 품목이 없어요" /> : stats.slice(0, 15).map((s, i) => (
              <Pressable key={s.key} onPress={() => setText(s.name)} accessibilityRole="button" accessibilityLabel={`${s.name} 검색`} style={{ gap: 2 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ flex: 1, fontWeight: '700', color: t.text }}>{i + 1}. {s.name}</Text>
                  <Text style={{ fontWeight: '700', color: t.text }}>{fmtWon(s.total)}</Text>
                </View>
                <Text style={{ fontSize: 12.5, color: t.sub }}>{s.count}번 구입 · 마지막 {fmtWon(s.lastUnit)} ({s.lastDate.slice(5).replace('-', '/')}{s.lastMerchant ? ` ${s.lastMerchant}` : ''})</Text>
              </Pressable>
            ))}
          </Card>

          {merchants.length > 0 && (
            <>
              <SectionTitle title="가맹점별 구매" />
              <Card style={{ gap: 10 }}>
                {merchants.slice(0, 8).map((m) => (
                  <Pressable key={m.merchant} onPress={() => setMerchant(merchant === m.merchant ? null : m.merchant)} accessibilityRole="button" style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ fontWeight: merchant === m.merchant ? '800' : '600', color: merchant === m.merchant ? t.primary : t.text }}>{m.merchant} <Text style={{ color: t.sub }}>({m.count})</Text></Text>
                    <Text style={{ color: t.sub, fontWeight: '600' }}>{fmtWon(m.total)}</Text>
                  </Pressable>
                ))}
              </Card>
            </>
          )}

          <SectionTitle title="구매 내역" />
          <Card style={{ gap: 4 }}>
            {rows.slice(0, 80).map((r) => (
              <Pressable key={r.item_id} onPress={() => router.push(`/tx/${r.tx_id}`)} accessibilityRole="button" style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 }}>
                <Text style={{ width: 42, fontSize: 12, color: t.sub }}>{r.date.slice(5).replace('-', '/')}</Text>
                <View style={{ flex: 1 }}>
                  <Text numberOfLines={1} style={{ fontWeight: '600', color: t.text }}>{r.name}{r.qty !== 1 ? ` ×${r.qty}` : ''}</Text>
                  <Text numberOfLines={1} style={{ fontSize: 12, color: t.sub }}>{[r.merchant, r.category_id ? catById.get(r.category_id)?.name : ''].filter(Boolean).join(' · ')}</Text>
                </View>
                <Text style={{ fontWeight: '700', color: r.amount < 0 ? t.income : t.text }}>{fmtWon(r.amount)}</Text>
              </Pressable>
            ))}
            {rows.length > 80 && <Text style={{ color: t.faint, fontSize: 12, textAlign: 'center', paddingTop: 6 }}>최근 80건만 보여요. 검색·기간으로 좁혀 보세요.</Text>}
          </Card>
        </>
      )}
    </ScrollView>
  );
}
