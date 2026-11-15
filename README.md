# Lunara

> **⚠️ Unfinished — this is a work in progress.**
> Lunara is not on the App Store or Google Play, and there is no installer to
> double-click. You build it from this repository and run it on your own phone.
> Features are landing continuously and things will break. Do not rely on it as
> your only record of your health data.

**An open-source, local-first cycle, fertility, pregnancy, and perimenopause companion.**

Lunara ships through native iOS and Android shells powered by Capacitor. Your
data stays on this phone unless you turn on AI chat or encrypted backup. There
is no Lunara-hosted database of your health data. AI chat is optional. It sends
data only after you turn it on (see "AI chat is optional" below), and it sends
an anonymized summary, never your name, email or birth date. Encrypted backup
sends a copy that the backup server cannot read.

The App Store name and the name inside the app is **publik Lunara**. The label
under the icon stays **Lunara**, because a home screen cuts a longer label short
(`app/src/lib/appName.ts`). The bundle ID, the package and the URL scheme stay
`app.lunara.mobile`.

Lunara is an open-source cycle tracker that keeps your health data on your own
phone. It has no ads, does not sell data, and you can read every line of its code.

## Why

- **No subscription gate.** Tracking, pattern insights, reports, pregnancy
  guidance, and perimenopause tools are part of the open-source app.
- **Local first by architecture.** Core logs live in the app's local storage.
  Optional backup stores a client-encrypted blob. Optional AI chat sends your
  messages and an anonymized summary of only the tracker categories you tick,
  after you turn it on.
- **No 54-screen onboarding funnel. No paywall gauntlet. No nagging.**

---

## Getting Lunara onto your phone

### Android — download the APK directly

The easiest way to get Lunara on an **Android** phone is to download the
pre-built APK from [GitHub Releases](https://github.com/Blueturboguy07/lunara/releases/latest):

1. On your phone, open the Releases page and tap the `.apk` file to download it.
2. Go to **Settings → Install unknown apps** and allow your browser or file
   manager to install APKs.
3. Open the downloaded `.apk` and tap **Install**.

> Verify the download against `SHA256SUMS.txt` in the same release if you want
> to confirm file integrity before installing.

### Build from source

If you want to compile the app yourself (required for iPhone, or if you want to
modify the code), you will need a computer. **What you need depends on the phone
you have:**

| Your phone | Your computer | Works? | What you'll use |
| --- | --- | --- | --- |
| iPhone | Mac | ✅ | Xcode |
| Android | Mac | ✅ | Android Studio |
| Android | Windows | ✅ | Android Studio |
| iPhone | Windows | ❌ | Not possible — see below |

**iPhone + Windows is not possible.** Apple only allows iOS apps to be built and
signed on macOS with Xcode; there is no supported Windows path, and no amount of
setup works around it. Your options are to borrow a Mac, or run Lunara as a web
app in your phone's browser (`pnpm dev`, then open the printed network URL on
your phone) — the browser version keeps your data on the phone but has no
widgets, notifications, or Health integration.

### 1. Install the shared prerequisites

