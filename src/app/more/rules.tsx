import React, { useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { deleteRule, saveRule } from '../../db/repo';
import { Button, Card, Chip, Empty, Field, Row } from '../../components/ui';
import type { RuleMatch } from '../../lib/types';
import { useLedger } from '../../store';
import { useTheme } from '../../theme';

const MATCH: [RuleMatch, string, string][] = [['any', '모두', '가맹점·메모·카테고리 어디든'], ['merchant', '가맹점', '가맹점/내용에 포함'], ['category', '카테고리', '카테고리 이름에 포함'], ['memo', '메모', '메모에 포함']];

export default function RulesScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { rules, accounts, accountById, mutate } = useLedger();
  const active = accounts.filter((a) => !a.archived);
  const [keyword, setKeyword] = useState('');
  const [match, setMatch] = useState<RuleMatch>('any');
  const [accountId, setAccountId] = useState<string | null>(null);

  const add = async () => {
    const k = keyword.trim();
    if (!k) return Alert.alert('키워드를 입력해 주세요', '예: 넷플릭스, 스타벅스, 구독');
    const acc = accountId ?? active[0]?.id;
    if (!acc) return Alert.alert('통장을 선택해 주세요');
    await mutate((db) => saveRule(db, { keyword: k, match, account_id: acc }));
    setKeyword('');
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: insets.bottom + 40 }} keyboardShouldPersistTaps="handled">
      <Text style={{ color: t.sub, lineHeight: 19 }}>
        통장을 말하지 않고 기록할 때, 가맹점·메모·카테고리에 키워드가 들어 있으면 지정한 통장에 기록돼요. 키워드가 긴 규칙이 먼저 적용되고, 규칙이 없으면 기본 통장을 써요. (비서에게 말해도 같은 규칙이 적용돼요)
      </Text>
      <Card>
        {rules.length === 0 ? <Empty icon="git-branch-outline" title="규칙이 없어요" hint={'예: "넷플릭스" → 국민카드'} /> : rules.map((r, i) => (
          <Row key={r.id} icon="git-branch" label={`"${r.keyword}" → ${accountById.get(r.account_id)?.name ?? '?'}`} sub={MATCH.find((m) => m[0] === r.match)?.[2]}
            right={<Button title="삭제" kind="danger" small onPress={() => mutate((db) => deleteRule(db, r.id))} />} last={i === rules.length - 1} />
        ))}
      </Card>
      <Card style={{ gap: 12 }}>
        <Text style={{ fontWeight: '800', color: t.text }}>규칙 추가</Text>
        <Field label="키워드" value={keyword} onChangeText={setKeyword} placeholder="예: 넷플릭스" />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {MATCH.map(([k, l]) => <Chip key={k} label={l} on={match === k} onPress={() => setMatch(k)} />)}
        </View>
        <Text style={{ fontSize: 13, fontWeight: '700', color: t.sub }}>기록될 통장</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {active.map((a) => <Chip key={a.id} label={a.name} on={(accountId ?? active[0]?.id) === a.id} onPress={() => setAccountId(a.id)} />)}
        </View>
        <Button title="규칙 추가" icon="add" onPress={add} />
      </Card>
    </ScrollView>
  );
}
