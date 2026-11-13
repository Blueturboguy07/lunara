import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

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
    expect(xcconfigValue(xcconfig, 'APP_DISPLAY_NAME')).toBe('Lunara')
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
