import { resolve } from 'node:path'
import { defineConfig, loadEnv } from 'vite'
import { testLabDevServer } from './dev/test-lab/server/test-lab-plugin.mjs'

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1'])

// Dev server only: say which Supabase the app is talking to and where each interface lives.
function localDevSummary(env) {
  return {
    name: 'game-night-local-dev-summary',
    apply: 'serve',
    configureServer(server) {
      server.httpServer?.once('listening', () => {
        const supabase = env.VITE_SUPABASE_URL || ''
        let host = ''
        try { host = new URL(supabase).hostname } catch {}
        const base = (server.resolvedUrls?.local?.[0] || 'http://localhost:5173/').replace(/\/$/, '')
        const log = server.config.logger
        if (!supabase) log.warn('\n  ⚠ No VITE_SUPABASE_URL. Copy .env.example to .env.development.local (see README).\n')
        else if (!LOCAL_HOSTS.has(host)) log.warn(`\n  ⚠ NOT LOCAL: this dev server is using ${supabase}\n    Point .env.development.local at http://127.0.0.1:54321 to develop against local Supabase.\n`)
        else log.info(`\n  Supabase: ${supabase} (local)`)
        log.info(`  Host:     ${base}/`)
        log.info(`  Audience: ${base}/audience.html?room=ROOMCODE`)
        log.info(`  Captain:  ${base}/team.html?room=ROOMCODE`)
        log.info(`  Test Lab: ${base}/dev/test-lab/   (development only)`)
        log.info('  Studio:   http://127.0.0.1:54323   Email (sign-up links): http://127.0.0.1:54324\n')
      })
    },
  }
}

// Production builds must never contain Test Lab: fail the build if any of it gets in.
const TEST_LAB_MARKER = 'GAME_NIGHT_TEST_LAB_DEV_ONLY'
function excludeTestLabFromBuild() {
  return {
    name: 'game-night-exclude-test-lab',
    apply: 'build',
    load(id) { if (id.replaceAll('\\', '/').includes('/dev/test-lab/')) this.error(`Test Lab must not be part of a production build (imported: ${id}).`) },
    generateBundle(_options, bundle) {
      for (const file of Object.values(bundle)) {
        const text = file.type === 'chunk' ? file.code : String(file.source)
        if (text.includes(TEST_LAB_MARKER) || file.fileName.includes('test-lab')) this.error(`Test Lab code found in production output: ${file.fileName}`)
      }
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, import.meta.dirname, 'VITE_')
  return {
    plugins: [
      localDevSummary(env),
      testLabDevServer({ supabaseUrl: env.VITE_SUPABASE_URL, publishableKey: env.VITE_SUPABASE_PUBLISHABLE_KEY, root: import.meta.dirname }),
      excludeTestLabFromBuild(),
    ],
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      rollupOptions: {
        input: {
          admin: resolve(import.meta.dirname, 'index.html'),
          audience: resolve(import.meta.dirname, 'audience.html'),
          team: resolve(import.meta.dirname, 'team.html'),
        },
      },
    },
  }
})
