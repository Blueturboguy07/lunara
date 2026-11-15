import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { APP_NAME, HOME_SCREEN_NAME } from './appName'

/**
 * One source for the version and the build number: app/package.json. Android
 * reads it directly; iOS keeps a copy in ios/App/Lunara.xcconfig that both
 * targets (the app and the widget) inherit. This test fails when they differ.
 */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const pkg = JSON.parse(read('../../package.json')) as { version: string; buildNumber: number }

function xcconfigValue(text: string, name: string): string | null {
  const match = text.match(new RegExp(`^${name}\\s*=\\s*(.+?)\\s*$`, 'm'))
  return match ? match[1]! : null
}

describe('the native version comes from package.json', () => {
  const xcconfig = read('../../ios/App/Lunara.xcconfig')
  const pbxproj = read('../../ios/App/App.xcodeproj/project.pbxproj')

  it('iOS: MARKETING_VERSION and CURRENT_PROJECT_VERSION match package.json', () => {
    expect(xcconfigValue(xcconfig, 'MARKETING_VERSION')).toBe(pkg.version)
    expect(Number(xcconfigValue(xcconfig, 'CURRENT_PROJECT_VERSION'))).toBe(pkg.buildNumber)
    expect(Number.isInteger(pkg.buildNumber) && pkg.buildNumber > 0).toBe(true)
  })

  it('iOS: no target overrides them, both configurations use the xcconfig, and the app is iPhone only', () => {
    expect(pbxproj).not.toMatch(/MARKETING_VERSION\s*=/)
    expect(pbxproj).not.toMatch(/CURRENT_PROJECT_VERSION\s*=/)
    expect(pbxproj.match(/baseConfigurationReference = \w+ \/\* Lunara\.xcconfig \*\//g)).toHaveLength(2)
    expect(pbxproj.match(/TARGETED_DEVICE_FAMILY = ([^;]+);/g)).toEqual(Array(4).fill('TARGETED_DEVICE_FAMILY = 1;'))
  })

  it('iOS: one display-name setting, arm64, export compliance, and a privacy manifest in each target', () => {
    const appPlist = read('../../ios/App/App/Info.plist')
    expect(xcconfigValue(xcconfig, 'APP_DISPLAY_NAME')).toBe(HOME_SCREEN_NAME)
    expect(appPlist).toMatch(/<key>CFBundleDisplayName<\/key>\s*<string>\$\(APP_DISPLAY_NAME\)<\/string>/)
    expect(read('../../ios/App/LunaraWidgetExtension/Info.plist')).toContain('$(APP_DISPLAY_NAME) Cycle')
    expect(appPlist).toMatch(/<key>UIRequiredDeviceCapabilities<\/key>\s*<array>\s*<string>arm64<\/string>\s*<\/array>/)
    expect(appPlist).toMatch(/<key>ITSAppUsesNonExemptEncryption<\/key>\s*<false\/>/)
    expect(pbxproj.match(/PrivacyInfo\.xcprivacy in Resources \*\/,/g)).toHaveLength(2)
    expect(read('../../ios/App/App/PrivacyInfo.xcprivacy')).toMatch(/<string>CA92\.1<\/string>\s*<string>1C8F\.1<\/string>/)
    expect(read('../../ios/App/LunaraWidgetExtension/PrivacyInfo.xcprivacy')).toContain('<string>1C8F.1</string>')
  })

  it('Android: versionName and versionCode are read from package.json', () => {
    const gradle = read('../../android/app/build.gradle')
    expect(gradle).toContain("file('../../package.json')")
    expect(gradle).toContain('versionName lunaraPackage.version')
    expect(gradle).toContain('versionCode((lunaraPackage.buildNumber ?: 1) as Integer)')
  })
})

describe('the name: "publik Lunara" in the app, "Lunara" under the icon', () => {
  it('the app name puts publik first; the home-screen label stays short', () => {
    expect(APP_NAME).toBe('publik Lunara')
    expect(HOME_SCREEN_NAME).toBe('Lunara')
    expect(read('../../index.html')).toContain('<title>publik Lunara</title>')
    expect(read('../../capacitor.config.ts')).toContain("appName: 'publik Lunara'")
  })

  it('Android: the app name is publik Lunara; the launcher label and the widget title are Lunara', () => {
    const strings = read('../../android/app/src/main/res/values/strings.xml')
    expect(strings).toContain('<string name="app_name">publik Lunara</string>')
    expect(strings).toContain('<string name="title_activity_main">Lunara</string>')
    const manifest = read('../../android/app/src/main/AndroidManifest.xml')
    expect(manifest).toMatch(/android:name="\.MainActivity"\s+android:label="@string\/title_activity_main"/)
    expect(read('../../android/app/src/main/res/layout/lunara_cycle_widget.xml')).toContain('android:text="@string/title_activity_main"')
  })

  it('the bundle ID, the package and the URL scheme do not change', () => {
    expect(read('../../capacitor.config.ts')).toContain("appId: 'app.lunara.mobile'")
    const strings = read('../../android/app/src/main/res/values/strings.xml')
    expect(strings).toContain('<string name="package_name">app.lunara.mobile</string>')
    expect(strings).toContain('<string name="custom_url_scheme">app.lunara.mobile</string>')
  })
})

describe('the iOS privacy manifest: what the App Store label is built from', () => {
  const manifest = read('../../ios/App/App/PrivacyInfo.xcprivacy')
  const declared = [...manifest.matchAll(/<key>NSPrivacyCollectedDataType<\/key>\s*<string>NSPrivacyCollectedDataType(\w+)<\/string>\s*<key>NSPrivacyCollectedDataTypeLinked<\/key>\s*<(true|false)\/>\s*<key>NSPrivacyCollectedDataTypeTracking<\/key>\s*<(true|false)\/>/g)].map(
    (m) => ({ type: m[1], linked: m[2] === 'true', tracking: m[3] === 'true' }),
  )

  it('declares exactly these data types; health data and chat content are not linked; nothing tracks', () => {
    expect(declared).toEqual([
      { type: 'DeviceID', linked: true, tracking: false },
      { type: 'ProductInteraction', linked: true, tracking: false },
      { type: 'Health', linked: false, tracking: false },
      { type: 'SensitiveInfo', linked: false, tracking: false },
      { type: 'OtherUserContent', linked: false, tracking: false },
    ])
    expect(manifest).toMatch(/<key>NSPrivacyTracking<\/key>\s*<false\/>/)
    expect(manifest).toMatch(/<key>NSPrivacyTrackingDomains<\/key>\s*<array\/>/)
  })
})
