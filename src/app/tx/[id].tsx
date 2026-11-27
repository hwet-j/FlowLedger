import { Stack, useLocalSearchParams } from 'expo-router';
import React from 'react';

import { TxForm } from '../../components/TxForm';
import { Empty } from '../../components/ui';
import { useLedger } from '../../store';

export default function EditTx() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { ready, txs } = useLedger();
  const t = txs.find((x) => x.id === id);
  if (!ready) return null;
  if (!t) return <><Stack.Screen options={{ title: '내역' }} /><Empty title="내역을 찾을 수 없어요" hint="이미 삭제됐을 수 있어요." /></>;
  return <TxForm key={t.id} edit={t} />;
}
