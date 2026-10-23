import { describe, expect, it, vi } from 'vitest'
import { createActionRunner, friendlyHostError } from './action-runner.js'

describe('Host action feedback', () => {
  it('shows server explanations and hides technical errors', () => {
    expect(friendlyHostError({ code: '55000', message: 'This game is not on stage. Refresh and select it first.' })).toBe('This game is not on stage. Refresh and select it first.')
    expect(friendlyHostError({ code: '42501', message: 'event owner required' })).toContain('permission')
    expect(friendlyHostError(new TypeError('Failed to fetch'))).toContain('Check the connection')
    expect(friendlyHostError({ code: 'P0001', message: 'invalid event transition' }, 'Could not start.')).toBe('Could not start.')
    expect(friendlyHostError({ code: 'PGRST202', message: 'Could not find the function public.set_event_lineup(p_event_id, p_expected_revision, p_game_types) in the schema cache' })).toContain('(set_event_lineup)')
    expect(friendlyHostError({ code: '42883', message: 'function public.create_project(text) does not exist' })).toContain('(create_project)')
  })
  it('blocks duplicate submissions and reports failures', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const showError = vi.fn(), onBusyChange = vi.fn(), runner = createActionRunner({ showError, onBusyChange })
    let finish
    const action = vi.fn(() => new Promise(resolve => { finish = resolve }))
    const first = runner.run('save', action)
    expect(runner.isBusy('save')).toBe(true)
    expect(await runner.run('save', action)).toEqual({ ok: false, skipped: true })
    finish('done'); expect(await first).toEqual({ ok: true, value: 'done' })
    expect(action).toHaveBeenCalledTimes(1); expect(runner.isBusy()).toBe(false)
    const failure = await runner.run('save', async () => { throw Object.assign(new Error('Nope'), { code: '55000' }) })
    expect(failure.ok).toBe(false); expect(showError).toHaveBeenCalledWith('Nope', expect.any(Error)); expect(onBusyChange).toHaveBeenCalled()
  })
})
