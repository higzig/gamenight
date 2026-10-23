import { GAME_CATALOG, GAME_ORDER } from './game-catalog.js'
import { MAX_LINEUP } from './lineup.js'

const esc = (value = '') => String(value).replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[c])

export const STATE_LABELS = { needs_setup: 'Needs Setup', ready: 'Ready', live: 'Live', paused: 'Paused', complete: 'Completed' }

// Upcoming games can be edited, replaced, removed and reordered; played games keep their place.
export const isMovable = game => game.editable

function summary(game) {
  if (game.configIssue) return game.configIssue
  const settings = game.settings || {}
  if (game.type === 'guessAge') { const n = settings.celebrities?.length || 0; return `${n} ${n === 1 ? 'celebrity' : 'celebrities'}${game.remote ? '' : ' · starter lineup'}` }
  if (game.type === 'perfectLie') { const n = (settings.categories || []).reduce((sum, c) => sum + (c.questions?.length || 0), 0); return `${n} ${n === 1 ? 'question' : 'questions'} in ${settings.categories.length} ${settings.categories.length === 1 ? 'category' : 'categories'}` }
  if (game.type === 'iBetYou') { const n = (settings.categories || []).filter(c => c.selected).length; return `${n} ${n === 1 ? 'category' : 'categories'} selected` }
  if (game.type === 'noContext') return '5 picture prompts'
  return ''
}

function cardActions(game, { started, busy, index, games }) {
  const dis = busy ? ' disabled' : ''
  const name = esc(GAME_CATALOG[game.type].name)
  if (game.state === 'live') return `<button class="btn primary gn-card-primary" data-action="open-live" data-type="${game.type}"${dis}>Open controls →</button>`
  if (game.state === 'paused') return `<button class="btn primary gn-card-primary" data-action="start-game" data-type="${game.type}"${dis}>Resume →</button>`
  if (game.state === 'complete') return `<button class="btn secondary gn-card-primary" data-action="history" data-type="${game.type}"${dis}>Results &amp; more</button>`
  const primary = game.state === 'needs_setup'
    ? `<button class="btn primary gn-card-primary" data-action="edit" data-type="${game.type}"${dis}>Set up</button>`
    : started
      ? `<button class="btn primary gn-card-primary" data-action="start-game" data-type="${game.type}"${dis}>▶ Start game</button>`
      : `<button class="btn primary gn-card-primary" data-action="edit" data-type="${game.type}"${dis}>Edit</button>`
  const canUp = index > 0 && isMovable(games[index - 1]), canDown = index < games.length - 1 && isMovable(games[index + 1])
  const tools = [
    started && game.state === 'ready' ? `<button class="gn-tool" data-action="edit" data-type="${game.type}"${dis}>Edit</button>` : '',
    `<button class="gn-tool" data-action="replace" data-type="${game.type}"${dis}>Replace</button>`,
    `<button class="gn-tool gn-tool-danger" data-action="remove" data-type="${game.type}"${dis}>Remove</button>`,
    `<span class="gn-move"><button class="gn-tool" data-action="move-up" data-type="${game.type}" aria-label="Move ${name} earlier"${canUp && !busy ? '' : ' disabled'}>↑</button><button class="gn-tool" data-action="move-down" data-type="${game.type}" aria-label="Move ${name} later"${canDown && !busy ? '' : ' disabled'}>↓</button></span>`,
  ].join('')
  return `${primary}<div class="gn-tools" role="group" aria-label="${name} options">${tools}</div>`
}

function card(game, context) {
  const info = GAME_CATALOG[game.type], movable = isMovable(game) && !context.busy
  return `<article class="gn-card" data-game="${game.type}" data-type="${game.type}" data-state="${game.state}"${movable ? ' draggable="true"' : ''}>
    <div class="gn-card-art">${info.art}<span class="gn-card-order" aria-label="Game ${game.position}">${String(game.position).padStart(2, '0')}</span>${movable ? '<span class="gn-drag-hint" aria-hidden="true">⋮⋮</span>' : ''}</div>
    <div class="gn-card-body">
      <span class="gn-status gn-status-${game.state}">${game.state === 'live' ? '● ' : ''}${STATE_LABELS[game.state]}</span>
      <h3>${esc(info.name)}</h3>
      <p class="gn-card-desc">${esc(info.description)}</p>
      <ul class="gn-meta"><li><span aria-hidden="true">⏱</span> ${esc(info.duration)}</li><li><span aria-hidden="true">👥</span> ${esc(info.teams)}</li></ul>
      <p class="gn-config-line${game.configIssue ? ' gn-config-missing' : ''}">${esc(summary(game))}</p>
    </div>
    <div class="gn-card-actions">${cardActions(game, context)}</div>
  </article>`
}

