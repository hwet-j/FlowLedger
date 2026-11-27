import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native';

import { R, useTheme } from '../theme';

export type IconName = keyof typeof Ionicons.glyphMap;

export function Card({ children, style, onPress, accessibilityLabel }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; accessibilityLabel?: string }) {
  const t = useTheme();
  const st = [{ backgroundColor: t.card, borderRadius: R.lg, padding: 16, boxShadow: t.shadow }, style];
  return onPress ? (
    <Pressable onPress={onPress} style={st} accessibilityRole="button" accessibilityLabel={accessibilityLabel}>{children}</Pressable>
  ) : <View style={st}>{children}</View>;
}

export function Txt({ children, size = 15, weight = '500', color, style, numberOfLines }: {
  children: React.ReactNode; size?: number; weight?: '400' | '500' | '600' | '700' | '800'; color?: string; style?: StyleProp<ViewStyle>; numberOfLines?: number;
}) {
  const t = useTheme();
  return <Text numberOfLines={numberOfLines} style={[{ fontSize: size, fontWeight: weight, color: color ?? t.text }, style as never]}>{children}</Text>;
}

export function SectionTitle({ title, right }: { title: string; right?: React.ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 20, marginBottom: 8, paddingHorizontal: 4 }}>
      <Text style={{ fontSize: 14, fontWeight: '700', color: t.sub }}>{title}</Text>
      {right}
    </View>
  );
}

export function Button({ title, onPress, kind = 'primary', disabled, icon, small }: {
  title: string; onPress: () => void; kind?: 'primary' | 'soft' | 'danger'; disabled?: boolean; icon?: IconName; small?: boolean;
}) {
  const t = useTheme();
  const bg = kind === 'primary' ? t.primary : kind === 'danger' ? 'transparent' : t.primarySoft;
  const fg = kind === 'primary' ? (t.dark ? '#04201D' : '#fff') : kind === 'danger' ? t.danger : t.primary;
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={title}
      style={{ height: small ? 38 : 50, paddingHorizontal: small ? 14 : 20, borderRadius: R.md, backgroundColor: bg, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, opacity: disabled ? 0.45 : 1 }}>
      {icon && <Ionicons name={icon} size={small ? 16 : 18} color={fg} />}
      <Text style={{ color: fg, fontWeight: '700', fontSize: small ? 14 : 16 }}>{title}</Text>
    </Pressable>
  );
}

export function Chip({ label, on, onPress, color, icon }: { label: string; on?: boolean; onPress?: () => void; color?: string; icon?: IconName }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: !!on }}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, height: 36, borderRadius: R.pill, backgroundColor: on ? (color ?? t.primary) : t.input }}>
      {icon && <Ionicons name={icon} size={15} color={on ? '#fff' : t.sub} />}
      <Text style={{ fontSize: 14, fontWeight: '600', color: on ? '#fff' : t.text }}>{label}</Text>
    </Pressable>
  );
}

export function Field(props: TextInputProps & { label?: string }) {
  const t = useTheme();
  const { label, style, ...rest } = props;
  return (
    <View style={{ gap: 6 }}>
      {label ? <Text style={{ fontSize: 13, fontWeight: '700', color: t.sub }}>{label}</Text> : null}
      <TextInput placeholderTextColor={t.faint} {...rest} accessibilityLabel={label ?? rest.placeholder}
        style={[{ height: 48, borderRadius: R.md, paddingHorizontal: 14, fontSize: 16, color: t.text, backgroundColor: t.input }, style]} />
    </View>
  );
}

export function Row({ icon, label, sub, right, onPress, last, color }: {
  icon?: IconName; label: string; sub?: string; right?: React.ReactNode; onPress?: () => void; last?: boolean; color?: string;
}) {
  const t = useTheme();
  const inner = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingVertical: 8, borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth, borderBottomColor: t.line }}>
      {icon && (
        <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: color ? color + '22' : t.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name={icon} size={19} color={color ?? t.primary} />
        </View>
      )}
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 16, fontWeight: '600', color: t.text }}>{label}</Text>
        {sub ? <Text style={{ fontSize: 13, color: t.sub, marginTop: 2 }}>{sub}</Text> : null}
      </View>
      {right}
      {onPress && !right && <Ionicons name="chevron-forward" size={18} color={t.faint} />}
    </View>
  );
  return onPress ? <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>{inner}</Pressable> : inner;
}

export function Empty({ icon = 'receipt-outline', title, hint }: { icon?: IconName; title: string; hint?: string }) {
  const t = useTheme();
  return (
    <View style={{ alignItems: 'center', paddingVertical: 40, gap: 8 }}>
      <Ionicons name={icon} size={40} color={t.faint} />
      <Text style={{ fontSize: 16, fontWeight: '700', color: t.text }}>{title}</Text>
      {hint ? <Text style={{ fontSize: 13, color: t.sub, textAlign: 'center', lineHeight: 19 }}>{hint}</Text> : null}
    </View>
  );
}

/** 가로 막대 (값/최대) */
export function Bar({ pct, color, height = 8 }: { pct: number; color: string; height?: number }) {
  const t = useTheme();
  return (
    <View style={{ height, borderRadius: height, backgroundColor: t.input, overflow: 'hidden' }}>
      <View style={{ width: `${Math.max(0, Math.min(100, pct))}%`, height, borderRadius: height, backgroundColor: color }} />
    </View>
  );
}
