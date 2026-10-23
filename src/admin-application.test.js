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
    listProjects: vi.fn().mockResolvedValue(events),
    createProject: create ?? vi.fn().mockResolvedValue('event-1'),
    hydrateHostEvent: hydrate ?? vi.fn().mockResolvedValue(snapshot),
    deleteOwnedEvent: remove ?? vi.fn().mockResolvedValue(null),
  }
  const application = createAdminApplication({ client, configError: null, services, loadLegacyAdmin: vi.fn().mockResolvedValue({}) })
  return { application, client, services }
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0))
const dateAt = offset => { const date = new Date(); date.setDate(date.getDate() + offset); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` }
const project = (id, extra = {}) => ({ id, name: id, room_code: 'ABC123', event_date: dateAt(0), status: 'lobby', created_at: '2026-10-23T10:00:00Z', started_at: null, games: ['guess_age', 'no_context', 'i_bet_you'], ...extra })
const openModal = () => document.getElementById('newProjectButton').click()
const submitProject = name => { if (name != null) document.getElementById('newProjectName').value = name; document.getElementById('newProjectForm').dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true })) }

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

  it('shows My Projects but not Admin for a signed-in Host without an open project', async () => {
    const { application } = setup({ events: [project('Friday Quiz')] })
    await application.init()
    expect(application.getState()).toBe('choosing-event')
    expect(document.getElementById('adminApp').hidden).toBe(true)
    expect(document.querySelector('.gn-projects h1').textContent).toBe('My Projects')
    expect(document.querySelector('.gn-projects-title p').textContent).toBe('Create, prepare and host your game nights.')
    const card = document.querySelector('.gn-project[data-project-id="Friday Quiz"]')
    expect(card.textContent).toContain('3 games'); expect(card.textContent).toContain('Planning'); expect(card.querySelector('.open-event').textContent).toContain('Open Project')
    expect([...card.querySelectorAll('.gn-project-games li')].map(li => li.dataset.game)).toEqual(['guessAge', 'noContext', 'iBetYou'])
  })

  it('creates a project from just a name, with the recommended games, and opens it', async () => {
    const { application, services } = setup()
    await application.init()
    openModal()
    const modal = document.getElementById('newProjectModal')
    expect(modal.hidden).toBe(false); expect(modal.querySelector('h2').textContent).toBe('Create a Project')
    expect([...modal.querySelectorAll('input')].map(input => input.id)).toEqual(['newProjectName'])
    expect(document.activeElement.id).toBe('newProjectName')
    submitProject('  Friday Night Quiz  '); await flush(); await flush()
    expect(services.createProject).toHaveBeenCalledWith(expect.anything(), { name: 'Friday Night Quiz', lineup: ['guess_age', 'no_context', 'i_bet_you'], eventDate: dateAt(0) })
    expect(application.getState()).toBe('active-event')
    expect(document.getElementById('adminGateway').hidden).toBe(true)
  })

  it('cancels the New Project modal without creating anything', async () => {
    const { application, services } = setup(); await application.init()
    openModal(); document.getElementById('cancelNewProject').click()
    expect(document.getElementById('newProjectModal').hidden).toBe(true); expect(services.createProject).not.toHaveBeenCalled()
    openModal(); document.getElementById('newProjectModal').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(document.getElementById('newProjectModal').hidden).toBe(true)
  })

  it('offers a first-project card when there are no projects', async () => {
    const { application } = setup(); await application.init()
    document.getElementById('newProjectCard').click()
    expect(document.getElementById('newProjectModal').hidden).toBe(false)
  })

  it('opening an existing project uses the same active transition', async () => {
    const { application } = setup({ events: [project('event-1')] })
    await application.init(); document.querySelector('.open-event').click(); await flush(); await flush()
    expect(application.getState()).toBe('active-event')
    expect(document.getElementById('adminGateway').hidden).toBe(true)
    expect(document.getElementById('adminApp').hidden).toBe(false)
  })

  it('requires confirmation before deleting a project from its menu and then refreshes My Projects',async()=>{const remove=vi.fn().mockResolvedValue(null),{application,services}=setup({events:[project('event-1')],remove});window.confirm=vi.fn().mockReturnValue(false);await application.init();expect(document.querySelector('.event-overflow .delete-event').textContent).toBe('Delete project');document.querySelector('.delete-event').click();await flush();expect(remove).not.toHaveBeenCalled();window.confirm.mockReturnValue(true);document.querySelector('.delete-event').click();await flush();await flush();expect(remove).toHaveBeenCalledWith(expect.anything(),'event-1');expect(services.listProjects).toHaveBeenCalledTimes(2)})

  it('archives hosted projects after their date but keeps projects in preparation', async () => {
    const events = [
      project('Today'), project('Prepared earlier', { event_date: dateAt(-5) }),
      project('Hosted last week', { event_date: dateAt(-7), started_at: '2026-10-16T19:00:00Z' }),
      project('Legacy played', { event_date: dateAt(-30), status: 'round_complete', games: [] }),
    ]
    const { application } = setup({ events }); await application.init()
    const current = document.getElementById('ownedEvents').textContent
    expect(current).toContain('Today'); expect(current).toContain('Prepared earlier'); expect(current).not.toContain('Hosted last week')
    expect(document.querySelector('.gn-archived').open).toBe(false)
    expect(document.querySelector('.gn-archived>summary').textContent).toBe('Archived Projects (2)')
    expect(document.getElementById('archivedEventList').textContent).toContain('Legacy played')
    expect(document.getElementById('archivedEventList').textContent).toContain('No games yet')
  })

  it('opens an archived project without mutating it first', async () => {
    const { application, services } = setup({ events: [project('past', { event_date: dateAt(-1), status: 'round_complete' })] }); await application.init()
    document.querySelector('#archivedEventList .open-event').click(); await flush(); await flush()
    expect(services.hydrateHostEvent).toHaveBeenCalledWith(expect.anything(), 'past')
    expect(application.getState()).toBe('active-event')
  })

  it('requires a project name', async () => {
    const create = vi.fn(), { application } = setup({ create }); await application.init()
    openModal(); submitProject('   '); await flush()
    expect(create).not.toHaveBeenCalled()
    expect(document.getElementById('newProjectError').textContent).toBe('Give your project a name.')
  })

  it('returns to My Projects and hides Admin', async () => {
    const { application } = setup()
    await application.init(); await application.openEvent('event-1'); await application.backToEvents()
    expect(application.getState()).toBe('choosing-event')
    expect(document.getElementById('adminApp').hidden).toBe(true)
    expect(document.getElementById('adminGateway').hidden).toBe(false)
  })

  it('prevents duplicate create submissions while one is pending, and allows creating again afterwards', async () => {
    const pending = deferred(), create = vi.fn(() => pending.promise)
    const { application } = setup({ create })
    await application.init()
    openModal(); submitProject('Friday Night Quiz'); submitProject(); await flush()
    expect(create).toHaveBeenCalledTimes(1)
    expect(document.getElementById('createProjectSubmit').disabled).toBe(true)
    expect(document.getElementById('createProjectSubmit').textContent).toBe('Creating…')
    pending.resolve('event-1'); await flush(); await flush()
    await application.backToEvents(); openModal()
    expect(document.getElementById('newProjectModal').hidden).toBe(false)
  })

  it('keeps the modal open with a safe error after a failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { application } = setup({ create: vi.fn().mockRejectedValue(new Error('sensitive backend detail')) })
    await application.init()
    openModal(); submitProject('Friday Night Quiz'); await flush()
    expect(application.getState()).toBe('choosing-event')
    expect(document.getElementById('newProjectModal').hidden).toBe(false)
    expect(document.getElementById('createProjectSubmit').disabled).toBe(false)
    expect(document.getElementById('createProjectSubmit').textContent).toBe('Create Project →')
    expect(document.getElementById('newProjectError').textContent).toContain('Nothing was saved')
    expect(document.getElementById('newProjectError').textContent).not.toContain('sensitive backend detail')
    expect(document.getElementById('newProjectName').value).toBe('Friday Night Quiz')
  })

  it('explains a missing database update instead of a generic failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const missing = Object.assign(new Error('Could not find the function public.create_project(p_event_date, p_game_types, p_name) in the schema cache'), { code: 'PGRST202' })
    const { application } = setup({ create: vi.fn().mockRejectedValue(missing) })
    await application.init()
    openModal(); submitProject('Friday Night Quiz'); await flush()
    expect(document.getElementById('newProjectError').textContent).toContain('missing an update this screen needs (create_project)')
  })

  it('ignores unchanged recovery polls but still applies and keeps polling for genuine updates', async () => {
    vi.useFakeTimers()
    try {
      let version = 7
      const hydrate = vi.fn(async () => ({ server_now: new Date().toISOString(), event: { id: 'event-1', name: 'Night', room_code: 'ABC123', status: 'question', state_version: version }, teams: [] }))
      const { application } = setup({ hydrate })
      const dispatched = []
      const listener = event => dispatched.push(event.detail.event.state_version)
      window.addEventListener('game-night-remote-state', listener)
      await application.init(); await application.openEvent('event-1')
      await vi.advanceTimersByTimeAsync(10500)
      expect(hydrate.mock.calls.length).toBeGreaterThanOrEqual(4)
      expect(dispatched).toEqual([7])
      version = 8
      await vi.advanceTimersByTimeAsync(3500)
      expect(dispatched).toEqual([7, 8])
      const calls = hydrate.mock.calls.length
      await vi.advanceTimersByTimeAsync(3500)
      expect(hydrate.mock.calls.length).toBeGreaterThan(calls)
      window.removeEventListener('game-night-remote-state', listener)
      await application.backToEvents()
    } finally { vi.useRealTimers() }
  })
})
