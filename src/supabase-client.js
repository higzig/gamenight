import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

export function getSupabaseConfigError() {
  if (!url || !publishableKey) return 'Supabase environment variables are not configured.'
  if (!/^https?:\/\//.test(url)) return 'VITE_SUPABASE_URL must be an HTTP(S) URL.'
  return null
}

export function createGameNightClient(storageKey) {
  if (getSupabaseConfigError()) return null
  return createClient(url, publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey },
  })
}
