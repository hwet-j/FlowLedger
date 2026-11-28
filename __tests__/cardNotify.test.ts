import * as notify from '../src/lib/cardNotify';
import { parseQueue, queueToText } from '../src/lib/cardNotify';
import { parseSms } from '../src/lib/import/sms';

test('대기열 JSON: 깨진 값·빈 글은 건너뜀', () => {
  expect(parseQueue('not json')).toEqual([]);
  expect(parseQueue('{}')).toEqual([]);
  expect(parseQueue(null)).toEqual([]);
  const items = parseQueue(JSON.stringify([{ t: 2, p: 'a', x: '  ' }, { t: 1, p: 'kb', x: '[KB]승인 9,000원' }, { p: 'z' }]));
  expect(items).toEqual([{ t: 1, p: 'kb', x: '[KB]승인 9,000원' }]);
});

test('알림 글 여러 건을 오래된 순으로 문단 구분해 문자 파서에 넘긴다', () => {
  const text = queueToText([
    { t: 20, p: 'b', x: '신한카드 승인 이*철 12,500원 일시불 11/27 18:30 스타벅스' },
    { t: 10, p: 'a', x: '하나카드 승인 김*수 5,000원 일시불 11/27 12:10 GS25' },
  ]);
  expect(text.indexOf('GS25')).toBeLessThan(text.indexOf('스타벅스'));
  const r = parseSms(text, new Date(2026, 10, 28));
  expect(r.drafts.map((d) => d.amount)).toEqual([5000, 12500]);
  expect(r.drafts.every((d) => d.type === 'expense')).toBe(true);
});

test('네이티브 모듈이 없는 환경에서는 조용히 빈 값', () => {
  const m = notify;
  expect(m.notifyAccessEnabled()).toBe(false);
  expect(m.peekNotifyQueue()).toEqual([]);
  expect(m.openNotifyAccessSettings()).toBe(false);
  expect(() => m.clearNotifyQueue()).not.toThrow();
});
