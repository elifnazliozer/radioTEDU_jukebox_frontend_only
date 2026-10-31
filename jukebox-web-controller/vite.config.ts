import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig((env) => {
  const isPreview = 'isPreview' in env ? Boolean(env.isPreview) : process.env.npm_lifecycle_event === 'preview'

  return {
    plugins: [react()],
    // The dev server is served from root; production/preview builds are served
    // from the backend at /controller (overridable per-deployment).
    base: env.command === 'serve' && !isPreview ? '/' : (process.env.VITE_APP_BASE_PATH || '/controller/'),
    // Lets a phone on the LAN use the dev server as its API origin
    // (VITE_API_ORIGIN=http://<lan-ip>:<port>), so cookies and CORS stay same-origin.
    server: {
      // xfwd passes the phone's IP on, so per-IP rate limits don't lump every proxied client together.
      proxy: {
        '/api': { target: 'http://localhost:3000', xfwd: true },
        '/socket.io': { target: 'http://localhost:3000', ws: true, xfwd: true },
      },
    },
    test: {
      environment: 'happy-dom',
      setupFiles: ['./src/test/setup.ts'],
    },
  }
})
