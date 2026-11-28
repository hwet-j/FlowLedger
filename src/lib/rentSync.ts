/**
 * LeaseLog(월세 앱)의 입금 내역을 수입으로 옮기기 위한 순수 로직.
 * 비서 앱의 rent_sync_to_flowledger 도구와 **같은 req_id 규칙**을 쓴다 → 어느 쪽으로 반영해도 같은 건은 한 번만 들어간다.
 */
export interface RentPayment { date: string; building: string; room: string; amount: number }
export interface RentAdd { ref: string; date: string; amount: number; merchant: string }

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** LeaseLog 스냅샷({data:{payments:{"YYYY-MM": 배열 | {items}}}}) 에서 입금 내역을 모두 뽑는다. 세입자 이름·연락처는 쓰지 않는다 */
export function snapshotPayments(snapshot: unknown): RentPayment[] {
  const months = (snapshot as { data?: { payments?: Record<string, unknown> } } | null)?.data?.payments;
  if (!months || typeof months !== 'object') return [];
  const out: RentPayment[] = [];
  for (const key of Object.keys(months).sort()) {
    const v = months[key];
    const list = Array.isArray(v) ? v : Array.isArray((v as { items?: unknown })?.items) ? (v as { items: unknown[] }).items : [];
    for (const r of list) {
      const o = r as Record<string, unknown>;
      if (typeof o?.date !== 'string' || !DATE.test(o.date)) continue;
      if (typeof o.amount !== 'number' || !Number.isInteger(o.amount) || o.amount <= 0) continue;
      out.push({ date: o.date, building: typeof o.building === 'string' ? o.building : '', room: typeof o.room === 'string' ? o.room : '', amount: o.amount });
    }
  }
  return out;
}

/** FNV-1a 32bit → base36 (비서 앱 src/integrations/rentsync/pure.ts 와 동일해야 한다) */
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/** 같은 날 같은 호실·금액이 두 번 입금돼도 별개 건이 되도록 순번을 붙인다 */
export function buildRentAdds(rows: RentPayment[]): RentAdd[] {
  const seen = new Map<string, number>();
  return rows.map((p) => {
    const base = `${p.date}|${p.building}|${p.room}|${p.amount}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    const where = [p.building, p.room].filter(Boolean).join(' ');
    return { ref: `rent:${p.date.replace(/-/g, '')}:${hash(base)}:${n}`, date: p.date, amount: p.amount, merchant: `${where || '월세'} 월세`.trim() };
  });
}

/** 처음 켰을 때 먼 과거 입금까지 한꺼번에 들어오지 않게, 최근 N개월 안의 입금만 반영한다 */
export function recentOnly(adds: RentAdd[], today: string, months = 3): RentAdd[] {
  const [y, m, d] = today.split('-').map(Number);
  const from = new Date(y, m - 1 - months, d);
  const lim = `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, '0')}-${String(from.getDate()).padStart(2, '0')}`;
  return adds.filter((a) => a.date >= lim);
}
