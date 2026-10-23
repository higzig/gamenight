import { GAME_CATALOG, TYPE_FOR_GAME_TYPE } from './game-catalog.js'
import { formatEventDate, localCalendarDate } from '../event-chooser.js'

const esc = (value = '') => String(value).replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[c])
const LIVE = new Set(['question', 'suspense', 'locked', 'reveal'])

export function projectStatus(project) {
  if (LIVE.has(project.status)) return 'live'
  if (project.started_at || !['draft', 'lobby'].includes(project.status)) return 'hosting'
  return 'planning'
}
const STATUS_LABEL = { live: '● Live', hosting: 'Hosting', planning: 'Planning' }

// A project is archived once its date has passed and it has been hosted. Projects that are still
// being prepared stay in My Projects whatever their date.
export function classifyProjects(projects, today = localCalendarDate()) {
  const current = [], archived = []
  for (const project of projects) (project.event_date < today && projectStatus(project) !== 'planning' ? archived : current).push(project)
  const rank = project => ({ live: 0, hosting: 1, planning: 2 })[projectStatus(project)]
  current.sort((a, b) => rank(a) - rank(b) || String(b.created_at).localeCompare(String(a.created_at)))
  archived.sort((a, b) => b.event_date.localeCompare(a.event_date) || String(a.name).localeCompare(String(b.name)))
  return { current, archived }
}

function gameChips(gameTypes = []) {
  const types = gameTypes.map(type => TYPE_FOR_GAME_TYPE[type]).filter(Boolean)
  if (!types.length) return '<p class="gn-project-games gn-project-empty">No games yet</p>'
  return `<ul class="gn-project-games" aria-label="Games">${types.map(type => `<li data-game="${type}"><span aria-hidden="true">${GAME_CATALOG[type].icon}</span>${esc(GAME_CATALOG[type].name)}</li>`).join('')}</ul>`
}

export function projectCard(project) {
  const status = projectStatus(project), count = (project.games || []).length
  return `<article class="gn-project" data-project-id="${esc(project.id)}" data-status="${status}">
    <div class="gn-project-top"><span class="gn-status gn-status-${status === 'live' ? 'live' : status === 'hosting' ? 'ready' : 'paused'}">${STATUS_LABEL[status]}</span>
      <details class="event-overflow gn-project-menu"><summary class="icon-btn" aria-label="More actions for ${esc(project.name)}">•••</summary><div><button class="delete-event danger-link" data-id="${esc(project.id)}" data-name="${esc(project.name)}">Delete project</button></div></details></div>
    <h3>${esc(project.name)}</h3>
    <p class="gn-project-meta">${[project.event_date ? formatEventDate(project.event_date) : '', `${count} ${count === 1 ? 'game' : 'games'}`, `Room ${esc(project.room_code)}`].filter(Boolean).join(' · ')}</p>
    ${gameChips(project.games)}
    <button class="btn primary open-event" data-id="${esc(project.id)}">Open Project →</button>
  </article>`
}

export function projectsMarkup({ current, archived }) {
  return `<section class="gn-projects">
    <header class="gn-projects-head">
      <div class="gn-projects-brand"><div class="brand-mark">GN</div><span>Game Night</span></div>
      <button class="btn ghost" id="chooserLogout">Log out</button>
    </header>
    <div class="gn-projects-title"><div><h1>My Projects</h1><p>Create, prepare and host your game nights.</p></div>
      <button class="btn primary gn-new-project" id="newProjectButton">+ New Project</button></div>
    <p class="auth-error" id="gatewayError" role="alert"></p>
    <div class="gn-project-grid" id="ownedEvents">${current.map(projectCard).join('') || `<button class="gn-project gn-project-new" id="newProjectCard"><span class="gn-empty-plus" aria-hidden="true">+</span><strong>Create your first project</strong><small>Guess the Age, No Context and I Bet You are added for you.</small></button>`}</div>
    ${archived.length ? `<details class="gn-archived"><summary>Archived Projects (${archived.length})</summary><div class="gn-project-grid" id="archivedEventList">${archived.map(projectCard).join('')}</div></details>` : ''}
    ${newProjectModalMarkup()}
  </section>`
}

export function newProjectModalMarkup() {
  return `<div class="gn-project-modal-backdrop" id="newProjectBackdrop" hidden></div>
  <div class="gn-project-modal" id="newProjectModal" role="dialog" aria-modal="true" aria-labelledby="newProjectTitle" hidden>
    <form id="newProjectForm" novalidate>
      <h2 id="newProjectTitle">Create a Project</h2>
      <p>Give your game night a name. You can customise everything else later.</p>
      <label for="newProjectName">Project Name</label>
      <input id="newProjectName" maxlength="120" autocomplete="off" required placeholder="e.g. Friday Night Quiz">
      <p class="gn-modal-error" id="newProjectError" role="alert" hidden></p>
      <div class="gn-modal-actions"><button type="button" class="btn ghost" id="cancelNewProject">Cancel</button><button type="submit" class="btn primary" id="createProjectSubmit">Create Project →</button></div>
    </form>
  </div>`
}
