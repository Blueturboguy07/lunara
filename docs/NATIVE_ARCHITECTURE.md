# Lunara native architecture

## Decision

Lunara is a native-distributed, local-first application. React and TypeScript
own the shared product UI and deterministic health engines. Capacitor embeds
that application in first-class iOS and Android projects. Native APIs are
exposed through narrow, typed bridges rather than scattered platform checks.

This is not a hosted website wrapped for the stores. The bundled web assets
ship inside each application and work without a network connection.

## Runtime topology

```text
React / TypeScript product layer
├── screens, navigation, motion and accessibility
├── cycle, TTC, pregnancy and perimenopause engines
├── local educational content
├── reports and visualizations
└── typed native service interfaces
    ├── iOS shell (Swift)
    │   ├── HealthKit
    │   ├── Keychain + LocalAuthentication
    │   ├── UserNotifications
    │   ├── BackgroundTasks
    │   └── WidgetKit
    └── Android shell
        ├── Health Connect
        ├── Keystore + BiometricPrompt
        ├── AlarmManager / WorkManager
        └── App Widgets
```

## Data ownership

- Health logs and derived insights are device-owned.
- The current Dexie store remains the migration source during the native
  transition.
- The target store is encrypted native SQLite with versioned migrations.
- Encryption keys live in Keychain on iOS and Android Keystore on Android.
- User exports remain portable, versioned and independently encrypted.
- Optional sync and backup may only transport opaque, client-encrypted data.
- AI chat is opt-in and sends data off the phone only after the person agrees
  ("AI chat sends data off this phone"). The provider receives the message, the
  earlier messages of the chat and only the tracker categories the person ticks.
  Without AI chat, health and cycle data stays on the phone.

## Native service boundaries

| Service | Shared contract | iOS | Android |
|---|---|---|---|
| Secure vault | store/read/delete secret | Keychain | Keystore |
| Biometrics | availability/authenticate | LocalAuthentication | BiometricPrompt |
| Health data | authorize/read/write | HealthKit | Health Connect |
| Reminders | schedule/cancel/list | UserNotifications | AlarmManager |
| Background work | refresh derived state | BackgroundTasks | WorkManager |
| Widgets | publish redacted snapshot | WidgetKit | Glance/App Widgets |
| Sharing | export report/backup | UIActivityViewController | Sharesheet |

No native bridge returns more health data than the requesting screen needs.

## Local-first precedents

- Capacitor officially supports adding native Swift and Android functionality
  to an existing web application through plugins.
- HealthKit and Health Connect are permission-controlled system repositories;
  integrations read only user-approved categories.
- SQLCipher-backed SQLite is a viable encrypted native-store path, with export
  compliance reviewed before release.
- Local notifications replace the PWA reminder compromise and work without a
  Lunara server after the user grants permission.

## Build workflow

```sh
pnpm install
pnpm --filter @lunara/app test
pnpm --filter @lunara/app build:native
pnpm --filter @lunara/app native:sync

# Native IDEs
pnpm --filter @lunara/app native:ios
pnpm --filter @lunara/app native:android
```

Web development remains useful for fast UI iteration with `pnpm dev`, but the
shipping artifacts are the Xcode and Android projects.
