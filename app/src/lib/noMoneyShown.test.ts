import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Founder rule (Nov 14 2026): no indication of how much money a person spends,
 * anywhere in the app. This test fails when a file that the app is built from
 * (the web code, index.html, the Android resources and code, the iOS code and
 * plists) has "$" followed by a digit, also with a space between them. In Swift
 * and Java only the string literals are read: there "$0" outside a string is a
 * closure argument, not money. Tests are not part of the app and are not read.
 * Usage lines, error messages and server texts are checked one by one in
 * publikApi.test.ts.
 */
const APP = fileURLToPath(new URL('../../', import.meta.url))
const ROOTS = ['src', 'index.html', 'android/app/src/main', 'ios/App/App', 'ios/App/LunaraWidgetExtension']
const TEXT_FILE = /\.(ts|tsx|html|css|xml|java|swift|plist|strings|json)$/
const SKIP_DIR = new Set(['node_modules', 'public', 'build', 'assets', 'res-generated'])

function filesUnder(path: string): string[] {
  const stat = statSync(path)
  if (stat.isFile()) return TEXT_FILE.test(path) && !/\.test\.ts$/.test(path) ? [path] : []
  return readdirSync(path)
    .filter((name) => !SKIP_DIR.has(name))
    .flatMap((name) => filesUnder(join(path, name)))
}

const MONEY = /\$\s?\d/
const STRING_LITERAL = /"(?:[^"\\\n]|\\.)*"/g

/**
 * The parts of a line that can reach a person: the whole line, or only the string
 * literals in Swift and Java, without Swift interpolations ("\\($0)" is code).
 */
function shownParts(file: string, line: string): string[] {
  if (!/\.(swift|java)$/.test(file)) return [line]
  return (line.match(STRING_LITERAL) ?? []).map((literal) => literal.replace(/\\\([^)]*\)/g, ''))
}

describe('no amount of money anywhere in the app', () => {
  const files = ROOTS.flatMap((root) => filesUnder(join(APP, root)))

  it('reads the app files', () => {
    expect(files.length).toBeGreaterThan(50)
    expect(files.some((f) => f.endsWith('AssistantScreen.tsx'))).toBe(true)
    expect(files.some((f) => f.endsWith('strings.xml'))).toBe(true)
  })

  it('no file has "$" followed by a digit', () => {
    const found: string[] = []
    for (const file of files) {
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, index) => {
          if (shownParts(file, line).some((part) => MONEY.test(part))) found.push(`${relative(APP, file)}:${index + 1}`)
        })
    }
    expect(found).toEqual([])
  })

  it('no code formats an amount of money ("$" in front of a number it computes)', () => {
    const formatters = files.filter((file) => /function dollars\b|\$\$\{|'\$'\s*\+|"\$"\s*\+/.test(readFileSync(file, 'utf8')))
    expect(formatters.map((file) => relative(APP, file))).toEqual([])
  })
})
