#!/usr/bin/env bash
# Android emulator (mobile-test-builds.yml): install the test APK, then run the
# publik self-test. The built app prints "publik self-test: ok lunara <version>"
# only after a real GET /wallet answers. Then check that a link (a VIEW intent)
# with the same extra does NOT start the self-test.
set -euo pipefail
APK="$1"
PKG=app.lunara.mobile

# Never print a publik key or token from a log.
mask() { sed -E 's/(pk|pat|pbt)_[A-Za-z0-9_-]{4,}/\1_[masked]/g; s/(Bearer )[^ "]+/\1[masked]/g'; }
self_test_line() { adb logcat -d -v raw -s publik:I 2>/dev/null | tr -d '\r' | grep -a -m1 '^publik self-test:' || true; }

adb install -r "$APK" > /dev/null
echo "Installed: $(date -u +%T)"

LINE=""
for attempt in 1 2; do
  adb logcat -c || true
  echo "Launch $attempt: $(date -u +%T)"
  adb shell am start -a android.intent.action.MAIN -c android.intent.category.LAUNCHER \
    -n "$PKG/.MainActivity" --es PUBLIK_SELF_TEST 1 --es DO_NOT_TRACK 1 > /dev/null
  for _ in $(seq 1 180); do
    LINE=$(self_test_line)
    if [ -n "$LINE" ]; then break; fi
    sleep 1
  done
  echo "Launch $attempt ended: $(date -u +%T)"
  if [ -n "$LINE" ]; then break; fi
  echo "No self-test line yet. Log:"
  adb logcat -d -v brief 2>/dev/null | grep -aiE "chromium|capacitor|publik|lunara|AndroidRuntime" | mask | tail -n 60 || true
  adb shell am force-stop "$PKG" || true
done
echo "self-test line: ${LINE:-<none>}"
case "$LINE" in
  "publik self-test: ok lunara "*) ;;
  *)
    echo "::error::The built Android app did not print 'publik self-test: ok lunara <version>'."
    adb logcat -d -v brief 2>/dev/null | mask | tail -n 150 || true
    exit 1
    ;;
esac

# A link never reaches the test hooks: the same extra on a VIEW intent prints no line.
adb shell am force-stop "$PKG" || true
adb logcat -c || true
adb shell am start -a android.intent.action.VIEW -c android.intent.category.BROWSABLE \
  -d "lunara://openrouter/callback" --es PUBLIK_SELF_TEST 1 "$PKG" > /dev/null
sleep 45
if [ -n "$(self_test_line)" ]; then
  echo "::error::A VIEW intent started the publik self-test."
  exit 1
fi
echo "VIEW intent: no self-test (as expected)"
adb shell am force-stop "$PKG" || true
