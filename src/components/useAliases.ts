import { useCallback, useEffect, useState } from 'react';

import { getDb } from '../db';
import { loadAliases, mergeMerchants } from '../db/insightsRepo';
import { useLedger } from '../store';

/** 가맹점 별칭(합치기) 로드·저장. 거래가 바뀌어도(포그라운드 복귀 등) 다시 읽는다 */
export function useAliases() {
  const { txs } = useLedger();
  const [aliases, setAliases] = useState<Map<string, string>>(new Map());
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let alive = true;
    getDb().then(loadAliases).then((m) => { if (alive) setAliases(m); }).catch(() => {});
    return () => { alive = false; };
  }, [version, txs.length]);
  const merge = useCallback(async (names: string[], canonical: string) => {
    const db = await getDb();
    await mergeMerchants(db, names, canonical);
    setVersion((v) => v + 1);
  }, []);
  return { aliases, merge };
}
