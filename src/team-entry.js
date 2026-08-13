import { createGameNightClient, getSupabaseConfigError } from './supabase-client.js'
import { ensureAnonymousSession, hydrateTeam, joinTeam, normalizeRoom, ROOM_PATTERN } from './team-service.js'

const root = document.getElementById('teamApp')
const supabase = createGameNightClient('game-night-team-auth')
const room = normalizeRoom(new URLSearchParams(location.search).get('room') ?? '')

function esc(value = '') {
  return String(value).replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[c])
}

function shell(content) {
  root.innerHTML = `<div class="app"><div class="top"><div class="brand"><div class="mark">GN</div>Game Night</div><div class="room">ROOM ${esc(room || 'LOCAL')}</div></div>${content}</div>`
}

function renderJoin(message = '') {
  shell(`<section class="card"><p class="eyebrow">JOIN GAME</p><h1>Join your Team</h1><div class="room-code">${esc(room)}</div><p class="muted">Enter a Team name for this device. Your secure anonymous session owns this Team membership.</p>${message ? `<div class="error-box">${esc(message)}</div>` : ''}<form id="remoteJoin"><div class="field"><label>Team name</label><input id="remoteTeamName" minlength="1" maxlength="80" autocomplete="organization" required></div><button class="btn primary full" type="submit">Join room</button></form><div class="phase-note">Phase 2A connects your Team identity. Live Guess the Age controls remain in the separate local prototype until the next gameplay phase.</div></section>`)
  document.getElementById('remoteJoin').onsubmit = async event => {
    event.preventDefault(); const button = event.submitter; button.disabled = true
    try {
      const state = await joinTeam(supabase, room, document.getElementById('remoteTeamName').value)
      renderJoined(state)
    } catch (error) {
      console.error(error); renderJoin('Unable to join that room. Check the code or ask the Host to open the lobby.')
    }
  }
}

function renderJoined(state) {
  const team = state?.team
  if (!team) return renderJoin()
  shell(`<div class="waiting"><section class="card"><div class="status-orb">✓</div><p class="eyebrow">TEAM JOINED</p><h1>${esc(team.name)}</h1><p class="muted">This device is securely joined to room ${esc(room)}. Refreshing will recover the same Team while this anonymous session remains on the device.</p><div class="phase-note">Gameplay is not connected to Supabase in Phase 2A. Keep this page open for identity and room verification only.</div></section></div>`)
}

async function initRemoteTeam() {
  const configError = getSupabaseConfigError()
  if (configError) return shell(`<section class="card"><h1>Configuration required</h1><div class="error-box">${esc(configError)}</div></section>`)
  shell('<div class="waiting"><section class="card"><div class="status-orb">…</div><p class="eyebrow">CONNECTING</p><h1>Joining room</h1></section></div>')
  try {
    await ensureAnonymousSession(supabase)
    const state = await hydrateTeam(supabase, room)
    state?.team ? renderJoined(state) : renderJoin()
  } catch (error) {
    console.error(error); renderJoin('Unable to connect to that room right now.')
  }
}

if (!room) {
  import('../team.js')
} else if (!ROOM_PATTERN.test(room)) {
  shell('<section class="card"><p class="eyebrow">INVALID ROOM</p><h1>Check the join link</h1><p class="muted">Room codes contain exactly six uppercase letters or numbers.</p></section>')
} else {
  initRemoteTeam()
}
