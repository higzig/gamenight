import { createGameNightClient, getSupabaseConfigError } from './supabase-client.js'
import { createJoinableEvent, hydrateHostEvent, isAnonymousUser, listOwnedEvents } from './host-service.js'

const gateway = document.getElementById('adminGateway')
const app = document.getElementById('adminApp')
const supabase = createGameNightClient('game-night-host-auth')
let activeChannel = null
let activeEventId = null

function esc(value = '') {
  return String(value).replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[c])
}

function card(content) {
  gateway.innerHTML = `<section class="auth-card">${content}</section>`
}

function showError(message) {
  const target = document.getElementById('gatewayError')
  if (target) target.textContent = message
}

function renderSignIn(message = '') {
  card(`<p class="eyebrow">HOST ADMIN</p><h1>Sign in to Game Night</h1><p>Use your permanent Host account. Anonymous device sessions cannot access Admin events.</p>
    <form class="auth-form" id="hostSignIn"><label>Email<input id="hostEmail" type="email" autocomplete="email" required></label><label>Password<input id="hostPassword" type="password" autocomplete="current-password" required></label><button class="btn primary" type="submit">Sign in</button></form>
    <p class="auth-error" id="gatewayError">${esc(message)}</p>`)
  document.getElementById('hostSignIn').onsubmit = async event => {
    event.preventDefault(); showError('')
    const button = event.submitter; button.disabled = true
    const { data, error } = await supabase.auth.signInWithPassword({
      email: document.getElementById('hostEmail').value,
      password: document.getElementById('hostPassword').value,
    })
    button.disabled = false
    if (error) return showError('Sign-in failed. Check your email and password.')
    if (isAnonymousUser(data.user)) { await supabase.auth.signOut(); return renderSignIn('A permanent Host account is required.') }
    await renderEventChooser()
  }
}

function createEventForm() {
  const defaultDate = new Date().toISOString().slice(0, 10)
  return `<form class="auth-form" id="createRemoteEvent"><label>Event name<input id="newEventName" maxlength="120" required value="Thursday Game Night"></label><label>Venue<input id="newEventVenue" maxlength="160" value="The Local"></label><label>Event date<input id="newEventDate" type="date" required value="${defaultDate}"></label><label>Expected teams<input id="newExpectedTeams" type="number" min="1" max="100" required value="12"></label><button class="btn primary" type="submit">Create event and open lobby</button></form>`
}

async function renderEventChooser() {
  try {
    const events = await listOwnedEvents(supabase)
    card(`<p class="eyebrow">YOUR EVENTS</p><h1>Choose a Game Night</h1><p>Open an existing event or create a new six-character room.</p>
      <div id="ownedEvents">${events.map(event => `<div class="event-choice"><div><strong>${esc(event.name)}</strong><span>${esc(event.room_code)} · ${esc(event.event_date)} · ${esc(event.status)}</span></div><button class="btn secondary open-event" data-id="${event.id}">Open</button></div>`).join('') || '<p>No events yet.</p>'}</div>
      <h2 style="margin-top:24px">Create event</h2>${createEventForm()}<p class="auth-error" id="gatewayError"></p><div class="auth-actions"><button class="btn ghost" id="chooserLogout">Log out</button></div>`)
    document.querySelectorAll('.open-event').forEach(button => button.onclick = () => openEvent(button.dataset.id))
    document.getElementById('chooserLogout').onclick = logout
    document.getElementById('createRemoteEvent').onsubmit = async event => {
      event.preventDefault(); showError(''); event.submitter.disabled = true
      try {
        const id = await createJoinableEvent(supabase, {
          name: document.getElementById('newEventName').value.trim(),
          venue: document.getElementById('newEventVenue').value.trim(),
          eventDate: document.getElementById('newEventDate').value,
          expectedTeams: Number(document.getElementById('newExpectedTeams').value),
        })
        await openEvent(id)
      } catch (error) {
        console.error(error); showError('Could not create the event. Check the details and try again.'); event.submitter.disabled = false
      }
    }
  } catch (error) {
    console.error(error); renderSignIn('Could not load Host events.')
  }
}

async function openEvent(eventId) {
  try {
    activeEventId = eventId
    const snapshot = await hydrateHostEvent(supabase, eventId)
    window.gameNightRemoteSession = snapshot
    gateway.hidden = true; app.hidden = false
    if (!window.gameNightLegacyAdminLoaded) {
      window.gameNightLegacyAdminLoaded = true
      await import('../admin.js')
    }
    window.dispatchEvent(new CustomEvent('game-night-remote-state', { detail: snapshot }))
    await subscribeToEvent(eventId)
  } catch (error) {
    console.error(error); showError('Could not open that event.')
  }
}

async function refreshActiveEvent() {
  if (!activeEventId) return
  const snapshot = await hydrateHostEvent(supabase, activeEventId)
  window.gameNightRemoteSession = snapshot
  window.dispatchEvent(new CustomEvent('game-night-remote-state', { detail: snapshot }))
}

async function subscribeToEvent(eventId) {
  if (activeChannel) await supabase.removeChannel(activeChannel)
  activeChannel = supabase.channel(`event:${eventId}:public`, { config: { private: true } })
    .on('broadcast', { event: 'state_changed' }, refreshActiveEvent)
    .subscribe(status => { if (status === 'SUBSCRIBED') refreshActiveEvent() })
}

async function logout() {
  if (activeChannel) await supabase.removeChannel(activeChannel)
  activeChannel = null; activeEventId = null; window.gameNightRemoteSession = null
  await supabase.auth.signOut(); location.reload()
}

async function init() {
  const configError = getSupabaseConfigError()
  if (configError) return card(`<p class="eyebrow">CONFIGURATION REQUIRED</p><h1>Supabase is not configured</h1><p>${esc(configError)} Add the two Vite environment values and restart the development server.</p>`)
  const { data, error } = await supabase.auth.getSession()
  if (error || !data.session || isAnonymousUser(data.session.user)) {
    if (data.session) await supabase.auth.signOut()
    return renderSignIn()
  }
  await renderEventChooser()
}

window.addEventListener('game-night-host-logout', logout)
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshActiveEvent().catch(console.error) })
init()
