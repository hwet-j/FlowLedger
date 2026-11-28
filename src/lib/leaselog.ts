import { requireNativeModule } from 'expo';

/** LeaseLog 가 비서·가계부에만 내주는 스냅샷 제공자 (읽기 전용). 앱이 없거나 구버전이면 null */
const AUTHORITY = 'com.rentmanager.app.assistant';

interface Native { callProvider(authority: string, method: string): Promise<{ json?: string; error?: string }> }

export async function readLeaselogSnapshot(): Promise<unknown | null> {
  try {
    const m = requireNativeModule<Native>('AssistantShare');
    const r = await m.callProvider(AUTHORITY, 'snapshot');
    if (!r || r.error || !r.json) return null;
    return JSON.parse(r.json);
  } catch {
    return null;
  }
}
