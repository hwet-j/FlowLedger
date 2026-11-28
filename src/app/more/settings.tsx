import * as LocalAuthentication from 'expo-local-authentication';
import * as Notifications from 'expo-notifications';
import React from 'react';
import { Alert, ScrollView, Switch, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Card, Row } from '../../components/ui';
import { useLedger } from '../../store';
import { useTheme } from '../../theme';

export default function SettingsScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { settings, setSetting } = useLedger();

  const toggleLock = async (on: boolean) => {
    if (!on) { await setSetting('appLock', false); return; }
    const level = await LocalAuthentication.getEnrolledLevelAsync();
    if (level === LocalAuthentication.SecurityLevel.NONE) {
      Alert.alert('기기 잠금이 없어요', '휴대폰 설정에서 화면 잠금(PIN·패턴·지문 등)을 먼저 설정해 주세요.');
      return;
    }
    const r = await LocalAuthentication.authenticateAsync({ promptMessage: '앱 잠금을 켜려면 인증해 주세요', cancelLabel: '취소' });
    if (r.success) await setSetting('appLock', true);
  };

  const toggleAlerts = async (on: boolean) => {
    if (on) {
      const p = await Notifications.requestPermissionsAsync();
      if (!p.granted) Alert.alert('알림 권한이 꺼져 있어요', '권한을 허용해야 예산 알림을 받을 수 있어요. 휴대폰 설정에서 허용해 주세요.');
    }
    await setSetting('budgetAlerts', on);
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: insets.bottom + 40 }}>
      <Card>
        <Row icon="lock-closed" label="앱 잠금" sub="앱을 열 때 지문·얼굴·기기 잠금으로 확인해요" right={<Switch value={settings.appLock} onValueChange={toggleLock} trackColor={{ true: t.primary }} />} last />
      </Card>
      <Text style={{ color: t.sub, lineHeight: 19, paddingHorizontal: 4 }}>
        앱 잠금은 이 앱 화면만 보호해요. 비서 앱을 통한 기록·조회는 앱을 열지 않고 동작하므로 잠금과 별개로 계속 쓸 수 있어요. (비서 앱은 이 앱의 연동 허용 목록에 있는 비서만 접근해요)
      </Text>
      <Card>
        <Row icon="notifications" label="예산 알림" sub="월 예산의 80%, 100%에 도달하면 알려줘요" right={<Switch value={settings.budgetAlerts} onValueChange={toggleAlerts} trackColor={{ true: t.primary }} />} last />
      </Card>
      <Text style={{ color: t.sub, lineHeight: 19, paddingHorizontal: 4 }}>
        알림은 이 앱이 내역을 읽는 시점(앱을 열 때, 직접 입력할 때)에 확인해서 보내요. 비서가 앱 밖에서 기록한 내역은 앱을 다시 열 때 반영돼요.
      </Text>
      <Card>
        <Row icon="home" label="월세 입금 자동 반영" sub="LeaseLog 에 저장한 월세 입금(최근 3개월)을 수입으로 자동 기록해요. 이미 반영한 건은 다시 넣지 않아요" right={<Switch value={settings.rentSync} onValueChange={(on) => void setSetting('rentSync', on)} trackColor={{ true: t.primary }} />} last />
      </Card>
    </ScrollView>
  );
}
