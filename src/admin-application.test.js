// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createAdminApplication } from './admin-application.js'

const snapshot = { event: { id: 'event-1', name: 'Night', room_code: 'ABC123' }, teams: [] }

function deferred() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

function setup({ session = { user: { is_anonymous: false } }, events = [], create, hydrate, remove } = {}) {
  document.body.innerHTML = '<main id="adminGateway"></main><div id="adminApp"></div>'
  const channel = { on: vi.fn().mockReturnThis(), subscribe: vi.fn().mockReturnThis() }
  const client = {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session }, error: null }),
      signInWithPassword: vi.fn(), signOut: vi.fn().mockResolvedValue({}),
    },
    channel: vi.fn(() => channel), removeChannel: vi.fn().mockResolvedValue({}),
  }
  const services = {
    isAnonymousUser: user => user?.is_anonymous === true,
    listOwnedEvents: vi.fn().mockResolvedValue(events),
    createJoinableEvent: create ?? vi.fn().mockResolvedValue('event-1'),
    hydrateHostEvent: hydrate ?? vi.fn().mockResolvedValue(snapshot),
    deleteOwnedEvent: remove ?? vi.fn().mockResolvedValue(null),
  }
  const application = createAdminApplication({ client, configError: null, services, loadLegacyAdmin: vi.fn().mockResolvedValue({}) })
  return { application, client, services }
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0))

describe('Admin top-level application states', () => {
  beforeEach(() => { window.gameNightRemoteSession = null })

  it('keeps Admin hidden while Auth bootstrap is unresolved', async () => {
    const gate = deferred()
    const { application, client } = setup()
    client.auth.getSession.mockReturnValue(gate.promise)
    const boot = application.init()
    expect(document.getElementById('adminApp').hidden).toBe(true)
    expect(application.getState()).toBe('checking-session')
    gate.resolve({ data: { session: null }, error: null }); await boot
  })

  it('shows sign-in only for a signed-out user', async () => {
    const { application } = setup({ session: null })
    await application.init()
    expect(application.getState()).toBe('signed-out')
    expect(document.getElementById('adminApp').hidden).toBe(true)
    expect(document.getElementById('adminGateway').textContent).toContain('Sign in to Game Night')
  })

  it('shows chooser but not Admin for a signed-in user without an active event', async () => {
    const { application } = setup()
    await application.init()
    expect(application.getState()).toBe('choosing-event')
    expect(document.getElementById('adminApp').hidden).toBe(true)
    expect(document.getElementById('adminGateway').hidden).toBe(false)
  })

  it('successful creation activates Admin and removes the chooser', async () => {
    const { application } = setup()
    await application.init()
    const form = document.getElementById('createRemoteEvent'), button = document.getElementById('createEventButton')
    form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true, submitter: button })); await flush(); await flush()
    expect(application.getState()).toBe('active-event')
    expect(document.getElementById('adminApp').hidden).toBe(false)
    expect(document.getElementById('adminGateway').hidden).toBe(true)
  })

  it('selecting an existing event uses the same active transition', async () => {
    const { application } = setup({ events: [{ id: 'event-1', name: 'Night', room_code: 'ABC123', event_date: '2026-08-20', status: 'lobby' }] })
    await application.init(); document.querySelector('.open-event').click(); await flush(); await flush()
    expect(application.getState()).toBe('active-event')
    expect(document.getElementById('adminGateway').hidden).toBe(true)
    expect(document.getElementById('adminApp').hidden).toBe(false)
  })
  it('requires confirmation before deleting an event and then refreshes the chooser',async()=>{const remove=vi.fn().mockResolvedValue(null),events=[{id:'event-1',name:'Night',room_code:'ABC123',event_date:'2026-08-20',status:'lobby'}],{application,services}=setup({events,remove});window.confirm=vi.fn().mockReturnValue(false);await application.init();document.querySelector('.delete-event').click();await flush();expect(remove).not.toHaveBeenCalled();window.confirm.mockReturnValue(true);document.querySelector('.delete-event').click();await flush();await flush();expect(remove).toHaveBeenCalledWith(expect.anything(),'event-1');expect(services.listOwnedEvents).toHaveBeenCalledTimes(2)})

  it('Switch event returns to chooser and hides Admin', async () => {
    const { application } = setup()
    await application.init(); await application.openEvent('event-1'); await application.backToEvents()
    expect(application.getState()).toBe('choosing-event')
    expect(document.getElementById('adminApp').hidden).toBe(true)
    expect(document.getElementById('adminGateway').hidden).toBe(false)
  })

  it('prevents duplicate create submissions while one is pending', async () => {
    const pending = deferred(), create = vi.fn(() => pending.promise)
    const { application } = setup({ create })
    await application.init()
    const form = document.getElementById('createRemoteEvent'), button = document.getElementById('createEventButton')
    const submit = () => form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true, submitter: button }))
    submit(); submit(); await flush()
    expect(create).toHaveBeenCalledTimes(1)
    expect(button.disabled).toBe(true)
    expect(button.textContent).toContain('Creating game night')
    pending.resolve('event-1'); await flush(); await flush()
  })

  it('restores the create form and shows a safe error after failure', async () => {
    const { application } = setup({ create: vi.fn().mockRejectedValue(new Error('sensitive backend detail')) })
    await application.init()
    const form = document.getElementById('createRemoteEvent'), button = document.getElementById('createEventButton')
    form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true, submitter: button })); await flush()
    expect(application.getState()).toBe('choosing-event')
    expect(button.disabled).toBe(false)
    expect(button.textContent).toBe('Create event and open lobby')
    expect(document.getElementById('gatewayError').textContent).toContain('Could not create the event')
    expect(document.getElementById('gatewayError').textContent).not.toContain('sensitive backend detail')
  })
})
