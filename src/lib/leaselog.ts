import { requireNativeModule } from 'expo';

/** LeaseLog 가 비서·가계부에만 내주는 스냅샷 제공자 (읽기 전용). 앱이 없거나 구버전이면 null */
const AUTHORITY = 'com.rentmanager.app.assistant';

interface Native { callProvider(authority: string, method: string): Promise<{ json?: string; error?: string }> }

const TIMEOUT_MS = 8000;

/** 제공자가 응답하지 않아도(LeaseLog 가 멈췄거나 시작이 느릴 때) 영원히 기다리지 않는다 */
export function readLeaselogSnapshot(): Promise<unknown | null> {
  return Promise.race([readOnce(), new Promise<null>((resolve) => setTimeout(() => resolve(null), TIMEOUT_MS))]);
}

async function readOnce(): Promise<unknown | null> {
  try {
    const m = requireNativeModule<Native>('AssistantShare');
    const r = await m.callProvider(AUTHORITY, 'snapshot');
    if (!r || r.error || !r.json) return null;
    return JSON.parse(r.json);
  } catch {
    return null;
  }
}
