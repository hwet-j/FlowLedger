import React, { useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { removeCategory, saveCategory } from '../../db/repo';
import { catStyle } from '../../components/TxRow';
import { Button, Card, Chip, Field, Row } from '../../components/ui';
import type { Category } from '../../lib/types';
import { useLedger } from '../../store';
import { useTheme } from '../../theme';

const COLORS = ['#F97316', '#EC4899', '#8B5CF6', '#0EA5E9', '#14B8A6', '#22C55E', '#F43F5E', '#6366F1', '#CA8A04', '#64748B'];

export default function CategoriesScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { categories, catById, mutate } = useLedger();
  const [type, setType] = useState<'expense' | 'income'>('expense');
  const [form, setForm] = useState<null | { id?: string; parent_id: string | null; name: string; color: string }>(null);
  const tops = categories.filter((c) => c.type === type && !c.parent_id && !c.archived);

  const save = async () => {
    if (!form) return;
    const name = form.name.trim();
    if (!name) return Alert.alert('이름을 입력해 주세요');
    try {
      await mutate((db) => saveCategory(db, { id: form.id, name, type, parent_id: form.parent_id, color: form.color, icon: form.id ? catById.get(form.id)?.icon ?? null : null }));
      setForm(null);
    } catch (e) {
      Alert.alert('저장하지 못했어요', e instanceof Error && /UNIQUE/.test(e.message) ? '같은 이름의 카테고리가 이미 있어요.' : String(e));
    }
  };
  const remove = (c: Category) =>
    Alert.alert(`"${c.name}" 을(를) 삭제할까요?`, '이 카테고리로 기록된 내역이 있으면 삭제 대신 숨겨져요(기존 내역은 유지).', [
      { text: '취소', style: 'cancel' },
      { text: '삭제', style: 'destructive', onPress: async () => { await mutate((db) => removeCategory(db, c.id)); setForm(null); } },
    ]);

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: insets.bottom + 40 }} keyboardShouldPersistTaps="handled">
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Chip label="지출" on={type === 'expense'} onPress={() => setType('expense')} />
        <Chip label="수입" on={type === 'income'} onPress={() => setType('income')} />
      </View>
      {tops.map((c) => {
        const st = catStyle(c, catById);
        const subs = categories.filter((x) => x.parent_id === c.id && !x.archived);
        return (
          <Card key={c.id} style={{ gap: 6 }}>
            <Row icon={st.icon} color={st.color} label={c.name} sub={subs.length ? subs.map((s) => s.name).join(' · ') : '소분류 없음'}
              onPress={() => setForm({ id: c.id, parent_id: null, name: c.name, color: c.color ?? COLORS[0] })} last />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {subs.map((s) => <Chip key={s.id} label={s.name} onPress={() => setForm({ id: s.id, parent_id: c.id, name: s.name, color: s.color ?? c.color ?? COLORS[0] })} />)}
              <Chip label="+ 소분류" onPress={() => setForm({ parent_id: c.id, name: '', color: c.color ?? COLORS[0] })} />
            </View>
          </Card>
        );
      })}
      {form ? (
        <Card style={{ gap: 12 }}>
          <Text style={{ fontWeight: '800', color: t.text }}>
            {form.id ? '수정' : form.parent_id ? `"${catById.get(form.parent_id)?.name}" 소분류 추가` : '대분류 추가'}
          </Text>
          <Field label="이름" value={form.name} onChangeText={(name) => setForm({ ...form, name })} placeholder="예: 반려동물" />
          {!form.parent_id && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              {COLORS.map((c) => (
                <View key={c} style={{ borderWidth: 3, borderColor: form.color === c ? t.text : 'transparent', borderRadius: 20 }}>
                  <Chip label="  " color={c} on onPress={() => setForm({ ...form, color: c })} />
                </View>
              ))}
            </View>
          )}
          <Button title="저장" onPress={save} />
          <Button title="닫기" kind="soft" onPress={() => setForm(null)} />
          {form.id && <Button title="삭제" kind="danger" onPress={() => remove(catById.get(form.id as string) as Category)} />}
        </Card>
      ) : <Button title="대분류 추가" icon="add" onPress={() => setForm({ parent_id: null, name: '', color: COLORS[0] })} />}
    </ScrollView>
  );
}
