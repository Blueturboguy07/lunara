# What can actually run locally

Lunara's shipping target is a bundled Capacitor application, not a PWA. The
React product layer is copied into native iOS and Android shells and can launch
with airplane mode enabled.

## Fully local and buildable

These features can work without a Lunara account or hosted backend:

- cycle, period, symptom, mood, medication, contraception, BBT and OPK logging;
- predictions, uncertainty ranges, pattern analysis and cycle reports;
- TTC timing guidance, pregnancy-week calculation and perimenopause timelines;
- bundled educational content;
- encrypted exports and manual restore;
- native local notifications;
- secrets stored in iOS Keychain or Android Keystore;
- Face ID/Touch ID or Android biometric gating;
- permission-scoped HealthKit and Health Connect import;
- redacted native widget snapshots;
- offline AI through an Ollama server controlled by the user.

The last item is “local” in a network-ownership sense, not necessarily
“on-phone.” The default `gpt-oss:20b` Ollama model is roughly 14 GB and is
appropriate for a capable Mac/PC. An iOS Simulator can reach the Mac at
`127.0.0.1`; an Android emulator normally reaches it at `10.0.2.2`. A physical
phone needs the computer's LAN address and an Ollama bind/network policy the
user explicitly configures.

## Local code, but requires a real device or platform service

Some features compile locally but cannot be meaningfully verified in a generic
browser:

| Feature | Why |
|---|---|
| HealthKit | Apple permissions and health records require an entitled iOS app; meaningful validation needs a real device and test data. |
| Health Connect | Requires a supported Android version/provider, permissions, and test records. |
| Biometrics | A simulator can emulate some outcomes, but release validation needs enrolled device biometrics. |
| Widgets | Extensions/snapshots are native OS surfaces and require device or simulator installation. |
| Local notifications | Scheduling is local, but permission, focus modes, battery policy and exact delivery behavior are OS-controlled. |
| Store release | Building is local; distribution requires Apple/Google developer accounts, signing identities, store metadata and review. |

## Optional external dependencies

- AI chat sends data off the phone, and only after the person agrees on the
  screen "AI chat sends data off this phone" (`app/src/lib/healthConsent.ts`).
  Each message sends the message, the earlier messages of the chat (up to 16)
  and only the tracker categories the person ticks. With the person's own
  OpenAI key it goes straight to OpenAI's API (`store: false`); it does not go
  through a Lunara or publik server. It requires internet access, a project
  key, API access and billing.
- Zero-knowledge automatic backup needs somewhere to store the encrypted blob.
  The included Worker can be self-hosted, but it is still an external machine.
- Fresh editorial/medical content requires a review and update process. Bundled
  content remains local but does not update itself.

## Not possible as a single disconnected phone

The following claims are physically or operationally impossible without
another party or machine:

- cross-device synchronization with no transport;
- recovering encrypted data after every copy of the key/recovery code is lost;
- remote push notifications with no push service;
- a live moderated community with no other users, moderators or server;
- partner sharing with no peer connection or relay;
- calling a cloud model while fully offline;
- guaranteeing medical correctness through code alone;
- publishing to the App Store or Play Store with no signing/review accounts.

Community and partner-sharing are deliberately out of scope. The AI assistant
is the only selected feature from the earlier questionable/deferred group, and
it has both BYOK cloud and user-owned local-provider paths. Condition symptom
checkers and guided journeys from that group are also deliberately excluded.

## Product and legal limits

High-quality structural parity with another app is buildable. Redistributing
Flo's screenshots, illustrations, logo, copy, paid media, or an
indistinguishable trade dress is not an acceptable implementation path. Lunara
uses original visual assets and copy while matching the useful interaction
model and product depth.

Condition-specific outputs remain educational. Clinical validation,
medical-device clearance, expert content review and production privacy/legal
review are evidence and governance work; they cannot be replaced by a passing
test suite.
