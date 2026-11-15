# Lunara: notes for coding agents

## publik API
- Base URL: https://publikhq.com/api/v1 (OpenAI Chat Completions, Responses, Anthropic Messages)
- Models: publik-fast, publik-balanced, publik-smart only; never a vendor model name
- Key: per-install `pk_` from POST /installs, stored in the iOS Keychain / Android Keystore vault (`publik-api-key`), never in the cycle database or a backup; the test-build-only launch value PUBLIK_API_BASE_URL points the app at a fake publik on 127.0.0.1, localhost or 10.0.2.2
- App token: VITE_PUBLIK_APP_TOKEN at build time (CI and release.yml: the PUBLIK_APP_TOKEN repo secret; the workflows fail when it is empty). `PUBLIK_DEV_APP_TOKEN` in `app/src/lib/publikBuild.ts` is a real token, the fallback for development and test builds only
- No amount of money for AI use anywhere in the app (founder rule, Nov 14 2026): AI use shows only as a percent of the plan limit with a bar (`publikStatusLine` / `PlanUseMeter`), or "Plan active" / "Plan limit reached". Never show a server text that names money (`withoutMoney`). `app/src/lib/noMoneyShown.test.ts` fails when an app file has "$" followed by a digit.
- 402 / plan limit: the app's own words (`planLimitText`: limit reached, when it resets, the storefront rule, "use your own key") plus error.top_up_url only on the US App Store storefront (below)
- When publik sends no claim_url, open nothing: show "publik sent no sign-in link. Try again."
- App Store rule 1.2: every AI answer has "Report this answer". The person picks a reason in the app; the in-app sheet opens `publikSupportUrl({ reason })` (`/in-app/support?app=lunara&topic=ai-answer&reason=<id>`). Never put chat text or health data in that URL. The chat note says AI answers can be wrong and are not medical advice (`AI_ANSWER_NOTE`).
- Settings → publik → Help and support opens `publikSupportUrl()` (`/in-app/support?app=lunara`).
- App Store rule 5.1.2(i): the publik agreement text names publik (publikhq.com) and the AI provider that answers (`PUBLIK_PROVIDER_EXAMPLES`). When the wallet or the install answer lists the true providers, show that list instead.
- The store build has no local-network permission (no NSLocalNetworkUsageDescription): no screen lets a person enter a local AI address.
- Never print or log a key
- Docs: https://publikhq.com/llms.txt, https://publikhq.com/developers, https://publikhq.com/skills/api.md

## Sign in with publik
- The gate is `PublikGate` (`app/src/components/PublikGate.tsx`), which calls `ensureSignedIn()` from the module `app/src/lib/publik.ts` before onboarding, the PIN lock and the tabs. Keep the gate words in the module exactly as they are.
- "Use my own key" (bring your own key) must keep working: the Anthropic and OpenAI provider paths stay.
- Telemetry sends only `app_opened` and `active_session`. Never add health data or cycle data to it.
- Test builds: `.github/workflows/mobile-test-builds.yml`. Do not build locally on the maintainer's Mac.
- Build settings live in `app/src/lib/buildFlags.ts`: `PUBLIK_GATE_MODE` (`required` default, `optional` for test builds only: a release build and an Xcode Release archive refuse it, so the App Store app always has the gate), `APP_STORE_BUILD` (no Claude subscription-token option; default on in the iOS app, `0` turns it off) and `PUBLIK_TEST_HOOKS` (`1`: a test build with the publik test hooks). Add no other switch. `app/src/lib/buildCheck.ts` lists what `vite build` refuses.
- The test hooks (PUBLIK_API_BASE_URL, PUBLIK_SELF_TEST) need PUBLIK_TEST_HOOKS in the web bundle AND the native build (Android `-PpublikTestHooks=true`, iOS `PUBLIK_TEST_HOOKS=YES`). Never read them from an Android link (VIEW / BROWSABLE intent), never in a release build.
- Every sign-out path calls `disconnectPublik()` or `deletePublikDataOnThisPhone()`: the phone forgets first, then revokes; telemetry stops; required mode returns to the gate. Do not add another sign-out path.
- AI is for adults only: `isAdultBirthYear()` (current year minus birth year 19 or more). Chat history never goes to a provider that did not receive it (`lib/chatHistory.ts`).
- The version and build number come from `app/package.json`; iOS copies them in `app/ios/App/Lunara.xcconfig` (`src/lib/nativeVersion.test.ts` checks). Each target has a `PrivacyInfo.xcprivacy`: update it when native code uses a new required-reason API or sends new data.
- Purchase links follow the App Store storefront (`lib/storefront.ts`): US storefront (`USA`) = "Get a plan", top-up links and prices as built; every other storefront, or an unknown one (also Android and the browser) = no purchase link, no purchase button, no price, and the text 'To get a plan, search for "publik" on Google.' "Connect your plan" and "Use my own key" stay everywhere.
- The app name is "publik Lunara" (`lib/appName.ts`); the label under the icon stays "Lunara". Keep the bundle ID, the package and the URL scheme `app.lunara.mobile`.
- Do not name or point to any other app in code comments or UI. Platform integrations (Apple Health, Health Connect) and AI providers are not apps in this sense.
- AI chat is optional. Without it, health and cycle data stays on the phone. Before AI chat sends anything to a provider (also with no category ticked), `lib/healthConsent.ts` shows "AI chat is optional" and waits for "Turn on AI chat"; "Not now" closes AI chat and sends nothing. A new provider or a newly ticked category asks again. Never send a message or health data without that answer.
- AI chat data is anonymized entirely. Only `makeAiPayload()` in `lib/aiPayload.ts` makes what a provider receives (the sender takes only its branded `AiPayload` type), for publik API and for an own key. No name, email, birth date, location, device or account ID, no tracker notes or other free text (only what the person typed into the chat), and days relative to today, never a calendar date. The publik install key stays in the Authorization header, for billing only. `lib/aiPayload.test.ts` fails when an identifier or a calendar date reaches the request.
- The agreement screen lists exactly what is sent. The numbers live in `lib/aiLimits.ts`, and `lib/aiPayload.test.ts` compares the screen words with the limits. If you change what a message sends, change the screen words in the same commit.
- Every privacy claim uses `DATA_STAYS_ON_PHONE` ("Your data stays on this phone unless you turn on AI chat or encrypted backup."). Never write that data never leaves the phone.
