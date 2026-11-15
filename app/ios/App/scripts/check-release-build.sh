#!/bin/sh
# Xcode build phase "Check the Release build" (App target). It runs in every
# build and checks only the Release configuration (an archive): it stops a
# bundle that must not go to the App Store.
#   - the web bundle has the publik test hooks (PUBLIK_TEST_HOOKS=1);
#   - the web bundle offers the Claude subscription token (APP_STORE_BUILD=0);
#   - the web bundle uses the dev app token (no VITE_PUBLIK_APP_TOKEN);
#   - the web bundle has no publik gate (PUBLIK_GATE_MODE=optional): the App
#     Store app always asks for Sign in with publik first;
#   - the Swift code has the PUBLIK_TEST_HOOKS flag.
# The web bundle writes lunara-build.json (app/src/lib/buildCheck.ts); `pnpm
# native:sync` copies it to App/public. CI also runs this file directly.
set -eu

[ "${CONFIGURATION:-}" = "Release" ] || exit 0

INFO="${SRCROOT:?}/App/public/lunara-build.json"
fail() {
  echo "error: Lunara release check: $1"
  exit 1
}

[ -f "$INFO" ] || fail "No web bundle ($INFO). Run 'pnpm native:sync' in app/ first."
grep -q '"testHooks":false' "$INFO" || fail "The web bundle has the publik test hooks. Build it again without PUBLIK_TEST_HOOKS=1."
grep -q '"claudeTokenOnIos":false' "$INFO" || fail "The web bundle offers the Claude subscription token (APP_STORE_BUILD=0). Build it again without APP_STORE_BUILD=0."
grep -q '"appToken":"env"' "$INFO" || fail "The web bundle uses the dev publik app token. Put VITE_PUBLIK_APP_TOKEN in app/.env.native, then run 'pnpm native:sync'."
grep -q '"gateMode":"required"' "$INFO" || fail "The web bundle has no publik gate (PUBLIK_GATE_MODE=optional). Build it again without PUBLIK_GATE_MODE=optional."
case " ${SWIFT_ACTIVE_COMPILATION_CONDITIONS:-} " in
  *" PUBLIK_TEST_HOOKS "*) fail "The Swift code has the PUBLIK_TEST_HOOKS flag." ;;
esac
echo "Lunara release check: ok"
