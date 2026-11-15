/**
 * The app's name (founder decision, Nov 14 2026): "publik Lunara" in the App
 * Store and inside the app. The label under the icon stays "Lunara": a
 * home screen cuts a 13-character label short.
 *
 *   APP_NAME          index.html <title>, onboarding, notifications, the
 *                     Android app name (Settings > Apps, permission dialogs).
 *   HOME_SCREEN_NAME  iOS APP_DISPLAY_NAME (ios/App/Lunara.xcconfig), the Android
 *                     launcher label (title_activity_main) and the widgets.
 *
 * The App Store name itself is set in App Store Connect. The slug, the bundle
 * ID (app.lunara.mobile) and the URL scheme do not change.
 * src/lib/nativeVersion.test.ts checks that the native files agree.
 */
export const APP_NAME = 'publik Lunara'
export const HOME_SCREEN_NAME = 'Lunara'
