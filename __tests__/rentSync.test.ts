import { buildRentAdds, recentOnly, snapshotPayments } from '../src/lib/rentSync';

const REQ = /^[A-Za-z0-9_.:\-]{1,64}$/;

test('LeaseLog 스냅샷에서 입금 내역만 뽑는다 (배열·{items}, 세입자 정보 제외)', () => {
  const snap = {
    data: {
      payments: {
        '2026-10': [{ date: '2026-10-05', building: 'A', room: '101', tenant: '홍길동', amount: 450000 }],
        '2026-11': { items: [{ date: '2026-11-05', building: 'A', room: '101', amount: 450000 }, { date: 'bad', room: '1', amount: 1 }, { date: '2026-11-06', room: '2', amount: 0 }] },
      },
    },
  };
  const rows = snapshotPayments(snap);
  expect(rows.map((r) => r.date)).toEqual(['2026-10-05', '2026-11-05']);
  expect(Object.keys(rows[0]).sort()).toEqual(['amount', 'building', 'date', 'room']);
  expect(snapshotPayments(null)).toEqual([]);
  expect(snapshotPayments({ data: {} })).toEqual([]);
});

test('ref 는 안정적이고 허용 문자만 쓰며, 같은 날 같은 입금 2건은 구분된다', () => {
  const p = { date: '2026-11-05', building: '', room: '101호', amount: 200000 };
  const [x, y] = buildRentAdds([p, p]);
  expect(x.ref).toMatch(REQ);
  expect(x.ref).not.toBe(y.ref);
  expect(buildRentAdds([p, p]).map((r) => r.ref)).toEqual([x.ref, y.ref]);
  expect(x.merchant).toBe('101호 월세');
});

test('비서 앱(rentsync/pure.ts)과 같은 ref 를 만든다 (고정 값: 두 앱 테스트가 같은 값을 확인)', () => {
  const a = buildRentAdds([{ date: '2026-11-05', building: 'A', room: '101', amount: 450000 }])[0];
  expect(a.ref).toBe('rent:20261105:q1k1pu:1');
});

test('최근 3개월 입금만 반영', () => {
  const adds = buildRentAdds([
    { date: '2026-07-01', building: '', room: '1', amount: 1 },
    { date: '2026-08-27', building: '', room: '1', amount: 2 },
    { date: '2026-11-05', building: '', room: '1', amount: 3 },
  ]);
  expect(recentOnly(adds, '2026-11-27').map((a) => a.amount)).toEqual([2, 3]);
});
