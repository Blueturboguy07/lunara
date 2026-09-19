# Lunara

> **⚠️ Unfinished — this is a work in progress.**
> Lunara is not on the App Store or Google Play, and there is no installer to
> double-click. You build it from this repository and run it on your own phone.
> Features are landing continuously and things will break. Do not rely on it as
> your only record of your health data.

**An open-source, local-first cycle, fertility, pregnancy, and perimenopause companion.**

Lunara ships through native iOS and Android shells powered by Capacitor. Core
tracking works without an account or Lunara-hosted user database. Optional
backup and AI features transmit data only after you enable them; their scope and
security boundaries are documented in the repository.

Lunara is an open-source alternative to Flo®. It is not affiliated with, endorsed by, or connected to Flo Health Inc.

## Why

- **No subscription gate.** Tracking, pattern insights, reports, pregnancy
  guidance, and perimenopause tools are part of the open-source app.
- **Local first by architecture.** Core logs live in the app's local storage.
  Optional backup stores a client-encrypted blob; optional AI shares only the
  categories you select for that request.
- **No 54-screen onboarding funnel. No paywall gauntlet. No nagging.**

---

## Getting Lunara onto your phone

There is no download. You compile the app on a computer and install it on your
own phone over a cable. **What you need depends on the phone you have:**

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

**AI assistant.** Lunara AI runs on **publik API** by default: no account and
no key, free starter usage to begin with, then every request is priced per use
at 50% of the model's published list price from your publik balance — the AI
model behind it is run by a provider that charges per use, publik passes that
on at half list, nothing is charged behind your back, and every call is visible
on your publik dashboard. Only your message and the tracker categories you tick
are sent, through publik's servers to a shared model account; publik never
trains on them and does not store them. Prefer your own provider? Pick
Anthropic or OpenAI in AI settings and paste your own key — it stays in your
phone's Keychain or Keystore. Building a private copy? Put
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
When it is on, answers come from one of three places:

- **publik API** (default) — no account, no key. The app mints its own
  per-phone key from publik on first launch, after you accept the disclosure,
  and keeps it in the iOS Keychain / Android Keystore. Free starter usage,
  then priced per use from your publik balance; link the phone at the claim
  link to pick a plan or add a pack. Disconnect at any time from Settings.
- **Anthropic** — your own API key, or a token from `claude setup-token` to
  bill answers to a Claude subscription.
- **OpenAI** — your own project API key.

Choosing publik never touches a key you pasted, and choosing your own key never
revokes the publik one. Credentials are stored in the Keychain / Keystore, never
in the cycle database and never in a backup. Nothing from your tracker is sent
unless you tick the specific categories for that message.

**For maintainers — the app token.** `app/src/lib/publikBuild.ts` carries the
build's public app token. In git it is the placeholder `pat_lunara_REPLACE_ME`,
which compiles and tests but hides the publik option; the publik-side mint
script (`scripts/mint-app-token.mts` in the publik repo) mints
`pat_lunara_<32 base36>` and writes it into that file in the same commit the
publik install guide then pins. The token is public by design: it can only
mint rate-limited anonymous installs; it holds no balance and reads nothing.

## Disclaimer

Lunara is not a medical device and does not diagnose, treat, cure, or prevent any condition. Predictions are estimates for informational purposes only and must not be used to prevent pregnancy.

## License

AGPL-3.0 — see [LICENSE](LICENSE).
