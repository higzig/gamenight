// Game Night — Test Lab. Development only; excluded from production builds by vite.config.mjs.
import { testLabEnvironmentError } from './guard.js'
import { TEST_LAB_MARKER } from './content.js'

const $ = selector => document.querySelector(selector)
const esc = (value = '') => String(value).replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[c])
const url = import.meta.env.VITE_SUPABASE_URL, key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
document.documentElement.dataset.marker = TEST_LAB_MARKER

const refusal = testLabEnvironmentError({ dev: import.meta.env.DEV, mode: import.meta.env.MODE, supabaseUrl: url, pageHostname: location.hostname })
if (refusal) {
  $('#connection').textContent = 'Not local — refused'; $('#connection').className = 'lab-connection bad'
  $('#labBody').innerHTML = `<p class="lab-refusal"><strong>Test Lab will not run.</strong> ${esc(refusal)}</p>`
} else {
  // Only load Supabase clients once the environment is confirmed local.
  start()
}

async function start() {
  const [{ createGameNightClient }, host, { hydrateTeam }, captains, sim] = await Promise.all([
    import('../../src/supabase-client.js'), import('../../src/host-service.js'), import('../../src/team-service.js'), import('./captains.js'), import('./simulator.js'),
  ])
  const hostClient = createGameNightClient('game-night-host-auth')
  const settings = { mode: 'automatic', speed: 'normal', inactiveShare: 0.3, forceTie: false, accuracy: 0.35, target: 10, ...JSON.parse(localStorage.getItem('gameNightTestLab:settings') || '{}') }
  const saveSettings = () => localStorage.setItem('gameNightTestLab:settings', JSON.stringify(settings))
  let projects = [], project = null, simulator = null, stagePoll = null, joined = []
  const env = { url, key, anyClient: hostClient }

  const log = (text, level = 'info') => {
    const item = document.createElement('li'); item.className = level
    item.innerHTML = `<time>${new Date().toLocaleTimeString()}</time>${esc(text)}`
    $('#activity')?.prepend(item)
    while ($('#activity')?.children.length > 300) $('#activity').lastChild.remove()
  }
  const message = (text, kind = '') => { const el = $('#labMessage'); el.textContent = text; el.className = `lab-message ${kind}` }

  const { data: { session } } = await hostClient.auth.getSession()
  if (!session || session.user.is_anonymous) {
    $('#connection').textContent = `Local Supabase: ${url}`; $('#connection').className = 'lab-connection ok'
    $('#labBody').innerHTML = '<p class="lab-refusal">Sign in to <a href="/" target="_blank">Host Studio</a> in this browser first, then reload Test Lab. Test Lab uses your Host session to read your projects.</p>'
    return
  }
  try { projects = await host.listProjects(hostClient) } catch (error) {
    $('#connection').textContent = 'Local Supabase unreachable'; $('#connection').className = 'lab-connection bad'
    $('#labBody').innerHTML = `<p class="lab-refusal">Could not reach local Supabase (${esc(error.message)}). Run <code>npm run db:start</code>.</p>`; return
  }
  $('#connection').textContent = `● Connected to local Supabase · ${url}`; $('#connection').className = 'lab-connection ok'

  $('#labBody').innerHTML = `<div class="lab-grid">
    <section class="lab-panel"><h2>Project</h2>
      <div class="lab-row"><select id="project" aria-label="Project"><option value="">Choose a project…</option>${projects.map(p => `<option value="${esc(p.id)}">${esc(p.name)} · ${esc(p.room_code)}</option>`).join('')}</select><button id="reloadProjects">Reload</button></div>
      <dl class="lab-stat"><dt>Room</dt><dd id="room">—</dd><dt>Teams</dt><dd id="teamCount">—</dd><dt>Simulated</dt><dd id="simulatedCount">—</dd><dt>Saved Captains</dt><dd id="poolCount">—</dd></dl>
    </section>
    <section class="lab-panel"><h2>Simulated teams</h2>
      <div class="lab-row">${[5, 10, 15, 20].map(n => `<button class="preset" data-target="${n}">${n} teams</button>`).join('')}<label>Custom <input id="target" type="number" min="1" max="32" value="${settings.target}"></label></div>
      <div class="lab-row"><button class="primary" id="generate" disabled>Generate Teams</button></div>
      <p class="lab-note">Generating tops the project up to this many simulated teams; existing ones are reused, never duplicated. Teams must join before a game goes live.</p>
    </section>
    <section class="lab-panel"><h2>Simulation</h2>
      <div class="lab-row"><label>Mode <select id="mode"><option value="manual">Manual (join only)</option><option value="automatic">Automatic</option><option value="mixed">Mixed (30% inactive)</option></select></label>
      <label>Speed <select id="speed"><option value="fast">Fast</option><option value="normal">Normal</option><option value="slow">Slow</option></select></label></div>
      <div class="lab-row"><label><input type="checkbox" id="forceTie"> Force ties in No Context votes</label></div>
      <div class="lab-row"><button class="primary" id="startSim" disabled>Start Simulation</button><button id="stopSim" disabled>Stop Simulation</button><span id="pending" class="lab-note"></span></div>
    </section>
    <section class="lab-panel"><h2>Current game</h2>
      <dl class="lab-stat"><dt>Game</dt><dd id="game">—</dd><dt>Phase</dt><dd id="phase">—</dd><dt>Participation</dt><dd id="progress">—</dd></dl>
    </section>
    <section class="lab-panel lab-wide"><h2>Activity</h2><ol class="lab-log" id="activity" aria-live="polite"></ol></section>
    <section class="lab-panel lab-wide"><h2>Cleanup</h2>
      <div class="lab-row"><button class="danger" id="removeTeams" disabled>Remove simulated teams</button><span class="lab-note">Only before any game has been on stage. Manually joined teams are never touched.</span></div>
      <div class="lab-row"><input id="confirmName" placeholder="Type the project name to delete it" size="32"><button class="danger" id="deleteProject" disabled>Delete test project</button></div>
      <p class="lab-note">To reset the whole local database, stop Test Lab and run <code>npx supabase db reset</code> yourself. Test Lab never does this.</p>
      <p id="labMessage" class="lab-message" role="status"></p>
    </section></div>`

  $('#mode').value = settings.mode; $('#speed').value = settings.speed; $('#forceTie').checked = settings.forceTie
  const markPreset = () => document.querySelectorAll('.preset').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.target) === settings.target)))
  markPreset()
  document.querySelectorAll('.preset').forEach(b => b.onclick = () => { settings.target = Number(b.dataset.target); $('#target').value = settings.target; markPreset(); saveSettings() })
  $('#target').oninput = () => { settings.target = Math.max(1, Math.min(32, Number($('#target').value) || 1)); markPreset(); saveSettings() }
  for (const id of ['mode', 'speed']) $(`#${id}`).onchange = () => { settings[id] = $(`#${id}`).value; saveSettings() }
  $('#forceTie').onchange = () => { settings.forceTie = $('#forceTie').checked; saveSettings() }
  $('#reloadProjects').onclick = () => location.reload()

  const busy = value => ['generate', 'startSim', 'removeTeams', 'deleteProject'].forEach(id => {
    if (!$(`#${id}`)) return
    $(`#${id}`).disabled = value || !project || (id === 'startSim' && Boolean(simulator?.running)) || (id === 'deleteProject' && $('#confirmName').value !== project.name)
  })
  const showStage = stage => { $('#game').textContent = stage.game || '—'; $('#phase').textContent = stage.phase; $('#progress').textContent = stage.progress; $('#pending').textContent = simulator?.running ? `${simulator.pendingCount} pending` : '' }

  async function refreshProject() {
    if (!project) return
    const snapshot = await host.hydrateHostEvent(hostClient, project.id)
    project.room = snapshot.event.room_code
    joined = await captains.joinedCaptains(project.room, env)
    $('#room').textContent = project.room
    $('#teamCount').textContent = String(snapshot.teams.filter(t => t.status === 'active').length)
    $('#simulatedCount').textContent = `${joined.length} simulated Captain${joined.length === 1 ? '' : 's'} in this project`
    $('#poolCount').textContent = `${captains.savedSessionCount()} saved simulated Captain session${captains.savedSessionCount() === 1 ? '' : 's'} (reused across projects)`
    showStage(sim.describeStage(snapshot))
    return snapshot
  }

  $('#project').onchange = async () => {
    stopSimulation()
    project = projects.find(p => p.id === $('#project').value) || null
    $('#confirmName').value = ''
    clearInterval(stagePoll)
    if (project) { log(`Selected ${project.name}.`); await refreshProject(); stagePoll = setInterval(() => { if (!simulator?.running) refreshProject().catch(() => {}) }, 4000) }
    busy(false)
  }

  $('#generate').onclick = async () => {
    busy(true); message('')
    try {
      await refreshProject()
      const result = await captains.generateTeams({ roomCode: project.room, target: settings.target, env, log })
      message(`${result.captains.length} simulated teams in this project (${result.joined} joined now; ${result.created} new Captain sessions, ${result.reused} reused).`, 'ok')
    } catch (error) { message(`Could not generate teams: ${error.message}`, 'bad'); log(`Team generation stopped: ${error.message}`, 'warn') }
    finally { await refreshProject().catch(() => {}); busy(false) }
  }

  function stopSimulation() { simulator?.stop(); simulator = null; if ($('#stopSim')) { $('#stopSim').disabled = true; busy(false) } }
  $('#stopSim').onclick = stopSimulation
  $('#startSim').onclick = async () => {
    busy(true)
    await refreshProject()
    if (!joined.length) { message('Generate teams first.', 'bad'); return busy(false) }
    simulator = sim.createSimulator({
      captains: joined,
      hydrateCaptain: captain => hydrateTeam(captain.client, project.room),
      hydrateHost: () => host.hydrateHostEvent(hostClient, project.id),
      subscribe: async onChange => {
        const channel = hostClient.channel(`event:${project.id}:public`, { config: { private: true } }).on('broadcast', { event: 'state_changed' }, onChange)
        channel.subscribe()
        return () => hostClient.removeChannel(channel)
      },
      getSettings: () => settings, log, onStage: showStage,
    })
    await simulator.start()
    $('#stopSim').disabled = false; busy(false)
  }

  $('#removeTeams').onclick = async () => {
    if (!confirm(`Remove every simulated team from “${project.name}”? Manually joined teams are kept. This is only allowed before any game has been on stage.`)) return
    busy(true)
    try {
      stopSimulation()
      const { token } = await (await fetch('/__test-lab/token')).json()
      const { data: { session: current } } = await hostClient.auth.getSession()
      const response = await fetch('/__test-lab/remove-simulated-teams', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Test-Lab-Token': token, Authorization: `Bearer ${current.access_token}` }, body: JSON.stringify({ projectId: project.id }) })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error)
      message(`Removed ${body.removed.length} simulated team${body.removed.length === 1 ? '' : 's'}.`, 'ok'); log(`Removed simulated teams: ${body.removed.join(', ') || 'none'}.`)
    } catch (error) { message(error.message, 'bad') }
    finally { await refreshProject().catch(() => {}); busy(false) }
  }

  $('#confirmName').oninput = () => { $('#deleteProject').disabled = !project || $('#confirmName').value !== project.name }
  $('#deleteProject').onclick = async () => {
    if (!project || $('#confirmName').value !== project.name) return
    busy(true)
    try { stopSimulation(); await host.deleteOwnedEvent(hostClient, project.id); log(`Deleted test project ${project.name}.`); location.reload() }
    catch (error) { message(`Could not delete the project: ${error.message}`, 'bad'); busy(false) }
  }
  $('#deleteProject').disabled = true
}
