import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, SectionList, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MonthNav } from '../../components/MonthNav';
import { TxRow } from '../../components/TxRow';
import { Chip, Empty } from '../../components/ui';
import { fmtDateLabel, isMonth, monthCells, monthKey, monthRange, WEEKDAYS } from '../../lib/dates';
import { filterTxs, groupByDate, type TxFilter } from '../../lib/filter';
import { fmtShort, fmtWon } from '../../lib/money';
import { dailyExpense } from '../../lib/stats';
import { TYPE_LABEL, type TxType } from '../../lib/types';
import { useLedger } from '../../store';
import { R, useTheme } from '../../theme';

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default function ListScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { ready, txs, accounts, categories, catById } = useLedger();
  const p = useLocalSearchParams<{ month?: string; category?: string; account?: string; q?: string }>();
  const [month, setMonth] = useState(monthKey(new Date()));
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [type, setType] = useState<TxType | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [allTime, setAllTime] = useState(false);
  const [view, setView] = useState<'list' | 'calendar'>('list');
  const [selDay, setSelDay] = useState<string | null>(null);

  // 딥링크/다른 화면에서 넘어온 값 반영: /list?month=YYYY-MM&category=<id>&account=<id>&q=…
  useEffect(() => {
    const m = one(p.month);
    if (isMonth(m)) { setMonth(m); setAllTime(false); }
    const c = one(p.category);
    setCategoryId(c ? c : null);
    const a = one(p.account);
    setAccountId(a ? a : null);
    if (a) setAllTime(true);
    const q = one(p.q);
    if (q) { setQuery(q); setSearching(true); setAllTime(true); }
  }, [p.month, p.category, p.account, p.q]);

  const filter: TxFilter = useMemo(() => {
    const f: TxFilter = { query, type, accountId, categoryId };
    // 검색 중이거나 '전체 기간'이면 기간 제한 없음
    if (!allTime && !query.trim()) { const r = monthRange(month); f.from = r.from; f.to = r.to; }
    return f;
  }, [query, type, accountId, categoryId, month, allTime]);
  const rows = useMemo(() => filterTxs(txs, filter, categories), [txs, filter, categories]);
  const calendar = view === 'calendar' && !allTime && !query.trim();
  const shownRows = useMemo(() => (calendar && selDay ? rows.filter((x) => x.date === selDay) : rows), [rows, calendar, selDay]);
  const sections = useMemo(() => groupByDate(shownRows).map((g) => ({ ...g, data: g.items })), [shownRows]);
  const daily = useMemo(() => dailyExpense(rows, month), [rows, month]);
  const dailyIncome = useMemo(() => { const m = new Set<string>(); for (const x of rows) if (x.type === 'income') m.add(x.date); return m; }, [rows]);
  const cells = useMemo(() => monthCells(month), [month]);
  const income = rows.filter((x) => x.type === 'income').reduce((s, x) => s + x.amount, 0);
  const expense = rows.filter((x) => x.type === 'expense').reduce((s, x) => s + x.amount, 0);
  const filtered = !!(type || accountId || categoryId || query.trim());
  const catLabel = categoryId ? catById.get(categoryId)?.name ?? '카테고리' : null;
  const clear = () => { setType(null); setAccountId(null); setCategoryId(null); setQuery(''); setAllTime(false); router.setParams({ category: '', account: '', q: '' }); };

  return (
    <View style={{ flex: 1, paddingTop: insets.top + 8 }}>
      <View style={{ paddingHorizontal: 16, gap: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ flex: 1 }}>
            {allTime || query.trim() ? <Text style={{ fontSize: 20, fontWeight: '800', color: t.text, textAlign: 'center' }}>전체 기간</Text> : <MonthNav month={month} onChange={setMonth} />}
          </View>
          <Pressable onPress={() => { setSearching((s) => !s); if (searching) setQuery(''); }} hitSlop={8} accessibilityRole="button" accessibilityLabel="검색" style={{ padding: 8 }}>
            <Ionicons name={searching ? 'close' : 'search'} size={22} color={t.text} />
          </Pressable>
        </View>
        {searching && (
          <TextInput value={query} onChangeText={setQuery} placeholder="가맹점, 메모, 태그, 카테고리, 금액 검색" placeholderTextColor={t.faint} autoFocus accessibilityLabel="검색"
            style={{ height: 46, borderRadius: R.md, paddingHorizontal: 14, fontSize: 16, color: t.text, backgroundColor: t.input }} />
        )}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {(['expense', 'income', 'transfer'] as TxType[]).map((k) => <Chip key={k} label={TYPE_LABEL[k]} on={type === k} onPress={() => setType(type === k ? null : k)} />)}
          {accounts.filter((a) => !a.archived).map((a) => <Chip key={a.id} label={a.name} on={accountId === a.id} onPress={() => setAccountId(accountId === a.id ? null : a.id)} />)}
          {catLabel && <Chip label={`분류: ${catLabel}`} on onPress={() => setCategoryId(null)} />}
          <Chip label={calendar ? '목록 보기' : '달력 보기'} icon={calendar ? 'list' : 'calendar'} on={calendar} onPress={() => { setView(calendar ? 'list' : 'calendar'); setSelDay(null); }} />
          <Chip label="전체 기간" on={allTime} onPress={() => setAllTime(!allTime)} />
          {filtered && <Chip label="초기화" onPress={clear} icon="refresh" />}
        </ScrollView>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 4 }}>
          <Text style={{ color: t.sub, fontSize: 13 }}>{rows.length}건</Text>
          <Text style={{ fontSize: 13, fontWeight: '700' }}>
            <Text style={{ color: t.income }}>+{fmtWon(income)}</Text>  <Text style={{ color: t.expense }}>-{fmtWon(expense)}</Text>
          </Text>
        </View>
      </View>
      <SectionList
        sections={sections}
        keyExtractor={(x) => x.id}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 140 }}
        ListHeaderComponent={calendar ? (
          <View style={{ marginTop: 10, backgroundColor: t.card, borderRadius: R.lg, padding: 8 }}>
            <View style={{ flexDirection: 'row' }}>
              {WEEKDAYS.map((w, i) => <Text key={w} style={{ flex: 1, textAlign: 'center', fontSize: 12, fontWeight: '600', color: i === 0 ? t.expense : i === 6 ? t.income : t.sub, paddingBottom: 4 }}>{w}</Text>)}
            </View>
            {Array.from({ length: cells.length / 7 }, (_, w) => (
              <View key={w} style={{ flexDirection: 'row' }}>
                {cells.slice(w * 7, w * 7 + 7).map((d, i) => {
                  const sum = d ? daily.get(d) ?? 0 : 0;
                  const on = d !== null && d === selDay;
                  return (
                    <Pressable key={i} disabled={!d} onPress={() => d && setSelDay(on ? null : d)} accessibilityRole="button" accessibilityLabel={d ? `${Number(d.slice(8))}일 지출 ${sum}원` : undefined}
                      style={{ flex: 1, height: 58, alignItems: 'center', paddingTop: 4, borderRadius: 10, backgroundColor: on ? t.primarySoft : 'transparent' }}>
                      {d && (
                        <>
                          <Text style={{ fontSize: 13, fontWeight: on ? '800' : '500', color: t.text }}>{Number(d.slice(8))}</Text>
                          {sum > 0 && <Text style={{ fontSize: 10, fontWeight: '700', color: t.expense }}>{fmtShort(sum)}</Text>}
                          {dailyIncome.has(d) && <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: t.income, marginTop: 2 }} />}
                        </>
                      )}
                    </Pressable>
                  );
                })}
              </View>
            ))}
            <Text style={{ fontSize: 11, color: t.faint, padding: 6 }}>{selDay ? `${selDay.slice(5).replace('-', '/')} 내역만 보는 중 · 같은 날을 다시 누르면 전체` : '날짜를 누르면 그날 내역만 보여요 · 빨강=지출 합계, 파랑 점=수입'}</Text>
          </View>
        ) : undefined}
        ListEmptyComponent={ready ? <Empty title={filtered ? '조건에 맞는 내역이 없어요' : '이 달에는 기록이 없어요'} hint={filtered ? '필터를 바꾸거나 초기화해 보세요.' : '+ 버튼으로 추가해 보세요.'} /> : undefined}
        renderSectionHeader={({ section }) => (
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 14, marginBottom: 2, paddingHorizontal: 4 }}>
            <Text style={{ fontSize: 13, fontWeight: '700', color: t.sub }}>{fmtDateLabel(section.date)}</Text>
            <Text style={{ fontSize: 13, fontWeight: '700', color: section.net < 0 ? t.sub : t.income }}>{section.net ? `${section.net > 0 ? '+' : '-'}${fmtWon(Math.abs(section.net))}` : ''}</Text>
          </View>
        )}
        renderItem={({ item, index, section }) => (
          <View style={{ backgroundColor: t.card, paddingHorizontal: 14, borderTopLeftRadius: index === 0 ? R.lg : 0, borderTopRightRadius: index === 0 ? R.lg : 0,
            borderBottomLeftRadius: index === section.data.length - 1 ? R.lg : 0, borderBottomRightRadius: index === section.data.length - 1 ? R.lg : 0 }}>
            <TxRow t={item} onPress={() => router.push(`/tx/${item.id}`)} onLongPress={() => router.push({ pathname: '/add', params: { copy: item.id } })} />
          </View>
        )}
      />
    </View>
  );
}
