import { makeBackup, parseBackup } from '../src/lib/backup';
import { accs, cats, tx } from './helpers';

const base = () => ({
  accounts: accs(), categories: cats, transactions: [tx({ id: 't1', amount: 5000, date: '2026-11-10' })], budgets: [], recurring: [], rules: [],
});

test('가맹점 별칭·분류 학습이 백업에 담기고 복원 검증을 통과한다', () => {
  const text = makeBackup({ ...base(), merchant_aliases: [{ alias_key: '우리집앞카페', canonical: '스타벅스' }], merchant_categories: [{ merchant_key: '스타벅스', category_id: 'cat_food_cafe' }] });
  const p = parseBackup(text);
  expect(p.ok).toBe(true);
  if (p.ok) {
    expect(p.data.merchant_aliases).toEqual([{ alias_key: '우리집앞카페', canonical: '스타벅스' }]);
    expect(p.data.merchant_categories).toHaveLength(1);
  }
});

test('이전 백업(별칭 필드 없음)도 통과', () => {
  expect(parseBackup(makeBackup(base())).ok).toBe(true);
});

test('잘못된 별칭·없는 분류를 가리키는 학습은 거부', () => {
  const bad1 = parseBackup(makeBackup({ ...base(), merchant_aliases: [{ alias_key: '', canonical: '' }] }));
  expect(bad1.ok).toBe(false);
  const bad2 = parseBackup(makeBackup({ ...base(), merchant_categories: [{ merchant_key: 'x', category_id: 'cat_없음' }] }));
  expect(bad2.ok).toBe(false);
  if (!bad2.ok) expect(bad2.errors.join()).toContain('학습');
});
