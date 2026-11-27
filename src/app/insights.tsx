import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { WeekdayBars } from '../components/Charts';
import { catStyle } from '../components/TxRow';
import { useAliases } from '../components/useAliases';
import { Bar, Button, Card, Chip, Empty, SectionTitle } from '../components/ui';
import { computeInsights, merchantMonthly, periodRange, PERIOD_LABEL, type MerchantStat, type PeriodKind } from '../lib/insights';
import { suggestMerges } from '../lib/merchants';
import { monthKey } from '../lib/dates';
import { fmtNum, fmtWon } from '../lib/money';
import { useLedger } from '../store';
import { R, useTheme } from '../theme';

const KINDS: PeriodKind[] = ['month', 'lastMonth', '3m', 'year'];

/** 지출 인사이트: 돈이 어디로 가장 많이 나가는지 (가맹점·분류·빈도·시기·고정비) */
export default function InsightsScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { txs, categories, accounts, catById, itemsByTx } = useLedger();
  const { aliases, merge } = useAliases();
  const [kind, setKind] = useState<PeriodKind>('month');
  const [query, setQuery] = useState('');
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [openCat, setOpenCat] = useState<string | null>(null);
  const [mergeFor, setMergeFor] = useState<MerchantStat | null>(null);
  const [all, setAll] = useState(false);

  const { range, prev } = useMemo(() => periodRange(kind), [kind]);
  const ins = useMemo(() => computeInsights(txs, categories, itemsByTx, range, prev, aliases, PERIOD_LABEL[kind]), [txs, categories, itemsByTx, range, prev, aliases, kind]);
  const suggestions = useMemo(() => suggestMerges(ins.merchants.map((m) => ({ name: m.name, total: m.total })), aliases), [ins.merchants, aliases]);
  const filtered = useMemo(() => {
    const q = query.replace(/\s+/g, '').toLowerCase();
    return q ? ins.merchants.filter((m) => m.name.replace(/\s+/g, '').toLowerCase().includes(q)) : ins.merchants;
  }, [ins.merchants, query]);
  const shown = all || query ? filtered : filtered.slice(0, 10);
  const accName = (id: string) => accounts.find((a) => a.id === id)?.name ?? '?';
  const colorOf = (id: string) => catStyle(catById.get(id), catById).color;
  const max = ins.merchants[0]?.total || 1;
  const endMonth = monthKey(new Date());

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40 }} keyboardShouldPersistTaps="handled">
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 12 }}>
        {KINDS.map((k) => <Chip key={k} label={PERIOD_LABEL[k]} on={kind === k} onPress={() => setKind(k)} />)}
      </ScrollView>

      <Card style={{ gap: 6 }}>
        <Text style={{ fontSize: 13, fontWeight: '700', color: t.sub }}>{PERIOD_LABEL[kind]} 지출 ({range.from.slice(5).replace('-', '/')} ~ {range.to.slice(5).replace('-', '/')})</Text>
        <Text style={{ fontSize: 30, fontWeight: '800', color: t.expense }}>{fmtWon(ins.total)}</Text>
        <Text style={{ fontSize: 13, color: t.sub }}>
          하루 평균 {fmtWon(ins.dailyAvg)} · {ins.count}건
          {ins.changePct !== null ? <Text>{' · '}직전 대비 <Text style={{ fontWeight: '800', color: ins.changePct > 0 ? t.expense : t.ok }}>{ins.changePct > 0 ? '+' : ''}{ins.changePct.toFixed(0)}%</Text></Text> : null}
        </Text>
      </Card>

      {ins.total === 0 ? <Card style={{ marginTop: 14 }}><Empty icon="pie-chart-outline" title="이 기간에는 지출 기록이 없어요" hint="내역을 기록하거나 더보기 > 가져오기로 은행·카드 내역을 불러와 보세요" /></Card> : (
        <>
          <Card style={{ marginTop: 14, gap: 8 }}>
            {ins.lines.map((l, i) => (
              <View key={i} style={{ flexDirection: 'row', gap: 8 }}>
                <Ionicons name="bulb-outline" size={17} color={t.warn} style={{ marginTop: 2 }} />
                <Text style={{ flex: 1, color: t.text, lineHeight: 21 }}>{l}</Text>
              </View>
            ))}
          </Card>

          <SectionTitle title="어디에 쓰나 — 분류" />
          <Card style={{ gap: 12 }}>
            {ins.categories.map((c, i) => (
              <View key={c.id || 'none'} style={{ gap: 6 }}>
                <Pressable onPress={() => setOpenCat(openCat === c.id ? null : c.id)} accessibilityRole="button" accessibilityLabel={`${c.name} ${c.total}원`} style={{ gap: 6 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colorOf(c.id) }} />
                    <Text style={{ flex: 1, fontWeight: '700', color: t.text }}>{i + 1}. {c.name}</Text>
                    {c.changePct !== null && Math.abs(c.changePct) >= 5 && <Text style={{ fontSize: 12, fontWeight: '800', color: c.changePct > 0 ? t.expense : t.ok }}>{c.changePct > 0 ? '▲' : '▼'}{Math.abs(c.changePct).toFixed(0)}%</Text>}
                    <Text style={{ color: t.sub, fontWeight: '600' }}>{fmtWon(c.total)} · {c.pct.toFixed(0)}%</Text>
                  </View>
                  <Bar pct={c.pct} color={colorOf(c.id)} />
                </Pressable>
                {openCat === c.id && (
                  <View style={{ paddingLeft: 18, gap: 8 }}>
                    {c.children.map((ch) => (
                      <View key={ch.id} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                        <Text style={{ color: t.text }}>{ch.name} <Text style={{ color: t.sub }}>({ch.count}건)</Text></Text>
                        <Text style={{ color: t.sub, fontWeight: '600' }}>{fmtWon(ch.total)}</Text>
                      </View>
                    ))}
                    <Pressable onPress={() => router.push({ pathname: '/list', params: { category: c.id, month: kind === 'month' ? monthKey(new Date()) : '' } })} accessibilityRole="button">
                      <Text style={{ color: t.primary, fontWeight: '700' }}>이 분류 내역 보기 →</Text>
                    </Pressable>
                  </View>
                )}
              </View>
            ))}
          </Card>

          <SectionTitle title="어디에 쓰나 — 가맹점" right={<Text style={{ color: t.sub, fontSize: 12 }}>길게 누르면 다른 이름과 합치기</Text>} />
          <Card style={{ gap: 12 }}>
            <TextInput value={query} onChangeText={setQuery} placeholder="가맹점 검색" placeholderTextColor={t.faint} accessibilityLabel="가맹점 검색"
              style={{ height: 42, borderRadius: R.md, paddingHorizontal: 12, color: t.text, backgroundColor: t.input }} />
            {ins.merchants.length === 0 ? <Text style={{ color: t.sub }}>가맹점이 적힌 지출이 없어요. 내역을 기록할 때 가맹점을 적으면 여기서 순위를 볼 수 있어요.</Text> : shown.map((m, i) => (
              <View key={m.key} style={{ gap: 6 }}>
                <Pressable onPress={() => setOpenKey(openKey === m.key ? null : m.key)} onLongPress={() => setMergeFor(m)} delayLongPress={400} accessibilityRole="button" accessibilityLabel={`${m.name} ${m.total}원 ${m.count}회`} style={{ gap: 6 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text style={{ flex: 1, fontWeight: '700', color: t.text }} numberOfLines={1}>{i + 1}. {m.name} <Text style={{ color: t.sub, fontWeight: '500' }}>({m.count}회 · 건당 {fmtNum(m.avg)})</Text></Text>
                    {m.changePct !== null && Math.abs(m.changePct) >= 10 && <Text style={{ fontSize: 12, fontWeight: '800', color: m.changePct > 0 ? t.expense : t.ok }}>{m.changePct > 0 ? '▲' : '▼'}{Math.abs(m.changePct).toFixed(0)}%</Text>}
                    <Text style={{ color: t.sub, fontWeight: '700' }}>{fmtWon(m.total)}</Text>
                  </View>
                  <Bar pct={(m.total / max) * 100} color={t.primary} />
                </Pressable>
                {openKey === m.key && (
                  <View style={{ gap: 8, paddingLeft: 4 }}>
                    <Text style={{ fontSize: 12, color: t.sub }}>최근 6개월</Text>
                    <WeekdayBars data={merchantMonthly(txs, m.key, endMonth, 6, aliases).map((x) => ({ label: `${Number(x.month.slice(5))}월`, total: x.total }))} />
                    <View style={{ flexDirection: 'row', gap: 16 }}>
                      <Pressable onPress={() => router.push({ pathname: '/list', params: { q: m.name } })} accessibilityRole="button"><Text style={{ color: t.primary, fontWeight: '700' }}>거래 내역 →</Text></Pressable>
                      <Pressable onPress={() => setMergeFor(m)} accessibilityRole="button"><Text style={{ color: t.primary, fontWeight: '700' }}>다른 이름과 합치기</Text></Pressable>
                    </View>
                  </View>
                )}
              </View>
            ))}
            {!query && filtered.length > 10 && <Pressable onPress={() => setAll(!all)} accessibilityRole="button"><Text style={{ color: t.primary, fontWeight: '700', textAlign: 'center' }}>{all ? '접기' : `전체 ${filtered.length}곳 보기`}</Text></Pressable>}
          </Card>

          {suggestions.length > 0 && (
            <>
              <SectionTitle title="같은 가게 아닐까요?" />
              <Card style={{ gap: 12 }}>
                {suggestions.slice(0, 4).map((s) => (
                  <View key={s.a + s.b} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <Text style={{ flex: 1, color: t.text }} numberOfLines={2}>“{s.b}” 를 “{s.a}” 로 합칠까요?</Text>
                    <Button small kind="soft" title="합치기" onPress={() => void merge([s.b], s.a)} />
                  </View>
                ))}
              </Card>
            </>
          )}

          <SectionTitle title="얼마나 자주" />
          <Card style={{ gap: 14 }}>
            <View style={{ gap: 8 }}>
              <Text style={{ fontWeight: '800', color: t.text }}>가장 자주 가는 곳</Text>
              {ins.frequent.map((m) => (
                <View key={m.key} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ color: t.text }}>{m.name}</Text>
                  <Text style={{ color: t.sub, fontWeight: '600' }}>{m.count}회 · {fmtWon(m.total)}</Text>
                </View>
              ))}
            </View>
            {ins.leaks.length > 0 && (
              <View style={{ gap: 8 }}>
                <Text style={{ fontWeight: '800', color: t.text }}>소액 반복 지출 (새는 돈 후보)</Text>
                <Text style={{ fontSize: 12, color: t.sub }}>건당 1만 원 미만이 3번 이상 반복된 곳이에요</Text>
                {ins.leaks.slice(0, 5).map((l) => (
                  <View key={l.key} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ color: t.text }}>{l.name} <Text style={{ color: t.sub }}>({l.count}회 · 평균 {fmtNum(l.avg)})</Text></Text>
                    <Text style={{ color: t.expense, fontWeight: '700' }}>{fmtWon(l.total)}</Text>
                  </View>
                ))}
              </View>
            )}
            {ins.subscriptions.length > 0 && (
              <View style={{ gap: 8 }}>
                <Text style={{ fontWeight: '800', color: t.text }}>정기 결제로 보이는 곳 (월 {fmtWon(ins.subscriptions.reduce((s, x) => s + x.amount, 0))})</Text>
                {ins.subscriptions.map((s) => (
                  <View key={s.key} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ color: t.text }}>{s.name} <Text style={{ color: t.sub }}>({s.months}개월째 · 다음 {s.nextDate.slice(5).replace('-', '/')})</Text></Text>
                    <Text style={{ color: t.sub, fontWeight: '700' }}>{fmtWon(s.amount)}</Text>
                  </View>
                ))}
              </View>
            )}
          </Card>

          <SectionTitle title="언제 쓰나" />
          <Card style={{ gap: 14 }}>
            <Text style={{ fontWeight: '800', color: t.text }}>요일별</Text>
            <WeekdayBars data={ins.weekday.map((w) => ({ label: w.label, total: w.total }))} />
            <Text style={{ fontWeight: '800', color: t.text }}>시간대별 <Text style={{ color: t.sub, fontWeight: '500', fontSize: 12 }}>(시각을 적은 거래만)</Text></Text>
            {ins.hour.some((h) => h.count > 0) ? <WeekdayBars data={ins.hour.map((h) => ({ label: h.label, total: h.total }))} /> : <Text style={{ color: t.sub, fontSize: 13 }}>시각이 적힌 지출이 없어요 (가져오기·문자 붙여넣기로 들어온 거래에는 시각이 들어가요)</Text>}
            <Text style={{ fontWeight: '800', color: t.text }}>월 초·중·말</Text>
            {ins.monthPart.map((p) => (
              <View key={p.label} style={{ gap: 4 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Text style={{ color: t.text }}>{p.label}</Text><Text style={{ color: t.sub, fontWeight: '600' }}>{fmtWon(p.total)}</Text></View>
                <Bar pct={ins.total ? (p.total / ins.total) * 100 : 0} color={t.income} height={6} />
              </View>
            ))}
          </Card>

          <SectionTitle title="고정비 vs 변동비" />
          <Card style={{ gap: 10 }}>
            <View style={{ flexDirection: 'row', height: 14, borderRadius: 7, overflow: 'hidden', backgroundColor: t.input }}>
              <View style={{ flex: Math.max(ins.fixed.fixed, 0.0001), backgroundColor: t.warn }} />
              <View style={{ flex: Math.max(ins.fixed.variable, 0.0001), backgroundColor: t.primary }} />
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ color: t.text }}><Text style={{ color: t.warn }}>■</Text> 고정비 {fmtWon(ins.fixed.fixed)} ({ins.fixed.fixedPct.toFixed(0)}%)</Text>
              <Text style={{ color: t.text }}><Text style={{ color: t.primary }}>■</Text> 변동비 {fmtWon(ins.fixed.variable)}</Text>
            </View>
            <Text style={{ fontSize: 12, color: t.sub }}>고정 거래로 기록되는 지출과 정기 결제로 보이는 가맹점을 고정비로 봐요</Text>
          </Card>

          <SectionTitle title="가장 큰 지출 TOP 5" />
          <Card style={{ gap: 10 }}>
            {ins.biggest.map((b) => (
              <Pressable key={b.id} onPress={() => router.push(`/tx/${b.id}` as never)} accessibilityRole="button" style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ color: t.text, flex: 1 }} numberOfLines={1}>{b.merchant || catById.get(b.category_id ?? '')?.name || '미분류'} <Text style={{ color: t.sub }}>{b.date.slice(5).replace('-', '/')}</Text></Text>
                <Text style={{ color: t.expense, fontWeight: '800' }}>{fmtWon(b.amount)}</Text>
              </Pressable>
            ))}
          </Card>

          {ins.accounts.length > 1 && (
            <>
              <SectionTitle title="통장별 지출" />
              <Card style={{ gap: 10 }}>
                {ins.accounts.map((a) => (
                  <View key={a.account_id} style={{ gap: 4 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Text style={{ color: t.text, fontWeight: '600' }}>{accName(a.account_id)}</Text><Text style={{ color: t.sub, fontWeight: '600' }}>{fmtWon(a.total)} · {a.pct.toFixed(0)}%</Text></View>
                    <Bar pct={a.pct} color={t.primary} height={6} />
                  </View>
                ))}
              </Card>
            </>
          )}
        </>
      )}

      <MergeModal target={mergeFor} others={ins.merchants} onClose={() => setMergeFor(null)} onPick={(from, into) => { setMergeFor(null); void merge([from.name], into.name); }} />
      <Text style={{ textAlign: 'center', color: t.faint, fontSize: 11.5, marginTop: 18 }}>이 화면의 해설은 기록된 숫자로 만든 문구예요 (AI 호출 없음)</Text>
    </ScrollView>
  );
}

