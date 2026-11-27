import type { Account, Category } from './types';

type Group = { id: string; name: string; color: string; icon: string; children?: [string, string][] };

const EXPENSE: Group[] = [
  { id: 'food', name: '식비', color: '#F97316', icon: 'restaurant', children: [['eat_out', '외식'], ['delivery', '배달'], ['cafe', '카페/간식'], ['grocery', '장보기']] },
  { id: 'shop', name: '쇼핑', color: '#EC4899', icon: 'bag-handle', children: [['clothes', '의류'], ['shoes', '신발/잡화'], ['living', '생활용품'], ['elec', '전자기기']] },
  { id: 'hobby', name: '취미/여가', color: '#8B5CF6', icon: 'game-controller', children: [['game', '게임'], ['sports', '운동'], ['travel', '여행'], ['culture', '문화/공연'], ['sub', '구독']] },
  { id: 'transport', name: '교통', color: '#0EA5E9', icon: 'bus', children: [['public', '대중교통'], ['taxi', '택시'], ['fuel', '주유/주차']] },
  { id: 'housing', name: '주거/통신', color: '#14B8A6', icon: 'home', children: [['rent', '월세'], ['mgmt', '관리비'], ['utility', '공과금'], ['phone', '통신비']] },
  { id: 'health', name: '건강', color: '#22C55E', icon: 'medkit', children: [['hospital', '병원/약국'], ['supplement', '건강식품']] },
  { id: 'gift', name: '경조사/선물', color: '#F43F5E', icon: 'gift' },
  { id: 'edu', name: '교육', color: '#6366F1', icon: 'school' },
  { id: 'finance', name: '보험/금융', color: '#64748B', icon: 'shield-checkmark', children: [['insurance', '보험'], ['fee', '이자/수수료']] },
  { id: 'misc', name: '기타', color: '#94A3B8', icon: 'ellipsis-horizontal-circle' },
];
const INCOME: Group[] = [
  { id: 'salary', name: '급여', color: '#16A34A', icon: 'cash' },
  { id: 'side', name: '부수입', color: '#65A30D', icon: 'briefcase' },
  { id: 'allowance', name: '용돈', color: '#CA8A04', icon: 'wallet' },
  { id: 'interest', name: '이자/배당', color: '#0D9488', icon: 'trending-up' },
  { id: 'refund', name: '환급', color: '#0284C7', icon: 'return-down-back' },
  { id: 'inc_misc', name: '기타수입', color: '#94A3B8', icon: 'ellipsis-horizontal-circle' },
];

export const DEFAULT_ACCOUNT_ID = 'acc_main';
export const MISC_EXPENSE_ID = 'cat_misc';
export const MISC_INCOME_ID = 'cat_inc_misc';

export function seedAccounts(now: string): Account[] {
  return [{ id: DEFAULT_ACCOUNT_ID, name: '주 통장', kind: 'bank', initial_balance: 0, is_default: 1, archived: 0, sort: 0, created_at: now }];
}

export function seedCategories(): Category[] {
  const out: Category[] = [];
  const push = (groups: Group[], type: 'expense' | 'income') => {
    groups.forEach((g, i) => {
      const gid = `cat_${g.id}`;
      out.push({ id: gid, name: g.name, type, parent_id: null, icon: g.icon, color: g.color, sort: i, archived: 0 });
      (g.children ?? []).forEach(([cid, name], j) =>
        out.push({ id: `${gid}_${cid}`, name, type, parent_id: gid, icon: null, color: g.color, sort: j, archived: 0 }));
    });
  };
  push(EXPENSE, 'expense');
  push(INCOME, 'income');
  return out;
}
