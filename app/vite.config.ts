import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import { buildInfo, buildProblems } from './src/lib/buildCheck'

// Build settings (src/lib/buildFlags.ts), the publik app token (src/lib/publikBuild.ts)
// and the test hook PUBLIK_API_BASE_URL (src/lib/publik.ts). Only these names
// reach the bundle, never a key.
const EXPOSED = ['VITE_', 'PUBLIK_API_BASE_URL', 'PUBLIK_GATE_MODE', 'APP_STORE_BUILD', 'PUBLIK_TEST_HOOKS']

/** Writes lunara-build.json (src/lib/buildCheck.ts) into every build. */
function buildInfoFile(mode: string, env: Record<string, string>): Plugin {
  return {
    name: 'lunara-build-info',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'lunara-build.json', source: buildInfo(mode, env) })
    },
  }
}

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), [...EXPOSED, 'LUNARA_RELEASE'])
  if (command === 'build') {
    // `vite build` refuses a bundle that must not ship (src/lib/buildCheck.ts).
    const problems = buildProblems(mode, env)
    if (problems.length > 0) throw new Error(`Lunara build stopped:\n  - ${problems.join('\n  - ')}`)
  }
  return {
    plugins: [react(), buildInfoFile(mode, env)],
    envPrefix: EXPOSED,
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts'],
    },
  }
})