You need [Git](https://git-scm.com/downloads), [Node.js LTS](https://nodejs.org/en/download),
and pnpm. With Node installed:

```sh
npm install -g pnpm
```

### 2. Get the code and build the web bundle

```sh
git clone https://github.com/Blueturboguy07/lunara.git
cd lunara
pnpm install
pnpm --filter @lunara/app native:sync
```

`native:sync` type-checks, builds the web bundle, and copies it into the native
iOS and Android projects. **Re-run it after every code change** — the native
shells load a copied bundle, not your live source.

**AI assistant.** Lunara AI runs on **publik API** by default: no key needed.
It uses your publik plan. The app never shows an amount of money for AI use.
It shows only the share of the plan limit you used, with a bar, for example
"62% of your plan used · resets Monday" (from `used_percent`,
`remaining_percent` and `resets_at` of `GET /api/v1/wallet`, else from the
week's used and limit values). When publik gives no limit, it shows "Plan
active" or "Plan limit reached" with no number. When the limit is reached, AI
chat says so in plain words, says when the plan resets, and offers "Use my own
key" (`app/src/lib/publikApi.ts`; `app/src/lib/noMoneyShown.test.ts` fails when
an app file has "$" followed by a digit). AI chat is optional and asks before it sends
anything. Then your question, the earlier messages in the chat and an anonymized
summary of the tracker categories you tick go through publik's servers to the AI
provider. publik does not store the content of your messages or answers, and
does not use it for ads, analytics, training, or sale. It keeps billing records
(model, token counts, cost) without content. Prefer your own provider? Pick Anthropic or OpenAI in AI
settings and paste your own key. Lunara keeps it in your phone's Keychain or
Keystore. Your messages then go straight from the phone to that provider, under
your own account with it, and publik never sees them. Building a private copy? Put
`VITE_PUBLIK_APP_TOKEN=pat_lunara_…` in `app/.env.native` before
`native:sync` (or in `app/.env.production` for `pnpm build`).

### 3a. iPhone (requires a Mac)

1. Install **Xcode** from the Mac App Store, then open it once so it finishes
   installing its components.
2. Open the iOS project:
   ```sh
   pnpm --filter @lunara/app native:ios
   ```
3. In Xcode, select the **App** target → **Signing & Capabilities**. Under
   *Team*, pick your Apple ID. A **free** Apple ID works — you do not need the
   $99/year Developer Program. If you have never added your Apple ID, use
   *Add an Account…* in the Team dropdown.
4. If Xcode reports the bundle identifier is unavailable, change it to something
   unique to you (for example `app.lunara.mobile.yourname`).
5. Plug in your iPhone, unlock it, and tap **Trust** if asked. Select it from the
   device dropdown at the top of the Xcode window.
6. Press **▶ Run**.
7. The first launch will fail with *"Untrusted Developer."* On your iPhone go to
   **Settings → General → VPN & Device Management**, tap your Apple ID, and tap
   **Trust**. Then open Lunara again.

> With a free Apple ID the app stops working after **7 days**. Re-run step 6 to
> renew it. A paid Developer Program account extends this to a year.

### 3b. Android (Mac or Windows)

1. Install [**Android Studio**](https://developer.android.com/studio). On first
   launch let it install the default SDK and platform tools.
2. On your phone, enable developer mode: **Settings → About phone**, tap
   **Build number** seven times. Then in **Settings → System → Developer
   options**, turn on **USB debugging**.
3. Open the Android project:
   ```sh
   pnpm --filter @lunara/app native:android
   ```
4. Plug in your phone and tap **Allow** on the USB-debugging prompt.
5. Pick your phone from the device dropdown in Android Studio and press **▶ Run**.

### If something goes wrong

- **`pnpm: command not found`** — Node's global bin isn't on your PATH. Close and
  reopen your terminal, then try again.
- **`cap: command not found`** — you skipped `pnpm install`, or ran the command
  from the wrong folder. Run it from the repository root.
- **Xcode "No account for team"** — you haven't picked a Team under Signing &
  Capabilities (step 3a.3).
- **Android Studio doesn't see your phone** — the cable is charge-only, or USB
  debugging is off. Try a different cable first; it is usually the cable.
- **Your changes don't show up** — re-run `pnpm --filter @lunara/app native:sync`.

## Structure

- `app/` — React/Vite product layer plus Capacitor iOS and Android projects
- `workers/backup/` — stateless zero-knowledge backup relay (Cloudflare Worker + R2)
- `workers/reminders/` — opt-in generic email reminders (no health terms, ever)
- `docs/NATIVE_ARCHITECTURE.md` — current runtime and platform design
- `docs/FEATURE_PARITY.md` — honest implementation and release-readiness map

## Develop

```sh
pnpm install
pnpm dev      # run the app in a browser
pnpm test     # engine unit tests
pnpm --filter @lunara/app native:sync
```

The cycle engine is covered by a seeded fuzz audit
(`app/src/engine/estimateAudit.test.ts`) that exercises every user-facing
estimate across 360 generated histories. It must stay at zero violations —
run `pnpm test` before touching any prediction math.

## The AI companion is optional, adults-only, and publik API by default

Lunara works fully without AI, and the companion is never offered under 18.
Lunara knows only the birth year, so the companion opens when the current year
minus the birth year is 19 or more (an 18-year-old born late in the year waits
until January 1).
When it is on, answers come from one of three places:

- **publik API** (default) — no key needed. The app mints its own per-phone
  key from publik on first launch, after you accept the disclosure, and keeps
  it in the iOS Keychain / Android Keystore. AI use counts against your publik
  plan and shows as a percent of the plan limit, never as money. Until the
  phone is linked (or you add your own key), the assistant says that the phone
  is not linked to a publik plan yet. Disconnect at any time from Settings.
- **Anthropic** — your own API key, or (not in the iOS app, which is an App
  Store build) a token from `claude setup-token` to bill answers to a Claude
  subscription.
- **OpenAI** — your own project API key. The OpenAI slot refuses an Anthropic
  key (`sk-ant-…`).

A chat goes to one provider only: when you change the provider or its base URL,
Lunara AI starts a new chat and sends none of the earlier messages to the new
provider.

Choosing publik never touches a key you pasted, and choosing your own key never
revokes the publik one. Credentials are stored in the Keychain / Keystore, never
in the cycle database and never in a backup. Nothing from your tracker is sent
unless you tick the specific categories for that message.

**For maintainers — the app token.** A build takes the app token from
`VITE_PUBLIK_APP_TOKEN` (`app/.env.native` for a local `native:sync`; the
`PUBLIK_APP_TOKEN` repo secret in CI, where every workflow fails when the
secret is empty). `vite build --mode native` fails when the value is not
`pat_lunara_` and 32 letters and digits. Without the value, a development or
test build uses `PUBLIK_DEV_APP_TOKEN` in `app/src/lib/publikBuild.ts`: a real,
minted token, committed as the fallback. A release never uses it: `release.yml`
fails without the secret, and an Xcode Release archive refuses a bundle built on
the fallback. The token can only mint rate-limited anonymous installs; it holds
no balance and reads nothing.

## Sign in with publik

Lunara opens with **Sign in with publik**, before onboarding, the PIN lock and
the tabs. The link opens publik's bare sign-in page in the in-app browser
(Safari view on iPhone, a Custom Tab on Android): the app adds `in_app=1` to the
`claim_url` from publik, and publik shows its in-app page with no site
navigation, footer, prices or plan links. On iPhone the in-app browser closes by
itself when the sign-in is done. While Lunara is in the foreground it checks the sign-in every
3 seconds; it stops in the background and checks again at once when you come
back. Then onboarding asks your age. After that, an adult picks **Get a plan**,
**Connect your plan** or **Use my own key** (a person under 18 never sees this
screen); "Use my own key" keeps the Anthropic / OpenAI paths above exactly as
they were. You can change the choice later in Settings → publik.

**Purchase links follow the App Store storefront** (`app/src/lib/storefront.ts`).
The iOS app reads the storefront country from StoreKit (`appStoreStorefront` in
`LunaraNativePlugin.swift`).

| Storefront | What the app shows |
|---|---|
| United States (`USA`) | **Get a plan**, the top-up links and the prices, as built. |
| Every other country, or unknown (no StoreKit answer, Android, a browser) | No purchase link, no purchase button, no price. The app says: To get a plan, search for "publik" on Google. |

**Connect your plan** and **Use my own key** stay on every storefront. The
Android app has no storefront reading, so it shows no purchase links.

Build settings (one environment value each at `pnpm build:native` time,
`src/lib/buildFlags.ts`):

| Setting | Values | Effect |
|---|---|---|
| `PUBLIK_GATE_MODE` | `required` (default), `optional` | `optional`: the tracker opens with no sign-in wall. Lunara asks for Sign in with publik (with "Not now") only when you open Lunara AI or tap Settings → publik → Sign in with publik. Usage counting starts only after sign-in. For test builds only: a release build (`LUNARA_RELEASE=1`) and an Xcode Release archive refuse `optional`, so the App Store app always has the gate. |
| `APP_STORE_BUILD` | unset (default), `1`, `0` | No Claude subscription-token (`claude setup-token`) option. Unset: on in the iOS app, off on Android and the web. `1`: on everywhere. `0`: off everywhere; an Xcode Release archive then fails. Anthropic and OpenAI API keys always work. |
| `PUBLIK_TEST_HOOKS` | unset (default), `1` | `1`: a test build. The two test hooks below work. A release build (`LUNARA_RELEASE=1`) refuses it. |

An Xcode Release build runs `app/ios/App/scripts/check-release-build.sh`: it
fails when the web bundle has the test hooks, offers the Claude
subscription token, uses the dev app token, or has no publik gate
(`PUBLIK_GATE_MODE=optional`).

The version and the build number come from `app/package.json` (`version`,
`buildNumber`). Android reads that file; iOS keeps the same values and the
display name (`APP_DISPLAY_NAME`) in `app/ios/App/Lunara.xcconfig`, and a test
fails when they differ.

- **Offline.** Only the first sign-in needs the network. After that, Lunara
  opens offline: when publik cannot be reached within 5 seconds, the app opens
  with the sign-in it already has. Your cycle data never depended on publik.
- **Usage counting.** After sign-in, Lunara tries to send only `app_opened` and
  `active_session`, with the app version, the phone OS and a random per-app ID.
  No health data, no cycle data, no notes, ever. Sign-out stops it. Turn it off
  in Settings → publik → Count my use, or launch with `DO_NOT_TRACK=1` /
  `PUBLIK_TELEMETRY=0`.
- **Sign-out.** Settings → publik → Sign out (and Disconnect publik API) first
  deletes the key and the publik settings on this phone and stops usage
  counting, then asks publik to revoke the key. In `required` mode the sign-in
  screen comes back at once.
- **Test hooks (test builds only).** They work only when the web bundle has
  `PUBLIK_TEST_HOOKS=1` and the native build has it too (Android: `./gradlew
  assembleDebug -PpublikTestHooks=true`, never a release build; iOS: a Debug
  build with `xcodebuild ... PUBLIK_TEST_HOOKS=YES`). The CI test builds have
  them; a release has neither. Android reads them only from a launcher start,
  never from a link.
  - `PUBLIK_API_BASE_URL` points the app at a fake publik on this computer
    (`127.0.0.1`, `localhost`, or `10.0.2.2` from the Android emulator). iOS
    simulator: `xcrun simctl launch <device> app.lunara.mobile
    -PUBLIK_API_BASE_URL http://127.0.0.1:8787/api/v1`; Android: `adb shell am
    start -a android.intent.action.MAIN -n app.lunara.mobile/.MainActivity --es
    PUBLIK_API_BASE_URL http://10.0.2.2:8787/api/v1`.
  - `PUBLIK_SELF_TEST=1` (iOS simulator: `SIMCTL_CHILD_PUBLIK_SELF_TEST=1`;
    Android: `--es PUBLIK_SELF_TEST 1`). The app prints `publik self-test: ok
    lunara <version>` after a real wallet check and exits. CI runs it in the iOS
    simulator and in an Android emulator.
- **Delete account.** Settings → Danger zone → Delete account says what is
  deleted (the publik account, for all publik apps), deletes Lunara's publik
  data on this phone, asks separately before it deletes cycle data, then opens
  publik's in-app deletion page (`https://publikhq.com/in-app/delete-account`)
  in the in-app browser. Settings → publik → Sign out signs this phone out and
  keeps your data. Settings → publik → Help and support opens
  `https://publikhq.com/in-app/support?app=lunara` in the in-app browser.
  Under each AI answer, "Report this answer" lets you pick a reason, then opens
  the same support page with only the app name and that reason. It sends no
  chat text and no health data. Settings → publik → publik privacy policy opens
  `https://publikhq.com/in-app/privacy` in the in-app browser. The in-app
  browser opens only these in-app pages; the US-storefront "Get a plan" and
  top-up links open the normal publik site.
- **AI chat is optional.** Without AI chat, your health and cycle data stays
  on this phone (an encrypted backup, if you turn it on, sends a copy that the
  backup server cannot read). Before the first AI chat message to a provider,
  Lunara shows the screen "AI chat is optional". On publik API it says: "To
  answer you, Lunara sends your question and an anonymized summary of your
  cycle data to publik (publikhq.com). publik sends it to the AI provider that
  answers (for example Anthropic, Google or OpenAI). It has no name, email or
  birth date. publik does not store the content of your messages or answers, and does not use it
  for ads, analytics, training, or sale. It keeps billing records (model, token
  counts, cost) without content. The AI provider processes your message to
  answer it, under its own terms." With your own key (Anthropic, OpenAI, or an
  OpenAI-compatible service) it says that the data goes straight to that
  provider under your own account, and publik never sees it. The screen lists
  what a message sends:
  - every time: your question and the earlier messages in the chat, up to 16
    messages, each cut at 6,000 characters. That is the only free text it sends;
  - an anonymized summary of the tracker categories you tick (cycle summary,
    symptoms and mood, fertility and intimacy). The cycle summary is ticked
    until you change it.
  One function, `app/src/lib/aiPayload.ts` (`makeAiPayload`), makes every AI
  request, for publik API and for your own key. It sends no name, email, birth
  date, location, device or account ID, and no notes. Days are relative to
  today ("cycle day 14", "3 days ago"); no calendar date is sent. Symptoms,
  moods and events go only when they are values from Lunara's own lists. The
  publik install key goes in the Authorization header, for billing only. Unit
  tests fail when a name, an email, a birth date or a calendar date reaches the
  request. "Turn on AI chat" sends. "Not now" closes AI chat and sends nothing.
  A new provider, or a newly ticked category, shows the screen again. Sign-out
  and Delete account end the agreement with publik. The numbers live in
  `app/src/lib/aiLimits.ts`; a test compares the screen with the request.
- **Test builds.** `.github/workflows/mobile-test-builds.yml` builds a debug
  APK (`android-debug-apk`) and two unsigned arm64 iOS simulator apps, both
  App Store builds: `ios-sim-app` (gate required) and `ios-sim-app-optional`
  (gate optional). Each runs the self-test in a simulator. It never releases.

## Disclaimer

Lunara is not a medical device and does not diagnose, treat, cure, or prevent any condition. Predictions are estimates for informational purposes only and must not be used to prevent pregnancy.

## License

AGPL-3.0 — see [LICENSE](LICENSE).
