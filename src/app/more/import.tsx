import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CategoryPicker } from '../../components/CategoryPicker';
import { Button, Card, Chip, Empty, SectionTitle } from '../../components/ui';
import { getDb } from '../../db';
import { loadBatches, loadLearned, saveImport, undoImport } from '../../db/insightsRepo';
import { describeMapping, guessMapping, type Field, type Mapping } from '../../lib/import/columns';
import { parseDelimited } from '../../lib/import/delimited';
import { buildPlan, categoryLabel, learnableChoices, summarizePlan, toImportRows, type PlanRow } from '../../lib/import/plan';
import { rowsToDrafts, type Draft, type DraftType, type RowIssue } from '../../lib/import/rows';
import { parseSms } from '../../lib/import/sms';
import { fmtNum, fmtWon } from '../../lib/money';
import { useLedger } from '../../store';
import { R, useTheme } from '../../theme';

type Step = 'source' | 'map' | 'preview';
type Source = 'csv' | 'sms';
type Filter = 'all' | 'on' | 'off' | 'dup' | 'transfer';

const FIELD_LABEL: Record<Field, string> = { date: '날짜', time: '시간', desc: '가맹점/적요', memo: '메모', withdraw: '출금(지출)', deposit: '입금(수입)', amount: '금액(한 칸)', balance: '잔액', kind: '구분(승인/취소…)' };
const FIELDS: Field[] = ['date', 'time', 'desc', 'withdraw', 'deposit', 'amount', 'kind', 'memo', 'balance'];

