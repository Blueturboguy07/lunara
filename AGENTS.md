# Lunara: notes for coding agents

## publik API
- Base URL: https://publikhq.com/api/v1 (OpenAI Chat Completions, Responses, Anthropic Messages)
- Models: publik-fast, publik-balanced, publik-smart only; never a vendor model name
- Key: per-install `pk_` from POST /installs, stored in the iOS Keychain / Android Keystore vault (`publik-api-key`), never in the cycle database or a backup; the test-build-only launch value PUBLIK_API_BASE_URL points the app at a fake publik on 127.0.0.1, localhost or 10.0.2.2
- App token: VITE_PUBLIK_APP_TOKEN at build time (CI and release.yml: the PUBLIK_APP_TOKEN repo secret; the workflows fail when it is empty). `PUBLIK_DEV_APP_TOKEN` in `app/src/lib/publikBuild.ts` is a real token, the fallback for development and test builds only
- 402: show error.message plus error.top_up_url only
- Never print or log a key
- Docs: https://publikhq.com/llms.txt, https://publikhq.com/developers, https://publikhq.com/skills/api.md

## Sign in with publik
- The gate is `PublikGate` (`app/src/components/PublikGate.tsx`), which calls `ensureSignedIn()` from the module `app/src/lib/publik.ts` before onboarding, the PIN lock and the tabs. Keep the gate words in the module exactly as they are.
- "Use my own key" (bring your own key) must keep working: the Anthropic and OpenAI provider paths stay.
- Telemetry sends only `app_opened` and `active_session`. Never add health data or cycle data to it.
- Test builds: `.github/workflows/mobile-test-builds.yml`. Do not build locally on the maintainer's Mac.
- Build settings live in `app/src/lib/buildFlags.ts`: `PUBLIK_GATE_MODE` (`required` default, `optional`), `APP_STORE_BUILD` (no Claude subscription-token option; default on in the iOS app, `0` turns it off) and `PUBLIK_TEST_HOOKS` (`1`: a test build with the publik test hooks). Add no other switch. `app/src/lib/buildCheck.ts` lists what `vite build` refuses.
- The test hooks (PUBLIK_API_BASE_URL, PUBLIK_SELF_TEST) need PUBLIK_TEST_HOOKS in the web bundle AND the native build (Android `-PpublikTestHooks=true`, iOS `PUBLIK_TEST_HOOKS=YES`). Never read them from an Android link (VIEW / BROWSABLE intent), never in a release build.
- Every sign-out path calls `disconnectPublik()` or `deletePublikDataOnThisPhone()`: the phone forgets first, then revokes; telemetry stops; required mode returns to the gate. Do not add another sign-out path.
- AI is for adults only: `isAdultBirthYear()` (current year minus birth year 19 or more). Chat history never goes to a provider that did not receive it (`lib/chatHistory.ts`).
- The version and build number come from `app/package.json`; iOS copies them in `app/ios/App/Lunara.xcconfig` (`src/lib/nativeVersion.test.ts` checks). Each target has a `PrivacyInfo.xcprivacy`: update it when native code uses a new required-reason API or sends new data.
- Before Lunara AI sends a tracker category to a provider for the first time, `lib/healthConsent.ts` asks. Never send health data without that answer.
