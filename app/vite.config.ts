import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  // PUBLIK_API_BASE_URL is the publik module's test hook (src/lib/publik.ts):
  // `PUBLIK_API_BASE_URL=http://127.0.0.1:8787/api/v1 pnpm dev` points the
  // gate at a fake publik. PUBLIK_GATE_MODE and APP_STORE_BUILD are the build
  // settings in src/lib/buildFlags.ts. Only these names are exposed, never a key.
  envPrefix: ['VITE_', 'PUBLIK_API_BASE_URL', 'PUBLIK_GATE_MODE', 'APP_STORE_BUILD'],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
