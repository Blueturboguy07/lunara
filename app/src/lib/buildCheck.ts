import { APP_TOKEN_PATTERN } from './appTokenPattern'

/**
 * What `vite build` checks (vite.config.ts). Plain functions of the build
 * environment, so a unit test can run them.
 */
export type BuildEnv = Record<string, string | undefined>

const isOff = (value: string | undefined) => ['0', 'false', 'no'].includes(String(value ?? '').trim().toLowerCase())

/**
 * The problems that stop a build, or [] when it may build:
 *   - `--mode native`: VITE_PUBLIK_APP_TOKEN, when set, is not pat_lunara_ + 32 letters and digits;
 *   - LUNARA_RELEASE=1 (release.yml): VITE_PUBLIK_APP_TOKEN is missing, or PUBLIK_TEST_HOOKS=1 is set;
 *   - PUBLIK_API_BASE_URL is set without PUBLIK_TEST_HOOKS=1 (a test hook in a production build).
 */
export function buildProblems(mode: string, env: BuildEnv): string[] {
  const token = env.VITE_PUBLIK_APP_TOKEN?.trim() ?? ''
  const release = env.LUNARA_RELEASE?.trim() === '1'
  const hooks = env.PUBLIK_TEST_HOOKS?.trim() === '1'
  const problems: string[] = []
  if (mode === 'native' && token && !APP_TOKEN_PATTERN.test(token)) {
    problems.push('VITE_PUBLIK_APP_TOKEN is not a publik app token (pat_lunara_ and 32 lower-case letters and digits).')
  }
  if (release && !token) problems.push('A release build needs VITE_PUBLIK_APP_TOKEN (the PUBLIK_APP_TOKEN secret).')
  if (release && hooks) problems.push('A release build cannot have PUBLIK_TEST_HOOKS=1.')
  if (env.PUBLIK_API_BASE_URL?.trim() && !hooks) {
    problems.push('PUBLIK_API_BASE_URL is a test hook. Set PUBLIK_TEST_HOOKS=1 for a test build, or remove it.')
  }
  return problems
}

/** lunara-build.json next to index.html: what an Xcode Release archive checks (ios/App/scripts/check-release-build.sh). */
export function buildInfo(mode: string, env: BuildEnv): string {
  return JSON.stringify({
    mode,
    testHooks: env.PUBLIK_TEST_HOOKS?.trim() === '1',
    // APP_STORE_BUILD=0: the Claude subscription-token option is on, also in the iOS app.
    claudeTokenOnIos: isOff(env.APP_STORE_BUILD),
    appToken: env.VITE_PUBLIK_APP_TOKEN?.trim() ? 'env' : 'dev',
  })
}
