import React from 'react';
import { router } from 'expo-router';
import { ScrollView, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Card, Row } from '../../components/ui';
import { useLedger } from '../../store';
import { useRecurringSuggestions } from '../../components/useRecurringSuggestions';
import { useTheme } from '../../theme';

export default function More() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { recurring, budgets, templates, goals } = useLedger();
  const { suggestions } = useRecurringSuggestions();
  const go = (p: string) => () => router.push(p as never);
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingTop: insets.top + 12, paddingBottom: insets.bottom + 140, gap: 14 }}>
      <Text style={{ fontSize: 28, fontWeight: '800', color: t.text }}>더보기</Text>
      <Card>
        <Row icon="download" label="거래 가져오기" sub="은행·카드 내역(CSV) · 승인/입출금 문자 붙여넣기" onPress={go('/more/import')} />
        <Row icon="analytics" label="지출 인사이트" sub="어디에 가장 많이 쓰는지 · 새는 돈 · 정기 결제" onPress={go('/insights')} />
        <Row icon="receipt" label="구매 내역" sub="영수증 품목 검색 · 누적 금액 · 최근 구입가 · 가격 추이" onPress={go('/more/purchases')} />
        <Row icon="pricetags" label="카테고리 관리" sub="추가·이름·색·소분류" onPress={go('/more/categories')} />
        <Row icon="speedometer" label="예산" sub={`${budgets.length}개 설정`} onPress={go('/more/budgets')} />
        <Row icon="flash" label="자주 쓰는 거래" sub={`${templates.length}개 · 칩 한 번으로 바로 기록`} onPress={go('/more/templates')} />
        <Row icon="flag" label="저축 목표" sub={`${goals.length}개`} onPress={go('/more/goals')} />
        <Row icon="repeat" label="정기 거래 (자동 기록)" sub={`${recurring.filter((r) => r.active).length}개 · 월세·구독·급여를 정한 날 자동으로 기록${suggestions.length ? ` · 등록 제안 ${suggestions.length}곳` : ''}`} onPress={go('/more/recurring')} last />
      </Card>
      <Card>
        <Row icon="settings" label="설정" sub="앱 잠금 · 예산 알림" onPress={go('/more/settings')} />
        <Row icon="cloud-download" label="백업 · 내보내기 · 초기화" sub="JSON 백업/복원, CSV(엑셀) 내보내기" onPress={go('/more/backup')} last />
      </Card>
      <Text style={{ textAlign: 'center', color: t.faint, fontSize: 12 }}>FlowLedger 1.0 · 데이터는 이 기기에만 저장돼요</Text>
    </ScrollView>
  );
}