function heroAction(model) {
  const { live, pausedGame, started, next, games, finished, startCheck, busy } = model, dis = busy ? ' disabled' : ''
  if (live) return `<button class="btn primary gn-hero-primary gn-live-pill" data-game="${live.type}" data-action="open-live" data-type="${live.type}"${dis}>● LIVE — ${esc(GAME_CATALOG[live.type].name)} — Open controls →</button>`
  if (pausedGame) return `<button class="btn primary gn-hero-primary" data-action="open-live" data-type="${pausedGame.type}"${dis}>Paused — ${esc(GAME_CATALOG[pausedGame.type].name)} →</button>`
  if (!games.length) return `<button class="btn primary gn-hero-primary" data-action="add"${dis}>+ Add Game</button>`
  if (!started) return `<button class="btn primary gn-hero-primary" data-action="start-night"${startCheck.canStart && !busy ? '' : ' disabled'} aria-describedby="startNightReason">▶ Start Game Night</button>`
  if (next?.state === 'ready') return `<button class="btn primary gn-hero-primary" data-action="start-game" data-type="${next.type}"${dis}>▶ Start ${esc(GAME_CATALOG[next.type].name)}</button>`
  if (next) return `<button class="btn primary gn-hero-primary" data-action="edit" data-type="${next.type}"${dis}>Set up ${esc(GAME_CATALOG[next.type].name)}</button>`
  if (finished) return `<button class="btn secondary gn-hero-primary" data-action="leaderboard"${dis}>View leaderboard →</button>`
  return `<button class="btn primary gn-hero-primary" data-action="finish-night"${dis}>Finish Night →</button>`
}

function heroNote(model) {
  const { live, started, games, startCheck, next, finished } = model
  const fixes = startCheck.blocking.map(game => ` <button class="gn-inline-link" data-action="edit" data-type="${game.type}">Set up ${esc(GAME_CATALOG[game.type].name)}</button>`).join('')
  if (live) return 'Your game keeps running while you look around. The Audience screen follows the game, not this page.'
  if (!started && startCheck.blocking.length) return `Teams can join as soon as you start. ${esc(startCheck.reason)}${fixes}`
  if (!started) return games.length ? 'Starting the night puts the join screen on the Audience display so teams can scan in.' : esc(startCheck.reason)
  if (next) return next.error && next.state === 'ready' ? esc(next.error) : next.state === 'needs_setup' ? `${esc(GAME_CATALOG[next.type].name)} needs setting up before it can start.` : `Up next: ${esc(GAME_CATALOG[next.type].name)}.`
  if (finished) return 'The night is finished. Final standings are on the Audience screen.'
  return games.length ? 'Every game is complete. Finish the night to show the final standings.' : 'Add your first game to begin.'
}

export const NIGHT_STATUS_LABELS = { live: 'Live', paused: 'Paused', finished: 'Finished', hosting: 'Hosting', planning: 'Planning' }
export function nightStatus({ live, pausedGame, finished, started }) {
  return live ? 'live' : pausedGame ? 'paused' : finished ? 'finished' : started ? 'hosting' : 'planning'
}

// The project name is the page heading (top bar). This strip only carries status and actions.
export function dashboardMarkup(model) {
  const { event, teamCount, games, started, busy } = model
  const context = { started, busy, games }
  const cards = games.map((game, index) => card(game, { ...context, index })).join('')
  const empty = games.length < MAX_LINEUP
    ? `<button class="gn-card gn-empty" data-action="add"${busy ? ' disabled' : ''}><span class="gn-empty-plus" aria-hidden="true">+</span><strong>Add Game</strong><small>Choose from the game library</small></button>`
    : '<p class="gn-all-added">All four games are in tonight’s line-up.</p>'
  const status = nightStatus(model)
  return `<section class="gn-hero" data-game="${model.live?.type || 'brand'}" aria-label="Project status">
      <div class="gn-hero-info">
        <span class="gn-night-pill gn-night-${status}">${status === 'live' ? '● ' : ''}${NIGHT_STATUS_LABELS[status]}</span>
        <button class="gn-chip" data-action="copy-link" title="Copy the team join link"><span>ROOM</span><strong>${esc(event.roomCode)}</strong></button>
        <button class="gn-chip" data-action="teams"><span>TEAMS</span><strong>${teamCount}</strong><em>Manage →</em></button>
      </div>
      <div class="gn-hero-action">${heroAction(model)}<p class="gn-hero-note" id="startNightReason">${heroNote(model)}</p></div>
    </section>
    <div class="gn-section-head"><div><p class="eyebrow">THE RUNNING ORDER</p><h2>Tonight’s Games</h2></div><p class="gn-section-hint">Drag cards or use ↑ ↓ to reorder.</p></div>
    <div class="gn-gallery" id="gameGallery">${cards}${empty}</div>
    <p class="visually-hidden" id="dashAnnounce" aria-live="polite"></p>`
}

