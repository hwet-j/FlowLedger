#!/usr/bin/env bash
# CI 에뮬레이터(root 가능한 google_apis 이미지)에서 앱의 네이티브 DB 를 실제로 검증한다.
#  1) 첫 실행: DB 생성·시드·마이그레이션, 저널 모드, 무결성
#  2) 예전 expo-sqlite 가 만든 WAL 파일(+ -wal 에 남은 기록)을 이어서 열기
#  3) 손상된 파일: 지우지 않고 보존하고 새로 시작
#  4) 비서 제공자: 호출자가 비서가 아니면 forbidden, ping 은 DB 를 열지 않음
set -u
PKG=com.hwetj.flowledger
APK=${APK:-android/app/build/outputs/apk/release/app-release.apk}
DB=/data/data/$PKG/files/SQLite/flowledger.db
fail=0
ok()  { echo "PASS  $*"; }
bad() { echo "FAIL  $*"; fail=$((fail+1)); }
sql() { adb shell "sqlite3 $DB \"$1\"" 2>&1 | tr -d '\r'; }
launch() { adb shell am force-stop $PKG; adb shell monkey -p $PKG -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1; }
wait_for() { # 조건(명령)이 참이 될 때까지 최대 $1 초
  local t=$1; shift
  for _ in $(seq 1 "$t"); do if eval "$@" >/dev/null 2>&1; then return 0; fi; sleep 1; done; return 1
}

adb wait-for-device
adb root >/dev/null 2>&1; sleep 3; adb wait-for-device
adb install -r "$APK" >/dev/null 2>&1 && ok "install" || { bad "install"; exit 1; }
adb logcat -c

# ---------- 1) 첫 실행
launch
if wait_for 120 '[ "$(sql "select count(*) from accounts;")" = "1" ]'; then ok "first run: DB 생성·시드"; else bad "first run: DB 가 만들어지지 않음 ($(sql 'select count(*) from accounts;'))"; fi
cats=$(sql "select count(*) from categories;"); [ "${cats:-0}" -ge 30 ] 2>/dev/null && ok "categories seeded ($cats)" || bad "categories seeded: $cats"
[ "$(sql 'pragma user_version;')" = "3" ] && ok "user_version=3" || bad "user_version: $(sql 'pragma user_version;')"
jm=$(sql "pragma journal_mode;"); [ "$jm" = "delete" ] && ok "journal_mode=delete" || bad "journal_mode: $jm"
[ "$(sql 'pragma integrity_check;')" = "ok" ] && ok "integrity_check" || bad "integrity_check: $(sql 'pragma integrity_check;')"
tables=$(sql "select group_concat(name) from sqlite_master where type='table' and name in ('transactions','transaction_items','account_rules','budgets','recurring','kv');")
echo "tables: $tables"
for t in transactions transaction_items account_rules budgets recurring kv; do echo "$tables" | grep -q "$t" || bad "table missing: $t"; done

# ---------- 2) 예전 WAL 파일 이어서 열기 (expo-sqlite 가 남긴 상태를 흉내)
adb shell am force-stop $PKG; sleep 2
sql "pragma journal_mode=WAL;" >/dev/null
sql "insert into kv(key,value) values('wal_probe','1');" >/dev/null
adb shell "ls $DB-wal" >/dev/null 2>&1 && ok "WAL 상태 준비" || echo "note: -wal 파일 없음(체크포인트됨)"
launch
if wait_for 60 '[ "$(sql "select value from kv where key='"'"'wal_probe'"'"';")" = "1" ]'; then ok "WAL 파일의 기록이 유지됨"; else bad "WAL 기록 유실"; fi
sleep 5
jm=$(sql "pragma journal_mode;"); [ "$jm" = "delete" ] && ok "WAL → delete 로 되돌림" || bad "WAL 이 남아 있음: $jm"

# ---------- 3) 손상 복구
adb shell am force-stop $PKG; sleep 2
adb shell "dd if=/dev/urandom of=$DB bs=1 count=200 seek=0 conv=notrunc" >/dev/null 2>&1
adb shell "rm -f $DB-wal $DB-shm $DB-journal"
launch
if wait_for 120 'adb shell "ls /data/data/$PKG/files/SQLite/" | grep -q "flowledger.db.corrupt-"'; then ok "손상 파일 보존"; else bad "손상 파일이 보존되지 않음"; fi
if wait_for 60 '[ "$(sql "select count(*) from accounts;")" = "1" ]'; then ok "손상 후 새 DB 시드"; else bad "손상 후 새 DB 없음"; fi

# ---------- 4) 비서 제공자 (셸은 비서가 아니므로 forbidden 이어야 한다)
out=$(adb shell content call --uri content://com.hwetj.flowledger.assistant --method ping 2>&1 | tr -d '\r')
echo "ping(shell): $out"
echo "$out" | grep -qi "forbidden" && ok "provider: 허용되지 않은 호출자는 forbidden" || bad "provider: $out"
out=$(adb shell content call --uri content://com.hwetj.flowledger.assistant --method query 2>&1 | tr -d '\r')
echo "$out" | grep -qi "forbidden" && ok "provider: query 도 forbidden" || bad "provider query: $out"

# ---------- 크래시·손상 흔적
sleep 3
if adb logcat -d | grep -E "FATAL EXCEPTION|VerifyError|disk image is malformed" | head -5 | grep -q .; then
  bad "logcat 에 크래시/손상 흔적"; adb logcat -d | grep -E "FATAL EXCEPTION|VerifyError|disk image is malformed" | head -20
else ok "logcat: 크래시·손상 없음"; fi
mkdir -p emu-out; adb logcat -d > emu-out/logcat.txt 2>&1 || true
echo "RESULT fail=$fail"
[ "$fail" = "0" ]
