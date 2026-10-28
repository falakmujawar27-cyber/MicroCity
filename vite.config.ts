import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, type Plugin } from 'vite'
import { createDatabase } from './server/db.ts'
import { createMicrocityApp, type MicrocityApp } from './server/app.ts'

/**
 * Runs the same authenticated API inside the Vite dev server, so cookies and
 * /api requests stay same-origin during development. Production uses
 * server/index.ts, which serves the built app and the same API.
 */
function microcityApi(): Plugin {
  let app: MicrocityApp | null = null
  return {
    name: 'microcity-api',
    configureServer(server) {
      app = createMicrocityApp({
        db: createDatabase(process.env.MICROCITY_DB ?? resolve('server/data/microcity.sqlite')),
      })
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/api')) return next()
        void app?.handle(req, res).then((handled) => {
          if (!handled) next()
        })
      })
      server.httpServer?.once('close', () => {
        app?.db.close()
        app = null
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), microcityApi()],
  server: {
    watch: {
      // API writes to the SQLite database must not trigger SPA reloads and
      // discard in-flight import previews or form state.
      ignored: ['**/server/data/**', '**/node_modules/**', '**/.git/**'],
    },
  },
})