/** 은행·카드 거래내역(CSV)이나 승인·입출금 문자를 가져와 한 번에 기록한다 (AI 호출 없음) */
export default function ImportScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { accounts, categories, txs, refresh, showNotice } = useLedger();
  const active = accounts.filter((a) => !a.archived);
  const [step, setStep] = useState<Step>('source');
  const [source, setSource] = useState<Source>('csv');
  const [accountId] = useState<string>(() => (active.find((a) => a.is_default) ?? active[0])?.id ?? '');
  const [pasted, setPasted] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [table, setTable] = useState<string[][]>([]);
  const [headerRow, setHeaderRow] = useState(-1);
  const [mapping, setMapping] = useState<Mapping>({});
  const [positiveIs, setPositiveIs] = useState<DraftType | undefined>(undefined);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [issues, setIssues] = useState<RowIssue[]>([]);
  const [rows, setRows] = useState<PlanRow[]>([]);
  const [original, setOriginal] = useState<PlanRow[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [pickFor, setPickFor] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [batches, setBatches] = useState<{ id: string; created_at: string; source: string; label: string | null; count: number }[]>([]);

  const loadRecent = useCallback(() => { getDb().then(loadBatches).then(setBatches).catch(() => {}); }, []);
  useEffect(loadRecent, [loadRecent]);

  const startPlan = useCallback(async (ds: Draft[], is: RowIssue[]) => {
    let learned: Map<string, string> | undefined;
    try { learned = await loadLearned(await getDb()); } catch { learned = undefined; }
    const plan = buildPlan(ds, { accountId, categories, existing: txs, learned });
    setDrafts(ds); setIssues(is); setRows(plan); setOriginal(plan); setFilter('all'); setStep('preview');
  }, [accountId, categories, txs]);

  const pickFile = async () => {
    try {
      const r = await DocumentPicker.getDocumentAsync({ type: ['text/csv', 'text/comma-separated-values', 'text/tab-separated-values', 'text/plain', '*/*'], copyToCacheDirectory: true });
      if (r.canceled || !r.assets[0]) return;
      const a = r.assets[0];
      const text = await new File(a.uri).text();
      if (/�/.test(text.slice(0, 2000))) {
        Alert.alert('글자가 깨져 보여요', '파일이 EUC-KR(엑셀 기본 CSV) 로 저장된 것 같아요. 엑셀에서 「CSV UTF-8(쉼표로 분리)」로 다시 저장하거나, 내용을 복사해서 아래 붙여넣기에 넣어 주세요.');
        return;
      }
      loadText(text, a.name);
    } catch (e) {
      Alert.alert('파일을 읽지 못했어요', e instanceof Error ? e.message : String(e));
    }
  };

  const loadText = (text: string, name: string | null) => {
    const parsed = parseDelimited(text);
    if (parsed.length < 2) { Alert.alert('읽을 내용이 없어요', '거래 내역이 담긴 표(CSV/탭 구분)를 넣어 주세요.'); return; }
    const g = guessMapping(parsed);
    setSource('csv'); setFileName(name); setTable(parsed); setHeaderRow(g.headerRow); setMapping(g.mapping); setPositiveIs(undefined); setStep('map');
  };

  const readSms = async () => {
    const r = parseSms(pasted);
    if (r.drafts.length === 0) { Alert.alert('거래를 찾지 못했어요', r.issues[0]?.reason ?? '카드 승인·입출금 문자를 붙여넣어 주세요.'); return; }
    setSource('sms'); setFileName(null);
    await startPlan(r.drafts, r.issues);
  };

  const dataRows = useMemo(() => table.slice(headerRow + 1), [table, headerRow]);
  const canNext = mapping.date !== undefined && (mapping.withdraw !== undefined || mapping.deposit !== undefined || mapping.amount !== undefined);
  const toPreview = async () => {
    const { drafts: ds, issues: is } = rowsToDrafts(dataRows, mapping, { positiveIs });
    if (ds.length === 0) { Alert.alert('읽을 수 있는 거래가 없어요', is[0] ? `${is[0].line}번째 줄: ${is[0].reason}` : '열 지정을 확인해 주세요.'); return; }
    await startPlan(ds, is);
  };

  const summary = useMemo(() => summarizePlan(rows), [rows]);
  const shown = useMemo(() => rows.filter((r) => filter === 'all' || (filter === 'on' && r.action === 'import') || (filter === 'off' && r.action === 'skip') || (filter === 'dup' && r.duplicate) || (filter === 'transfer' && !!r.transfer)), [rows, filter]);
  const setRow = (idx: number, p: Partial<PlanRow>) => setRows((l) => l.map((r) => (r.idx === idx ? { ...r, ...p } : r)));
  const setAll = (on: boolean) => setRows((l) => l.map((r) => ({ ...r, action: on && !r.duplicate ? 'import' : 'skip' })));

  const save = async () => {
    if (busy || summary.selected === 0) return;
    setBusy(true);
    try {
      const db = await getDb();
      const acc = accounts.find((a) => a.id === accountId);
      const res = await saveImport(db, {
        source, label: fileName ?? (source === 'sms' ? '문자 붙여넣기' : null), account_id: accountId,
        rows: toImportRows(rows, accountId), learn: learnableChoices(rows, original),
      });
      await refresh();
      loadRecent();
      setStep('source'); setPasted(''); setTable([]); setRows([]); setDrafts([]);
      showNotice({
        text: res.saved === 0 ? '이미 가져온 내역이라 새로 저장된 게 없어요' : `${acc?.name ?? ''}에 ${res.saved}건 가져왔어요${res.skipped ? ` (중복 ${res.skipped}건 제외)` : ''}`,
        action: res.saved > 0 ? { label: '되돌리기', run: async () => { await undoImport(await getDb(), res.batchId); await refresh(); loadRecent(); } } : undefined,
      });
    } catch (e) {
      Alert.alert('가져오기 실패', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const undo = (id: string, n: number) => Alert.alert('가져오기를 되돌릴까요?', `이 묶음으로 저장된 ${n}건이 삭제돼요.`, [
    { text: '취소', style: 'cancel' },
    { text: '되돌리기', style: 'destructive', onPress: async () => { await undoImport(await getDb(), id); await refresh(); loadRecent(); } },
  ]);

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40 }} keyboardShouldPersistTaps="handled">
      {step === 'source' && (
        <>
          <Card style={{ gap: 10 }}>
            <Text style={{ fontWeight: '800', color: t.text }}>은행·카드 내역 가져오기</Text>
            <Text style={{ fontSize: 12.5, color: t.sub, lineHeight: 18 }}>은행·카드 앱은 직접 연동할 수 없어서(오픈뱅킹은 사업자 등록이 필요해요), 앱이 내보내는 거래내역을 가져오는 방식으로 대신해요. 카드 내역은 카드 통장을 선택하세요.</Text>
          </Card>

          <SectionTitle title="1. 거래내역 파일 (CSV)" />
          <Card style={{ gap: 10 }}>
            <Button title="파일 선택" icon="document-text-outline" onPress={() => void pickFile()} />
            <Text style={{ fontSize: 12.5, color: t.sub, lineHeight: 18 }}>은행·카드 앱 또는 인터넷뱅킹에서 거래내역을 엑셀/CSV로 내려받아 선택하세요. 엑셀이면 「CSV UTF-8(쉼표로 분리)」로 저장하면 한글이 깨지지 않아요. 열 이름(거래일자, 적요, 출금, 입금, 이용금액…)은 자동으로 알아봐요. 이미 기록한 내역은 자동으로 중복 제외돼요.</Text>
          </Card>

          <SectionTitle title="2. 문자·알림 붙여넣기" />
          <Card style={{ gap: 10 }}>
            <TextInput value={pasted} onChangeText={setPasted} multiline placeholder={'[Web발신]\n신한카드(1234)승인 홍*동 12,300원(일시불) 11/27 12:34 스타벅스'} placeholderTextColor={t.faint}
              accessibilityLabel="문자 붙여넣기" style={{ minHeight: 110, borderRadius: R.md, padding: 12, color: t.text, backgroundColor: t.input, textAlignVertical: 'top' }} />
            <Button title="문자 읽기" kind="soft" icon="chatbubble-ellipses-outline" disabled={!pasted.trim()} onPress={() => void readSms()} />
            <Text style={{ fontSize: 12.5, color: t.sub, lineHeight: 18 }}>카드 승인·취소, 계좌 입금·출금 문자를 여러 건 한꺼번에 붙여넣을 수 있어요. 읽지 못한 문자는 알려 드려요.{'\n'}비서 앱에 문자나 거래내역 사진을 보내 「기록해줘」라고 해도 돼요 (그쪽은 비서가 해석해요).</Text>
          </Card>

          {batches.length > 0 && (
            <>
              <SectionTitle title="최근 가져오기" />
              <Card style={{ gap: 10 }}>
                {batches.slice(0, 5).map((b) => (
                  <View key={b.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: t.text, fontWeight: '600' }}>{b.label ?? (b.source === 'sms' ? '문자 붙여넣기' : 'CSV')} · {b.count}건</Text>
                      <Text style={{ color: t.sub, fontSize: 12 }}>{b.created_at.slice(0, 16).replace('T', ' ')}</Text>
                    </View>
                    <Button small kind="danger" title="되돌리기" onPress={() => undo(b.id, b.count)} />
                  </View>
                ))}
              </Card>
            </>
          )}
        </>
      )}

      {step === 'map' && (
        <>
          <Card style={{ gap: 6 }}>
            <Text style={{ fontWeight: '800', color: t.text }}>{fileName ?? '붙여넣은 표'} · {dataRows.length}줄</Text>
            <Text style={{ fontSize: 13, color: t.sub }}>{describeMapping(mapping)}으로 보여요. 열이 맞는지 확인하세요.</Text>
          </Card>
          <SectionTitle title="열 지정" />
          <Card style={{ gap: 14 }}>
            {FIELDS.map((f) => (
              <View key={f} style={{ gap: 6 }}>
                <Text style={{ fontWeight: '700', color: t.text }}>{FIELD_LABEL[f]}</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                  <Chip label="없음" on={mapping[f] === undefined} onPress={() => setMapping((m) => { const n = { ...m }; delete n[f]; return n; })} />
                  {(table[headerRow >= 0 ? headerRow : 0] ?? []).map((h, i) => (
                    <Chip key={i} label={`${i + 1}. ${h && headerRow >= 0 ? h : dataRows[0]?.[i]?.slice(0, 8) ?? ''}`} on={mapping[f] === i} onPress={() => setMapping((m) => ({ ...m, [f]: i }))} />
                  ))}
                </ScrollView>
              </View>
            ))}
            {mapping.amount !== undefined && mapping.withdraw === undefined && mapping.deposit === undefined && (
              <View style={{ gap: 6 }}>
                <Text style={{ fontWeight: '700', color: t.text }}>부호 없는 양수 금액은</Text>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <Chip label="지출(기본)" on={positiveIs !== 'income'} onPress={() => setPositiveIs('expense')} />
                  <Chip label="수입" on={positiveIs === 'income'} onPress={() => setPositiveIs('income')} />
                </View>
              </View>
            )}
          </Card>
          <SectionTitle title="미리보기 (앞 5줄)" />
          <Card style={{ gap: 8 }}>
            {dataRows.slice(0, 5).map((r, i) => <Text key={i} style={{ fontSize: 12.5, color: t.sub }} numberOfLines={2}>{r.join('  |  ')}</Text>)}
          </Card>
          <View style={{ marginTop: 16, gap: 8 }}>
            <Button title="다음: 정리하고 확인" disabled={!canNext} onPress={() => void toPreview()} />
            {!canNext && <Text style={{ color: t.warn, fontSize: 12.5, textAlign: 'center' }}>날짜 열과 금액(출금/입금 또는 금액) 열을 지정해 주세요</Text>}
            <Button title="처음으로" kind="soft" onPress={() => setStep('source')} />
          </View>
        </>
      )}

      {step === 'preview' && (
        <>
          <Card style={{ gap: 6 }}>
            <Text style={{ fontWeight: '800', color: t.text, fontSize: 16 }}>{summary.selected}건 가져오기 · {accounts.find((a) => a.id === accountId)?.name}</Text>
            <Text style={{ color: t.sub, fontSize: 13 }}>
              지출 {fmtWon(summary.expense)} ({summary.expenseCount}건) · 수입 {fmtWon(summary.income)} ({summary.incomeCount}건)
            </Text>
            <Text style={{ color: t.sub, fontSize: 12.5 }}>
              제외: 중복 {summary.skippedDuplicate}건 · 내부 이동 후보 {summary.skippedTransfer}건 · 기타 {summary.skippedOther}건
              {issues.length > 0 ? ` · 읽지 못한 줄 ${issues.length}건` : ''}
            </Text>
          </Card>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
            {([['all', '전체'], ['on', '가져옴'], ['off', '제외'], ['dup', '중복'], ['transfer', '내부 이동']] as [Filter, string][]).map(([f, l]) => <Chip key={f} label={l} on={filter === f} onPress={() => setFilter(f)} />)}
            <Chip label="모두 선택" onPress={() => setAll(true)} />
            <Chip label="모두 해제" onPress={() => setAll(false)} />
          </View>
          <Card style={{ marginTop: 12, gap: 4 }}>
            {shown.length === 0 && <Empty title="해당하는 줄이 없어요" />}
            {shown.map((r) => (
              <View key={r.idx} style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: t.line, gap: 6, opacity: r.action === 'skip' ? 0.6 : 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Switch value={r.action === 'import'} onValueChange={(v) => setRow(r.idx, { action: v ? 'import' : 'skip' })} accessibilityLabel={`${r.draft.description || '내역'} 가져오기`} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: t.text, fontWeight: '700' }} numberOfLines={1}>{r.draft.description || '(적요 없음)'}</Text>
                    <Text style={{ color: t.sub, fontSize: 12 }}>{r.draft.date.slice(5).replace('-', '/')}{r.draft.time ? ` ${r.draft.time}` : ''}{r.draft.refund ? ' · 환불' : ''}</Text>
                  </View>
                  <Text style={{ color: r.draft.type === 'income' ? t.income : t.text, fontWeight: '800' }}>{r.draft.type === 'income' ? '+' : '-'}{fmtNum(r.draft.amount)}원</Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', paddingLeft: 54 }}>
                  <Pressable onPress={() => setPickFor(r.idx)} accessibilityRole="button" accessibilityLabel="분류 바꾸기"
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: t.input, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4 }}>
                    <Ionicons name="pricetag-outline" size={13} color={t.sub} />
                    <Text style={{ fontSize: 12.5, color: t.text }}>{categoryLabel(r.category_id, categories)}{r.categorySource === 'learned' ? ' · 학습' : ''}</Text>
                  </Pressable>
                  {r.duplicate && <Text style={{ fontSize: 12, color: t.warn }}>이미 있는 내역</Text>}
                  {r.transferLabel && <Text style={{ fontSize: 12, color: t.warn }}>{r.transferLabel}</Text>}
                </View>
              </View>
            ))}
          </Card>
          {issues.length > 0 && (
            <>
              <SectionTitle title={`읽지 못한 줄 ${issues.length}건`} />
              <Card style={{ gap: 8 }}>
                {issues.slice(0, 6).map((i) => <Text key={i.line} style={{ fontSize: 12.5, color: t.sub }} numberOfLines={2}>{i.line}번째: {i.reason} — {i.raw.slice(0, 60)}</Text>)}
              </Card>
            </>
          )}
          <View style={{ marginTop: 16, gap: 8 }}>
            <Button title={busy ? '저장 중…' : `${summary.selected}건 가져오기`} icon="download-outline" disabled={busy || summary.selected === 0} onPress={() => void save()} />
            <Button title={source === 'csv' ? '열 지정으로 돌아가기' : '처음으로'} kind="soft" onPress={() => setStep(source === 'csv' ? 'map' : 'source')} />
            <Text style={{ fontSize: 12, color: t.faint, textAlign: 'center' }}>분류를 바꾸면 같은 가맹점은 다음 가져오기에서도 그 분류로 정해져요 · 저장 직후 되돌릴 수 있어요 ({drafts.length}줄 중)</Text>
          </View>
        </>
      )}

      <Modal visible={pickFor !== null} transparent animationType="slide" onRequestClose={() => setPickFor(null)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' }} onPress={() => setPickFor(null)} accessibilityLabel="닫기" />
        <View style={{ backgroundColor: t.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, paddingBottom: insets.bottom + 16, maxHeight: '75%' }}>
          <Text style={{ fontSize: 16, fontWeight: '800', color: t.text, marginBottom: 10 }}>분류 선택</Text>
          <ScrollView>
            {pickFor !== null && rows[pickFor] && (
              <CategoryPicker type={rows[pickFor].draft.type} value={rows[pickFor].category_id} onChange={(id) => { setRow(pickFor, { category_id: id, categorySource: null }); if (id) setPickFor(null); }} allowNone noneLabel="미분류" />
            )}
          </ScrollView>
        </View>
      </Modal>
    </ScrollView>
  );
}
