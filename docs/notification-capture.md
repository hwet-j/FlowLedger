# 알림 자동 입력 (설계 — 미구현)

은행·카드 앱의 결제/입출금 알림을 읽어 "새 거래 초안"으로 만드는 기능의 설계 메모입니다. **이번 버전에는 넣지 않았고**, 같은 목적을 위해 승인·입출금 **문자 붙여넣기**(`더보기 > 거래 가져오기`)와 비서 앱에 문자·사진을 보내는 방법을 제공합니다. 알림 텍스트도 붙여넣으면 같은 파서(`src/lib/import/sms.ts`)로 읽힙니다.

## 구현하려면
- `modules/notification-capture`(로컬 Expo 모듈, Kotlin): `NotificationListenerService` 를 구현해 허용한 앱 패키지(예: 은행·카드 앱, 카카오페이, 토스)의 알림 `title`/`text`/`bigText` 를 받아 SQLite 의 `pending_captures(id, ts, package, text, handled)` 에 저장.
- 권한 안내 화면: 설정 > 알림 접근(`ACTION_NOTIFICATION_LISTENER_SETTINGS`)으로 보내고, 허용 앱 목록(기본 비어 있음)과 켜기/끄기(기본 꺼짐)를 앱에서 관리. 데이터는 기기 밖으로 나가지 않음.
- 앱이 앞으로 오면 `pending_captures` 를 `parseSms` 로 읽어 가져오기 미리보기(분류·중복 감지·내부 이동 후보)에 넣고, 사용자가 확인한 것만 저장(`source_ref` 는 `imp:` 규칙과 같은 멱등 키).
- 주의: 알림 접근은 민감 권한이라 기본 꺼짐, 허용 앱 외 알림은 즉시 버리고 저장하지 않으며, 다른 포크가 DB 계층(`modules/`)을 바꾸는 중이라 그 작업이 끝난 뒤에 붙이는 것이 안전합니다.
