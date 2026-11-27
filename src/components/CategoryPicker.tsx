import React from 'react';
import { View } from 'react-native';

import { useLedger } from '../store';
import { Chip } from './ui';

/** 대분류 → 소분류 칩 선택. value 는 대분류 또는 소분류 id (nullable 허용 시 '없음' 칩) */
export function CategoryPicker({ type, value, onChange, allowNone, noneLabel = '없음' }: {
  type: 'expense' | 'income'; value: string | null; onChange: (id: string | null) => void; allowNone?: boolean; noneLabel?: string;
}) {
  const { categories, catById } = useLedger();
  const pool = categories.filter((c) => c.type === type && !c.archived);
  const tops = pool.filter((c) => !c.parent_id);
  const sel = value ? catById.get(value) : undefined;
  const openTop = sel ? sel.parent_id ?? sel.id : null;
  const subs = openTop ? pool.filter((c) => c.parent_id === openTop) : [];
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {allowNone && <Chip label={noneLabel} on={value === null} onPress={() => onChange(null)} />}
        {tops.map((c) => <Chip key={c.id} label={c.name} color={c.color ?? undefined} on={openTop === c.id} onPress={() => onChange(c.id)} />)}
      </View>
      {subs.length > 0 && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingLeft: 8 }}>
          {subs.map((c) => <Chip key={c.id} label={c.name} on={value === c.id} onPress={() => onChange(value === c.id ? openTop : c.id)} />)}
        </View>
      )}
    </View>
  );
}
