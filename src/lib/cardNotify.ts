import { requireNativeModule } from 'expo';
import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';

/** 카드 승인·입출금 알림 대기열 (Kotlin CardNotifyService 가 쌓음). 앱이 없는 환경(테스트·웹)에서는 모두 빈 값 */
export interface NotifyItem { t: number; p: string; x: string }

interface Native {
  notifyAccessEnabled(): boolean;
  openNotifyAccessSettings(): boolean;
  peekNotifyQueue(): string;
  clearNotifyQueue(): void;
}
const native = (): Native | null => {
  try { return requireNativeModule<Native>('AssistantShare'); } catch { return null; }
};

export const notifyAccessEnabled = (): boolean => { try { return native()?.notifyAccessEnabled() ?? false; } catch { return false; } };
export const openNotifyAccessSettings = (): boolean => { try { return native()?.openNotifyAccessSettings() ?? false; } catch { return false; } };
export const clearNotifyQueue = (): void => { try { native()?.clearNotifyQueue(); } catch { /* 무시 */ } };

/** 대기열 JSON → 항목 (깨진 값은 건너뜀) */
export function parseQueue(json: string | null | undefined): NotifyItem[] {
  try {
    const v = JSON.parse(json ?? '[]');
    if (!Array.isArray(v)) return [];
    return v.filter((o) => o && typeof o.x === 'string' && o.x.trim()).map((o) => ({ t: Number(o.t) || 0, p: String(o.p ?? ''), x: o.x as string }));
  } catch { return []; }
}
export const peekNotifyQueue = (): NotifyItem[] => { try { return parseQueue(native()?.peekNotifyQueue()); } catch { return []; } };

/** 문자 가져오기 화면에 그대로 넣을 글: 알림 한 건을 한 줄 문단으로, 오래된 것부터 */
export function queueToText(items: NotifyItem[]): string {
  return [...items].sort((a, b) => a.t - b.t).map((i) => i.x.trim()).join('\n\n');
}

/** 검토 대기 중인 알림 건수 (앱이 앞으로 올 때마다 갱신) */
export function useNotifyCount(): { count: number; refresh: () => void } {
  const [count, setCount] = useState(0);
  const refresh = useCallback(() => setCount(peekNotifyQueue().length), []);
  useEffect(() => {
    refresh();
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') refresh(); });
    return () => sub.remove();
  }, [refresh]);
  return { count, refresh };
}
