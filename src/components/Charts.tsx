import React from 'react';
import { Text, View } from 'react-native';
import Svg, { Circle, Line, Polyline } from 'react-native-svg';

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

/** 꺾은선 (순자산 추이 등). 값이 모두 같아도 가운데 선으로 그린다 */
export function LineChart({ points, height = 120, color }: { points: { label: string; value: number }[]; height?: number; color: string }) {
  const t = useTheme();
  const [w, setW] = React.useState(0);
  const vals = points.map((p) => p.value);
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = max - min || 1;
  const pad = 14;
  const xy = points.map((p, i) => [pad + (points.length === 1 ? 0 : (i / (points.length - 1)) * Math.max(w - pad * 2, 1)), pad + (1 - (p.value - min) / span) * (height - pad * 2)] as const);
  return (
    <View onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      <Svg width={w} height={height}>
        {min < 0 && max > 0 && <Line x1={0} x2={w} y1={pad + (1 - (0 - min) / span) * (height - pad * 2)} y2={pad + (1 - (0 - min) / span) * (height - pad * 2)} stroke={t.line} strokeWidth={1} strokeDasharray="4 4" />}
        {w > 0 && <Polyline points={xy.map(([x, y]) => `${x},${y}`).join(' ')} fill="none" stroke={color} strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" />}
        {w > 0 && xy.map(([x, y], i) => <Circle key={i} cx={x} cy={y} r={i === xy.length - 1 ? 5 : 3} fill={color} />)}
      </Svg>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
        <Text style={{ fontSize: 11, color: t.sub }}>{points[0]?.label}</Text>
        <Text style={{ fontSize: 11, color: t.sub }}>{points[points.length - 1]?.label}</Text>
      </View>
    </View>
  );
}
