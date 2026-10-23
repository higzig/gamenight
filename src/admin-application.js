import { localCalendarDate } from './event-chooser.js'
import { friendlyHostError } from './host/action-runner.js'
import { classifyProjects, projectsMarkup } from './host/projects.js'
import { isSnapshotChange, realtimeRecovery, shouldPollEvent, snapshotFingerprint, stateVersion } from './state-sync.js'
import { RECOMMENDED_LINEUP, toGameTypes } from './host/game-catalog.js'

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
  let hydratePromise = null
  let hydrateQueued = false
  let acceptedVersion = -1
  let acceptedFingerprint = null
  let recoveryTimer = null
  let resubscribeTimer = null

  const esc = (value = '') => String(value).replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[c])

  function transition(nextState) {
    state = nextState
    const active = nextState === 'active-event'
    gateway.hidden = active
    dashboard.hidden = !active
    gateway.dataset.appState = nextState
    dashboard.dataset.appState = nextState
  }

  function card(content, className = '') {
    gateway.innerHTML = `<section class="auth-card ${className}">${content}</section>`
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

  async function renderEventChooser() {
    transition('choosing-event')
    createPending = false
    try {
      const { current, archived } = classifyProjects(await services.listProjects(client))
      gateway.innerHTML = projectsMarkup({ current, archived })
      doc.querySelectorAll('.open-event').forEach(button => button.onclick = () => openEvent(button.dataset.id))
      doc.querySelectorAll('.delete-event').forEach(button => button.onclick = async () => {if(!win.confirm(`Delete “${button.dataset.name}” permanently? Its teams, games, answers and scores will be removed.`))return;button.disabled=true;button.textContent='Deleting…';try{await services.deleteOwnedEvent(client,button.dataset.id);await renderEventChooser()}catch(error){console.error(error);button.disabled=false;button.textContent='Delete project';errorTarget(friendlyHostError(error,'Could not delete that project. Refresh and try again.'))}})
      doc.getElementById('chooserLogout').onclick = logout
      doc.getElementById('newProjectButton').onclick = openNewProject
      if (doc.getElementById('newProjectCard')) doc.getElementById('newProjectCard').onclick = openNewProject
      doc.getElementById('cancelNewProject').onclick = closeNewProject
      doc.getElementById('newProjectBackdrop').onclick = closeNewProject
      doc.getElementById('newProjectForm').onsubmit = handleCreateProject
      doc.getElementById('newProjectModal').onkeydown = event => { if (event.key === 'Escape') closeNewProject() }
    } catch (error) {
      console.error(error); renderSignIn(friendlyHostError(error, 'Could not load your projects.'))
    }
  }

  function openNewProject() {
    if (createPending) return
    doc.getElementById('newProjectModal').hidden = false; doc.getElementById('newProjectBackdrop').hidden = false
    doc.getElementById('newProjectError').hidden = true
    doc.getElementById('newProjectName').focus()
  }

  function closeNewProject() {
    if (createPending) return
    doc.getElementById('newProjectModal').hidden = true; doc.getElementById('newProjectBackdrop').hidden = true
    doc.getElementById('newProjectButton').focus()
  }

  async function handleCreateProject(event) {
    event.preventDefault()
    if (createPending) return
    const input = doc.getElementById('newProjectName'), error = doc.getElementById('newProjectError'), button = doc.getElementById('createProjectSubmit')
    const name = input.value.trim()
    const fail = message => { error.textContent = message; error.hidden = false; input.focus() }
    if (!name) return fail('Give your project a name.')
    createPending = true; error.hidden = true
    button.disabled = true; button.textContent = 'Creating…'; doc.getElementById('cancelNewProject').disabled = true
    try {
      // New projects get the recommended games in the same transaction that creates them.
      const id = await services.createProject(client, { name, lineup: toGameTypes(RECOMMENDED_LINEUP), eventDate: localCalendarDate() })
      await openEvent(id)
    } catch (failure) {
      console.error(failure)
      createPending = false; button.disabled = false; button.textContent = 'Create Project →'; doc.getElementById('cancelNewProject').disabled = false
      fail(friendlyHostError(failure, 'Could not create the project. Nothing was saved, so you can safely try again.'))
    }
  }

  async function openEvent(eventId) {
    const snapshot = await services.hydrateHostEvent(client, eventId)
    activeEventId = eventId
    acceptedVersion = stateVersion(snapshot)
    acceptedFingerprint = snapshotFingerprint(snapshot)
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
      searchCelebrities: query => services.searchCelebrityLibrary(client, query),
      saveCelebrity: celebrity => services.saveCelebrityRecord(client, celebrity),
      uploadCelebrityImage: (celebrityId, blob) => services.uploadCelebrityImage(client, celebrityId, blob),
      markWikipediaChecked: celebrityId => services.markWikipediaChecked(client, celebrityId),
      saveIBetYouSettings: categories => services.saveIBetYouSettings(client,eventId,categories).then(refreshActiveEvent),
      setupIBetYou: () => services.setupIBetYouRound(client,eventId).then(refreshActiveEvent),
      swapIBetYouTeams: (teamA,teamB) => services.swapIBetYouTeams(client,eventId,teamA,teamB).then(refreshActiveEvent),
      changeIBetYouCategory: groupId => services.changeIBetYouCategory(client,groupId).then(refreshActiveEvent),
      setIBetYouBid: (groupId,bidderId,bid) => services.setIBetYouBid(client,groupId,bidderId,bid).then(refreshActiveEvent),
      challengeIBetYou: (groupId,challengerId) => services.challengeIBetYou(client,groupId,challengerId).then(refreshActiveEvent),
      correctIBetYou: (groupId,bidderId,challengerId,target) => services.correctIBetYouShowdown(client,groupId,bidderId,challengerId,target).then(refreshActiveEvent),
      startIBetYouTimer: groupId => services.startIBetYouTimer(client,groupId).then(refreshActiveEvent),
      judgeIBetYou: (groupId,success) => services.judgeIBetYouGroup(client,groupId,success).then(refreshActiveEvent),
      nextIBetYou: groupId => services.nextIBetYouGroup(client,groupId).then(refreshActiveEvent),
      resetIBetYou: groupId => services.resetIBetYouGroup(client,groupId).then(refreshActiveEvent),
      setupNoContext: prompts => services.setupNoContext(client,eventId,prompts).then(refreshActiveEvent),
      controlNoContext: (playId,action) => services.controlNoContext(client,eventId,playId,action).then(refreshActiveEvent),
      savePerfectLie: (title,categories) => services.savePerfectLieRound(client,eventId,title,categories).then(refreshActiveEvent),
      startPerfectLieQuestion: questionId => services.startPerfectLieQuestion(client,eventId,questionId).then(refreshActiveEvent),
      closePerfectLieWriting: () => services.closePerfectLieWriting(client,eventId).then(refreshActiveEvent),
      startPerfectLieReveal: () => services.startPerfectLieReveal(client,eventId).then(refreshActiveEvent),
      advancePerfectLieReveal: () => services.advancePerfectLieReveal(client,eventId).then(refreshActiveEvent),
      advancePerfectLieQuestion: questionId => services.advancePerfectLieQuestion(client,eventId,questionId).then(refreshActiveEvent),
      selectGame: roundId => services.selectHostedGame(client,eventId,roundId).then(refreshActiveEvent),
      resumeGame: roundId => services.resumeHostedGame(client,eventId,roundId).then(refreshActiveEvent),
      activateRound: roundId => services.activateHostedRound(client,eventId,roundId).then(refreshActiveEvent),
      setLineup: (gameTypes, expectedRevision) => services.setEventLineup(client,eventId,gameTypes,expectedRevision).then(refreshActiveEvent),
      startGameNight: () => services.startGameNight(client,eventId).then(refreshActiveEvent),
      startNewSession: async () => {
        const lineup = (win.gameNightRemoteSession?.lineup?.games || []).map(game => game.game_type)
        const newId = await services.copyEventSession(client, eventId)
        // The new room keeps tonight's running order (lineup only; no gameplay is copied).
        if (lineup.length) await services.setEventLineup(client, newId, lineup, null).catch(console.error)
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
    if(hydratePromise){hydrateQueued=true;return hydratePromise}
    const request=(async()=>{
      const snapshot=await services.hydrateHostEvent(client,activeEventId)
      // Unchanged or stale snapshots keep the current view (and keep recovery polling alive).
      if(!isSnapshotChange(snapshot,acceptedVersion,acceptedFingerprint)){scheduleRecovery();return win.gameNightRemoteSession}
      acceptedVersion=stateVersion(snapshot);acceptedFingerprint=snapshotFingerprint(snapshot)
      win.gameNightRemoteSession=snapshot
      win.dispatchEvent(new CustomEvent('game-night-remote-state',{detail:snapshot}))
      scheduleRecovery()
      return snapshot
    })()
    hydratePromise=request
    try{return await request}finally{if(hydratePromise===request)hydratePromise=null;if(hydrateQueued){hydrateQueued=false;queueMicrotask(()=>refreshActiveEvent().catch(console.error))}}
  }

  function scheduleRecovery(){clearTimeout(recoveryTimer);if(!shouldPollEvent(win.gameNightRemoteSession,{hidden:doc.hidden}))return;recoveryTimer=setTimeout(()=>refreshActiveEvent().catch(console.error),3500)}

  async function subscribeToEvent(eventId) {
    clearTimeout(resubscribeTimer)
    if (activeChannel) await client.removeChannel(activeChannel)
    const next = client.channel(`event:${eventId}:public`, { config: { private: true } })
      .on('broadcast', { event: 'state_changed' }, refreshActiveEvent)
    activeChannel=next
    next.subscribe(status => {if(activeChannel!==next)return;const action=realtimeRecovery(status);if(action==='hydrate')refreshActiveEvent().catch(console.error);if(action==='resubscribe')resubscribeTimer=setTimeout(()=>subscribeToEvent(eventId).catch(console.error),1500)})
    scheduleRecovery()
  }

  async function backToEvents() {
    clearTimeout(recoveryTimer);clearTimeout(resubscribeTimer)
    if (activeChannel) await client.removeChannel(activeChannel)
    activeChannel = null; activeEventId = null; win.gameNightRemoteSession = null; win.gameNightSupabaseActions = null
    await renderEventChooser()
  }

  async function logout() {
    clearTimeout(recoveryTimer);clearTimeout(resubscribeTimer)
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

  doc.addEventListener('visibilitychange',()=>{if(!doc.hidden&&activeEventId)refreshActiveEvent().catch(console.error)})
  win.addEventListener('online',()=>{if(activeEventId){refreshActiveEvent().catch(console.error);subscribeToEvent(activeEventId).catch(console.error)}})
  win.addEventListener('focus',()=>{if(activeEventId)refreshActiveEvent().catch(console.error)})

  return { init, openEvent, backToEvents, logout, refreshActiveEvent, getState: () => state }
}
