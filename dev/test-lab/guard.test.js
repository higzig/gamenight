import { describe, expect, it } from 'vitest'
import { testLabEnvironmentError } from './guard.js'

const ok = { dev: true, mode: 'development', supabaseUrl: 'http://127.0.0.1:54321', pageHostname: 'localhost' }
describe('Test Lab environment guard', () => {
  it('runs only on the local dev server against local Supabase', () => {
    expect(testLabEnvironmentError(ok)).toBeNull()
    expect(testLabEnvironmentError({ ...ok, supabaseUrl: 'http://localhost:54321', pageHostname: '127.0.0.1' })).toBeNull()
  })
  it('refuses production builds, hosted Supabase and remote access', () => {
    expect(testLabEnvironmentError({ ...ok, dev: false, mode: 'production' })).toContain('local Vite dev server')
    expect(testLabEnvironmentError({ ...ok, mode: 'staging' })).toContain('local Vite dev server')
    expect(testLabEnvironmentError({ ...ok, supabaseUrl: 'https://abcdefgh.supabase.co' })).toContain('refuses to run against https://abcdefgh.supabase.co')
    expect(testLabEnvironmentError({ ...ok, supabaseUrl: '' })).toContain('No Supabase URL')
    expect(testLabEnvironmentError({ ...ok, pageHostname: '192.168.1.20' })).toContain('from this machine')
  })
})
