import { useColorScheme } from 'react-native';

const base = { primary: '#0F766E', expense: '#EF4444', income: '#2563EB', warn: '#F59E0B', ok: '#16A34A' };
export const light = {
  ...base, dark: false, bg: '#F3F6F5', card: '#FFFFFF', text: '#0F172A', sub: '#64748B', faint: '#94A3B8',
  line: '#E2E8F0', primarySoft: '#CCFBF1', input: '#F1F5F9', danger: '#DC2626', shadow: '0 1px 6px rgba(15,23,42,0.08)',
};
export const dark = {
  ...base, dark: true, bg: '#0B1110', card: '#141C1B', text: '#F1F5F9', sub: '#94A3B8', faint: '#64748B',
  line: '#26302F', primarySoft: '#0F3D39', input: '#1C2625', danger: '#F87171', shadow: 'none',
  primary: '#2DD4BF', expense: '#F87171', income: '#60A5FA',
};
export type Theme = typeof light;

export const useTheme = (): Theme => (useColorScheme() === 'dark' ? dark : light);
export const R = { sm: 10, md: 14, lg: 20, pill: 999 };
