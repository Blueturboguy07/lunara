import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  // PUBLIK_API_BASE_URL is the publik module's test hook (src/lib/publik.ts):
  // `PUBLIK_API_BASE_URL=http://127.0.0.1:8787/api/v1 pnpm dev` points the
  // gate at a fake publik. Only that one name is exposed, never a key.
  envPrefix: ['VITE_', 'PUBLIK_API_BASE_URL'],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
