import React from 'react';
import { Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { fmtShort } from '../lib/money';
import { useTheme } from '../theme';

/** 도넛 차트 (react-native-svg). slices 의 value 비율로 호를 나눈다 */
export function Donut({ slices, size = 150, thickness = 22, center }: {
  slices: { value: number; color: string }[]; size?: number; thickness?: number; center?: React.ReactNode;
}) {
  const t = useTheme();
  const total = slices.reduce((s, x) => s + x.value, 0);
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  let acc = 0;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={t.input} strokeWidth={thickness} fill="none" />
        {total > 0 && slices.map((s, i) => {
          const len = (s.value / total) * c;
          const el = (
            <Circle key={i} cx={size / 2} cy={size / 2} r={r} stroke={s.color} strokeWidth={thickness} fill="none"
              strokeDasharray={`${Math.max(len - 1.5, 0)} ${c - Math.max(len - 1.5, 0)}`} strokeDashoffset={-acc}
              rotation={-90} origin={`${size / 2}, ${size / 2}`} />
          );
          acc += len;
          return el;
        })}
      </Svg>
      {center}
    </View>
  );
}

/** 월별 수입/지출 막대 (세로). 가장 큰 값을 100% 로 */
export function TrendBars({ data, height = 120, selected }: { data: { label: string; income: number; expense: number }[]; height?: number; selected?: number }) {
  const t = useTheme();
  const max = Math.max(1, ...data.flatMap((d) => [d.income, d.expense]));
  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', height, gap: 4 }}>
        {data.map((d, i) => (
          <View key={i} style={{ flex: 1, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: 2, height, opacity: selected === undefined || selected === i ? 1 : 0.55 }}>
            <View style={{ width: '38%', height: Math.max(2, (d.income / max) * height), backgroundColor: t.income, borderTopLeftRadius: 3, borderTopRightRadius: 3 }} />
            <View style={{ width: '38%', height: Math.max(2, (d.expense / max) * height), backgroundColor: t.expense, borderTopLeftRadius: 3, borderTopRightRadius: 3 }} />
          </View>
        ))}
      </View>
      <View style={{ flexDirection: 'row', gap: 4, marginTop: 6 }}>
        {data.map((d, i) => <Text key={i} style={{ flex: 1, textAlign: 'center', fontSize: 10, color: t.sub }}>{d.label}</Text>)}
      </View>
      <Text style={{ fontSize: 11, color: t.faint, marginTop: 6 }}>최대 {fmtShort(max)}원 · 파랑=수입 빨강=지출</Text>
    </View>
  );
}

/** 요일별 지출 막대 */
export function WeekdayBars({ data }: { data: { label: string; total: number }[] }) {
  const t = useTheme();
  const max = Math.max(1, ...data.map((d) => d.total));
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 100, gap: 8 }}>
      {data.map((d, i) => (
        <View key={i} style={{ flex: 1, alignItems: 'center', justifyContent: 'flex-end', height: 100 }}>
          <Text style={{ fontSize: 10, color: t.sub, marginBottom: 2 }}>{d.total ? fmtShort(d.total) : ''}</Text>
          <View style={{ width: '70%', height: Math.max(3, (d.total / max) * 64), backgroundColor: i === 0 ? t.expense : i === 6 ? t.income : t.primary, borderRadius: 4 }} />
          <Text style={{ fontSize: 12, color: t.sub, marginTop: 4 }}>{d.label}</Text>
        </View>
      ))}
    </View>
  );
}