/** 가맹점 하나를 다른 가맹점 이름으로 합치는 선택창 */
function MergeModal({ target, others, onClose, onPick }: { target: MerchantStat | null; others: MerchantStat[]; onClose: () => void; onPick: (from: MerchantStat, into: MerchantStat) => void }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [q, setQ] = useState('');
  const list = useMemo(() => others.filter((o) => o.key !== target?.key && (!q || o.name.toLowerCase().includes(q.toLowerCase()))).slice(0, 30), [others, target, q]);
  return (
    <Modal visible={!!target} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' }} onPress={onClose} accessibilityLabel="닫기" />
      <View style={{ backgroundColor: t.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, paddingBottom: insets.bottom + 16, maxHeight: '70%' }}>
        <Text style={{ fontSize: 16, fontWeight: '800', color: t.text, marginBottom: 4 }}>“{target?.name}” 를 어느 이름으로 합칠까요?</Text>
        <Text style={{ fontSize: 12.5, color: t.sub, marginBottom: 10 }}>고른 이름으로 순위와 통계가 합쳐져요. 거래 기록 자체는 바뀌지 않아요.</Text>
        <TextInput value={q} onChangeText={setQ} placeholder="이름 검색" placeholderTextColor={t.faint} style={{ height: 42, borderRadius: R.md, paddingHorizontal: 12, color: t.text, backgroundColor: t.input, marginBottom: 8 }} />
        <ScrollView keyboardShouldPersistTaps="handled">
          {list.map((o) => (
            <Pressable key={o.key} onPress={() => target && onPick(target, o)} accessibilityRole="button" accessibilityLabel={`${o.name} 으로 합치기`} style={{ paddingVertical: 12, flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ color: t.text, fontWeight: '600' }}>{o.name}</Text>
              <Text style={{ color: t.sub }}>{fmtWon(o.total)}</Text>
            </Pressable>
          ))}
          {list.length === 0 && <Text style={{ color: t.sub, paddingVertical: 12 }}>합칠 수 있는 이름이 없어요</Text>}
        </ScrollView>
      </View>
    </Modal>
  );
}
