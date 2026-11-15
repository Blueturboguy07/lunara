#!/usr/bin/env bash
# iOS simulator: the sign-in sheet closes by itself after the claim (CI only).
#
# The test-hooks app points at a fake publik on this computer (fake-publik.mjs). With
# PUBLIK_TEST_SIGN_IN=1 the gate presses "Sign in with publik" once by itself, so the
# claim page opens in SFSafariViewController. The fake publik says "claimed" 20 s after
# the page opened (the sheet covers the web view all that time). The test passes when:
#   - the app prints "publik sheet: closed by the app" no more than 5 s after "claimed";
#   - the app prints "publik sign-in test: passed" (the gate let the person in);
#   - nobody closed the sheet by hand.
# Needs UDID (a booted iPhone simulator) and APP (the built test-hooks App.app).
set -euo pipefail

: "${UDID:?UDID of a booted simulator}"
: "${APP:?path of the built App.app}"
OUT="${RUNNER_TEMP:-/tmp}"
FAKE_LOG="$OUT/fake-publik.log"
APP_LOG="$OUT/sheet-test.log"
BUNDLE=app.lunara.mobile
mask() { sed -E 's/(pk|pat|pbt)_[A-Za-z0-9_-]{4,}/\1_[masked]/g; s/(Bearer )[^ "]+/\1[masked]/g'; }

CLAIM_AFTER_MS=20000 node "$(dirname "$0")/fake-publik.mjs" > "$FAKE_LOG" 2>&1 &
FAKE=$!
trap 'kill "$FAKE" 2>/dev/null || true' EXIT
for _ in $(seq 1 40); do
  if curl -s -o /dev/null http://localhost:8787/health; then break; fi
  sleep 0.25
done

# A clean start: no app data and no key from the self-test run (the Keychain outlives the app).
xcrun simctl terminate "$UDID" "$BUNDLE" 2>/dev/null || true
xcrun simctl uninstall "$UDID" "$BUNDLE" 2>/dev/null || true
xcrun simctl keychain "$UDID" reset 2>/dev/null || true
xcrun simctl install "$UDID" "$APP"

: > "$APP_LOG"
echo "Launch: $(date -u +%T)"
SIMCTL_CHILD_PUBLIK_API_BASE_URL=http://localhost:8787/api/v1 \
SIMCTL_CHILD_PUBLIK_TEST_SIGN_IN=1 \
SIMCTL_CHILD_DO_NOT_TRACK=1 \
  xcrun simctl launch --console-pty --terminate-running-process "$UDID" "$BUNDLE" > "$APP_LOG" 2>&1 &
LAUNCH=$!

asked=no
for _ in $(seq 1 240); do
  if [ "$asked" = no ] && grep -a -q 'publik sheet: opened' "$APP_LOG"; then
    # The sheet is open: start the 20-second claim clock even if the page itself is slow to load.
    curl -s -o /dev/null -X POST http://localhost:8787/test/claim-later || true
    asked=yes
  fi
  if grep -a -q 'publik sign-in test:' "$APP_LOG"; then break; fi
  sleep 0.5
done
sleep 1
kill "$LAUNCH" 2>/dev/null || true
xcrun simctl terminate "$UDID" "$BUNDLE" 2>/dev/null || true
tr -d '\r' < "$APP_LOG" > "$APP_LOG.txt"

stamp() { sed -n "s/.*$1.* at=\([0-9][0-9]*\).*/\1/p" "$2" | head -n 1; }
OPENED=$(stamp 'publik sheet: opened' "$APP_LOG.txt")
CLAIMED=$(stamp 'fake-publik: claimed' "$FAKE_LOG")
CLOSED=$(stamp 'publik sheet: closed by the app' "$APP_LOG.txt")
BY_HAND=$(grep -a -c 'publik sheet: closed by hand' "$APP_LOG.txt" || true)
PASSED=$(grep -a -m1 '^publik sign-in test: passed' "$APP_LOG.txt" || true)

echo "fake publik:"
mask < "$FAKE_LOG" | sed 's/^/  /'
echo "app lines:"
grep -a -E '^publik (sheet|sign-in test)' "$APP_LOG.txt" | mask | sed 's/^/  /' || true

fail() {
  echo "::error::$1"
  echo "App output (last 60 lines):"
  tail -n 60 "$APP_LOG.txt" | mask
  exit 1
}
[ -n "$OPENED" ] || fail "The app did not open the sign-in sheet."
[ -n "$CLAIMED" ] || fail "The fake publik never said claimed."
[ -n "$CLOSED" ] || fail "The sheet did not close by itself after the claim."
[ "${BY_HAND:-0}" = 0 ] || fail "The sheet was closed by hand; the test needs it to close by itself."
DELAY=$((CLOSED - CLAIMED))
OPEN_FOR=$((CLOSED - OPENED))
echo "The sheet was open for ${OPEN_FOR} ms. It closed ${DELAY} ms after publik said claimed."
[ "$DELAY" -ge 0 ] && [ "$DELAY" -le 5000 ] || fail "The sheet closed ${DELAY} ms after the claim (limit: 0 to 5000 ms)."
[ -n "$PASSED" ] || fail "The gate did not let the person in after the claim."
echo "$PASSED"
