import React from 'react';
import { router } from 'expo-router';
import { ScrollView, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Card, Row } from '../../components/ui';
import { useLedger } from '../../store';
import { useTheme } from '../../theme';

export default function More() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { accounts, rules, recurring, budgets } = useLedger();
  const go = (p: string) => () => router.push(p as never);
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingTop: insets.top + 12, paddingBottom: insets.bottom + 140, gap: 14 }}>
      <Text style={{ fontSize: 28, fontWeight: '800', color: t.text }}>더보기</Text>
      <Card>
        <Row icon="wallet" label="통장 관리" sub={`${accounts.filter((a) => !a.archived).length}개 · 기본 통장 지정`} onPress={go('/more/accounts')} />
        <Row icon="git-branch" label="통장 자동 지정 규칙" sub={`${rules.length}개 · 가맹점·카테고리에 따라 통장 선택`} onPress={go('/more/rules')} />
        <Row icon="pricetags" label="카테고리 관리" sub="추가·이름·색·소분류" onPress={go('/more/categories')} />
        <Row icon="speedometer" label="예산" sub={`${budgets.length}개 설정`} onPress={go('/more/budgets')} />
        <Row icon="repeat" label="고정 거래" sub={`${recurring.filter((r) => r.active).length}개 · 월세·구독 등 자동 기록`} onPress={go('/more/recurring')} last />
      </Card>
      <Card>
        <Row icon="cloud-download" label="백업 · 내보내기 · 초기화" sub="JSON 백업/복원, CSV(엑셀) 내보내기" onPress={go('/more/backup')} last />
      </Card>
      <Text style={{ textAlign: 'center', color: t.faint, fontSize: 12 }}>FlowLedger 1.0 · 데이터는 이 기기에만 저장돼요</Text>
    </ScrollView>
  );
}
