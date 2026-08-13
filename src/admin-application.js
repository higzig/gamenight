export function createAdminApplication({
  client,
  configError,
  services,
  loadLegacyAdmin,
  doc = document,
  win = window,
}) {
  const gateway = doc.getElementById('adminGateway')
  const dashboard = doc.getElementById('adminApp')
  let state = 'checking-session'
  let activeEventId = null
  let activeChannel = null
  let legacyLoaded = false
  let createPending = false

  const esc = (value = '') => String(value).replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[c])

  function transition(nextState) {
    state = nextState
    const active = nextState === 'active-event'
    gateway.hidden = active
    dashboard.hidden = !active
    gateway.dataset.appState = nextState
    dashboard.dataset.appState = nextState
  }

  function card(content) {
    gateway.innerHTML = `<section class="auth-card">${content}</section>`
  }

  function errorTarget(message) {
    const target = doc.getElementById('gatewayError')
    if (target) target.textContent = message
  }

  function renderCheckingSession() {
    transition('checking-session')
    card('<p class="eyebrow">HOST ADMIN</p><h1>Loading Game Night…</h1><p>Checking your secure Host session.</p>')
  }

  function renderSignIn(message = '') {
    transition('signed-out')
    card(`<p class="eyebrow">HOST ADMIN</p><h1>Sign in to Game Night</h1><p>Use your permanent Host account. Anonymous device sessions cannot access Admin events.</p>
      <form class="auth-form" id="hostSignIn"><label>Email<input id="hostEmail" type="email" autocomplete="email" required></label><label>Password<input id="hostPassword" type="password" autocomplete="current-password" required></label><button class="btn primary" type="submit">Sign in</button></form>
      <p class="auth-error" id="gatewayError">${esc(message)}</p>`)
    doc.getElementById('hostSignIn').onsubmit = async event => {
      event.preventDefault(); errorTarget('')
      const button = event.submitter; button.disabled = true
      const { data, error } = await client.auth.signInWithPassword({ email: doc.getElementById('hostEmail').value, password: doc.getElementById('hostPassword').value })
      button.disabled = false
      if (error) return errorTarget('Sign-in failed. Check your email and password.')
      if (services.isAnonymousUser(data.user)) { await client.auth.signOut(); return renderSignIn('A permanent Host account is required.') }
      await renderEventChooser()
    }
  }

  const createEventForm = () => `<form class="auth-form" id="createRemoteEvent"><label>Event name<input id="newEventName" maxlength="120" required value="Thursday Game Night"></label><label>Venue<input id="newEventVenue" maxlength="160" value="The Local"></label><label>Event date<input id="newEventDate" type="date" required value="${new Date().toISOString().slice(0, 10)}"></label><label>Expected teams<input id="newExpectedTeams" type="number" min="1" max="100" required value="12"></label><button class="btn primary" id="createEventButton" type="submit">Create event and open lobby</button></form>`

  async function renderEventChooser() {
    transition('choosing-event')
    try {
      const events = await services.listOwnedEvents(client)
      card(`<p class="eyebrow">YOUR EVENTS</p><h1>Choose a Game Night</h1><p>Open an existing event or create a new six-character room.</p>
        <div id="ownedEvents">${events.map(event => `<div class="event-choice"><div><strong>${esc(event.name)}</strong><span>${esc(event.room_code)} · ${esc(event.event_date)} · ${esc(event.status)}</span></div><button class="btn secondary open-event" data-id="${event.id}">Open</button></div>`).join('') || '<p>No events yet.</p>'}</div>
        <h2 style="margin-top:24px">Create event</h2>${createEventForm()}<p class="auth-error" id="gatewayError"></p><div class="auth-actions"><button class="btn ghost" id="chooserLogout">Log out</button></div>`)
      doc.querySelectorAll('.open-event').forEach(button => button.onclick = () => openEvent(button.dataset.id))
      doc.getElementById('chooserLogout').onclick = logout
      doc.getElementById('createRemoteEvent').onsubmit = handleCreateEvent
    } catch (error) {
      console.error(error); renderSignIn('Could not load Host events.')
    }
  }

  async function handleCreateEvent(event) {
    event.preventDefault()
    if (createPending) return
    createPending = true; errorTarget('')
    const button = doc.getElementById('createEventButton')
    button.disabled = true; button.textContent = 'Creating game night…'
    try {
      const id = await services.createJoinableEvent(client, {
        name: doc.getElementById('newEventName').value.trim(),
        venue: doc.getElementById('newEventVenue').value.trim(),
        eventDate: doc.getElementById('newEventDate').value,
        expectedTeams: Number(doc.getElementById('newExpectedTeams').value),
      })
      await openEvent(id)
    } catch (error) {
      console.error(error)
      createPending = false; button.disabled = false; button.textContent = 'Create event and open lobby'
      errorTarget('Could not create the event. Check the details and try again. No additional attempt was made.')
    }
  }

  async function openEvent(eventId) {
    const snapshot = await services.hydrateHostEvent(client, eventId)
    activeEventId = eventId
    win.gameNightRemoteSession = snapshot
    win.gameNightSupabaseActions = {
      saveGuessAgeRound: (title, celebrities) => services.saveGuessAgeRound(client, eventId, title, celebrities).then(refreshActiveEvent),
      startQuestion: questionId => services.startRemoteQuestion(client, eventId, questionId).then(refreshActiveEvent),
      lockQuestion: () => services.lockRemoteQuestion(client, eventId).then(refreshActiveEvent),
      revealQuestion: () => services.revealRemoteQuestion(client, eventId).then(refreshActiveEvent),
      advanceQuestion: () => services.advanceRemoteQuestion(client, eventId).then(refreshActiveEvent),
      setDisplay: status => services.setRemoteDisplay(client, eventId, status).then(refreshActiveEvent),
      restartRound: () => services.restartGuessAgeRound(client, eventId).then(refreshActiveEvent),
      reorderQuestion: (questionId, direction) => services.reorderGuessAgeQuestion(client, eventId, questionId, direction).then(refreshActiveEvent),
      startNewSession: async () => {
        const newId = await services.copyEventSession(client, eventId)
        await openEvent(newId)
        return newId
      },
      refresh: refreshActiveEvent,
    }
    if (!legacyLoaded) { legacyLoaded = true; await loadLegacyAdmin() }
    transition('active-event')
    win.dispatchEvent(new CustomEvent('game-night-remote-state', { detail: snapshot }))
    await subscribeToEvent(eventId)
  }

  async function refreshActiveEvent() {
    if (!activeEventId) return
    const snapshot = await services.hydrateHostEvent(client, activeEventId)
    win.gameNightRemoteSession = snapshot
    win.dispatchEvent(new CustomEvent('game-night-remote-state', { detail: snapshot }))
  }

  async function subscribeToEvent(eventId) {
    if (activeChannel) await client.removeChannel(activeChannel)
    activeChannel = client.channel(`event:${eventId}:public`, { config: { private: true } })
      .on('broadcast', { event: 'state_changed' }, refreshActiveEvent)
      .subscribe(status => { if (status === 'SUBSCRIBED') refreshActiveEvent().catch(console.error) })
  }

  async function backToEvents() {
    if (activeChannel) await client.removeChannel(activeChannel)
    activeChannel = null; activeEventId = null; win.gameNightRemoteSession = null; win.gameNightSupabaseActions = null
    await renderEventChooser()
  }

  async function logout() {
    if (activeChannel) await client.removeChannel(activeChannel)
    activeChannel = null; activeEventId = null; win.gameNightRemoteSession = null; win.gameNightSupabaseActions = null
    await client.auth.signOut(); renderSignIn()
  }

  async function init() {
    renderCheckingSession()
    if (configError) return card(`<p class="eyebrow">CONFIGURATION REQUIRED</p><h1>Supabase is not configured</h1><p>${esc(configError)} Add the two Vite environment values and restart the development server.</p>`)
    const { data, error } = await client.auth.getSession()
    if (error || !data.session || services.isAnonymousUser(data.session.user)) {
      if (data.session) await client.auth.signOut()
      return renderSignIn()
    }
    await renderEventChooser()
  }

  return { init, openEvent, backToEvents, logout, refreshActiveEvent, getState: () => state }
}
