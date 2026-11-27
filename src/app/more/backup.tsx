import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import React, { useState } from 'react';
import { Alert, ScrollView, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { restoreAll, wipeAll } from '../../db/repo';
import { Button, Card, SectionTitle } from '../../components/ui';
import { makeBackup, parseBackup } from '../../lib/backup';
import { itemsToCsv, toCsv } from '../../lib/csv';
import { ymd } from '../../lib/dates';
import { useLedger } from '../../store';
import { useTheme } from '../../theme';

async function shareText(name: string, text: string, mime: string) {
  const f = new File(Paths.cache, name);
  f.create({ overwrite: true });
  f.write(text);
  if (!(await Sharing.isAvailableAsync())) throw new Error('이 기기에서는 공유할 수 없어요');
  await Sharing.shareAsync(f.uri, { mimeType: mime, dialogTitle: name });
}

export default function BackupScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { accounts, categories, txs, budgets, recurring, rules, templates, goals, items, mutate } = useLedger();
  const [busy, setBusy] = useState(false);
  const today = ymd(new Date());
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); } catch (e) { Alert.alert('실패했어요', e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };

  const exportJson = () => run(() => shareText(`flowledger-backup-${today}.json`,
    makeBackup({ accounts, categories, transactions: txs, budgets, recurring, rules, templates, goals, items }), 'application/json'));
  const exportItemsCsv = () => run(() => shareText(`flowledger-items-${today}.csv`, itemsToCsv(txs, items, categories), 'text/csv'));
  const exportCsv = () => run(() => shareText(`flowledger-${today}.csv`, toCsv(txs, accounts, categories), 'text/csv'));

  const restore = () => run(async () => {
    const r = await DocumentPicker.getDocumentAsync({ type: ['application/json', 'text/plain', '*/*'], copyToCacheDirectory: true });
    if (r.canceled || !r.assets?.[0]) return;
    const text = await new File(r.assets[0].uri).text();
    const parsed = parseBackup(text);
    if (!parsed.ok) { Alert.alert('복원할 수 없는 파일이에요', parsed.errors.join('\n')); return; }
    const d = parsed.data;
    Alert.alert('이 백업으로 복원할까요?',
      `통장 ${d.accounts.length} · 내역 ${d.transactions.length} · 예산 ${d.budgets.length} · 고정거래 ${d.recurring.length}\n\n지금 기기의 모든 데이터가 이 백업으로 교체돼요. (실패하면 전부 되돌려져요)`,
      [{ text: '취소', style: 'cancel' }, { text: '복원', style: 'destructive', onPress: () => run(async () => { await mutate((db) => restoreAll(db, d)); Alert.alert('복원했어요'); }) }]);
  });

  const wipe = () =>
    Alert.alert('모든 내역을 지울까요?', '내역·예산·고정 거래·자동 지정 규칙이 삭제돼요. 통장과 카테고리는 남아요. 되돌릴 수 없으니 먼저 백업해 두세요.', [
      { text: '취소', style: 'cancel' },
      { text: '지우기', style: 'destructive', onPress: () => run(async () => { await mutate((db) => wipeAll(db)); }) },
    ]);

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: insets.bottom + 40 }}>
      <Card style={{ gap: 10 }}>
        <Text style={{ fontWeight: '800', fontSize: 16, color: t.text }}>백업 (JSON)</Text>
        <Text style={{ color: t.sub, lineHeight: 19 }}>모든 통장·내역·품목·카테고리·예산·고정 거래·규칙을 파일 하나로 내보내요. 다른 폰으로 옮기거나 안전하게 보관할 때 쓰세요. (영수증 사진 파일은 포함되지 않아요)</Text>
        <Button title="백업 파일 내보내기" icon="share-outline" onPress={exportJson} disabled={busy} />
        <Button title="백업에서 복원" kind="soft" icon="download-outline" onPress={restore} disabled={busy} />
      </Card>
      <Card style={{ gap: 10 }}>
        <Text style={{ fontWeight: '800', fontSize: 16, color: t.text }}>CSV (엑셀·구글시트)</Text>
        <Text style={{ color: t.sub, lineHeight: 19 }}>전체 내역을 날짜순 표로 내보내요. 한글이 깨지지 않도록 UTF-8(BOM)로 만들어요.</Text>
        <Button title="CSV 내보내기" kind="soft" icon="document-text-outline" onPress={exportCsv} disabled={busy} />
        <Button title="영수증 품목 CSV 내보내기" kind="soft" icon="receipt-outline" onPress={exportItemsCsv} disabled={busy} />
      </Card>
      <SectionTitle title="위험" />
      <Card style={{ gap: 10 }}>
        <Text style={{ color: t.sub, lineHeight: 19 }}>내역 {txs.length}건이 저장돼 있어요.</Text>
        <Button title="모든 내역 지우기" kind="danger" onPress={wipe} disabled={busy} />
      </Card>
    </ScrollView>
  );
}
