const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

const hostname = value => { try { return new URL(value).hostname } catch { return '' } }

// Test Lab only runs on the Vite dev server, against local Supabase, opened from this machine.
export function testLabEnvironmentError({ dev, mode, supabaseUrl, pageHostname }) {
  if (!dev || mode !== 'development') return 'Test Lab only runs on the local Vite dev server (npm run dev).'
  if (!supabaseUrl) return 'No Supabase URL is configured for local development.'
  if (!LOCAL_HOSTS.has(hostname(supabaseUrl))) return `Test Lab refuses to run against ${supabaseUrl}. It only works with local Supabase (http://127.0.0.1:54321).`
  if (!LOCAL_HOSTS.has(pageHostname)) return 'Open Test Lab from this machine (localhost), not over the network.'
  return null
}

export const isLocalUrl = value => LOCAL_HOSTS.has(hostname(value))
