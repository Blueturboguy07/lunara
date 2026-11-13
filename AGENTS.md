# Lunara: notes for coding agents

## publik API
- Base URL: https://publikhq.com/api/v1 (OpenAI Chat Completions, Responses, Anthropic Messages)
- Models: publik-fast, publik-balanced, publik-smart only; never a vendor model name
- Key: per-install `pk_` from POST /installs, stored in the iOS Keychain / Android Keystore vault (`publik-api-key`), never in the cycle database or a backup; the debug-only launch value PUBLIK_API_BASE_URL points the app at a test publik
- App token: `app/src/lib/publikBuild.ts` (public by design, committed) or VITE_PUBLIK_APP_TOKEN at build time (CI: the PUBLIK_APP_TOKEN repo secret)
- 402: show error.message plus error.top_up_url only
- Never print or log a key
- Docs: https://publikhq.com/llms.txt, https://publikhq.com/developers, https://publikhq.com/skills/api.md

## Sign in with publik
- The gate is `PublikGate` (`app/src/components/PublikGate.tsx`), which calls `ensureSignedIn()` from the module `app/src/lib/publik.ts` before onboarding, the PIN lock and the tabs. Keep the gate words in the module exactly as they are.
- "Use my own key" (bring your own key) must keep working: the Anthropic and OpenAI provider paths stay.
- Telemetry sends only `app_opened` and `active_session`. Never add health data or cycle data to it.
- Test builds: `.github/workflows/mobile-test-builds.yml`. Do not build locally on the maintainer's Mac.