export function libraryMarkup({ mode = 'add', target = null, lineup = [] }) {
  const replacing = mode === 'replace' && target
  return `<p class="gn-library-intro">${replacing ? `Choose a game to take ${esc(GAME_CATALOG[target].name)}’s place in the running order.` : 'Each game can be played once per night.'}</p>
  <div class="gn-library">${GAME_ORDER.map(type => {
    const game = GAME_CATALOG[type], inLineup = lineup.includes(type), current = type === target
    const label = current ? 'Current game' : inLineup ? 'In tonight’s line-up' : replacing ? `Replace with ${esc(game.name)}` : 'Add to tonight →'
    return `<article class="gn-library-item" data-game="${type}">
      <div class="gn-library-art">${game.art}</div>
      <div class="gn-library-body"><h3>${esc(game.name)}</h3><p>${esc(game.description)}</p>
        <ul class="gn-meta"><li><span aria-hidden="true">⏱</span> ${esc(game.duration)}</li><li><span aria-hidden="true">👥</span> ${esc(game.teams)}</li></ul>
        <details class="gn-how"><summary>How to play</summary><ol>${game.howToPlay.map(step => `<li>${esc(step)}</li>`).join('')}</ol></details>
        <button class="btn ${inLineup ? 'secondary' : 'primary'}" data-library-pick="${type}"${inLineup ? ' disabled' : ''}>${label}</button>
      </div></article>`
  }).join('')}</div>`
}

export function configHeaderMarkup(game) {
  const info = GAME_CATALOG[game.type]
  return `<div class="gn-config-art">${info.art}</div><div><p class="eyebrow">GAME SETTINGS</p><h2>${esc(info.name)}</h2><p>${esc(info.description)}</p>${game.state ? `<span class="gn-status gn-status-${game.state}">${STATE_LABELS[game.state]}</span>` : ''}</div>`
}

// Event delegation keeps handlers stable across re-renders. Drag-and-drop is a desktop
// convenience; the ↑/↓ buttons are the accessible equivalent.
export function bindDashboard(root, handlers, getGames) {
  if (root.dataset.bound) return
  root.dataset.bound = 'true'
  root.addEventListener('click', event => {
    const button = event.target.closest('[data-action]')
    if (!button || button.disabled || !root.contains(button)) return
    handlers.action?.(button.dataset.action, button.dataset.type || null, button)
  })
  let dragging = null
  root.addEventListener('dragstart', event => {
    const cardEl = event.target.closest?.('.gn-card[draggable="true"]')
    if (!cardEl) return
    dragging = cardEl.dataset.type
    cardEl.classList.add('gn-dragging')
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', dragging)
  })
  const targetCard = event => {
    const cardEl = event.target.closest?.('.gn-card[data-type]')
    if (!dragging || !cardEl || cardEl.dataset.type === dragging) return null
    return getGames().find(game => game.type === cardEl.dataset.type && isMovable(game)) ? cardEl : null
  }
  root.addEventListener('dragover', event => {
    const cardEl = targetCard(event)
    if (!cardEl) return
    event.preventDefault()
    root.querySelectorAll('.gn-drop-target').forEach(el => el !== cardEl && el.classList.remove('gn-drop-target'))
    cardEl.classList.add('gn-drop-target')
  })
  root.addEventListener('drop', event => {
    const cardEl = targetCard(event)
    if (!cardEl) return
    event.preventDefault()
    const games = getGames(), to = games.findIndex(game => game.type === cardEl.dataset.type)
    handlers.move?.(dragging, to)
  })
  root.addEventListener('dragend', () => {
    dragging = null
    root.querySelectorAll('.gn-dragging,.gn-drop-target').forEach(el => el.classList.remove('gn-dragging', 'gn-drop-target'))
  })
}
