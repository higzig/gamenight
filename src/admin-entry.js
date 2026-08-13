import { createGameNightClient, getSupabaseConfigError } from './supabase-client.js'
import { advanceRemoteQuestion, copyEventSession, createJoinableEvent, hydrateHostEvent, isAnonymousUser, listOwnedEvents, lockRemoteQuestion, reorderGuessAgeQuestion, restartGuessAgeRound, revealRemoteQuestion, saveGuessAgeRound, setRemoteDisplay, startRemoteQuestion } from './host-service.js'
import { createAdminApplication } from './admin-application.js'

const supabase = createGameNightClient('game-night-host-auth')

const application = createAdminApplication({
  client: supabase,
  configError: getSupabaseConfigError(),
  services: { advanceRemoteQuestion, copyEventSession, createJoinableEvent, hydrateHostEvent, isAnonymousUser, listOwnedEvents, lockRemoteQuestion, reorderGuessAgeQuestion, restartGuessAgeRound, revealRemoteQuestion, saveGuessAgeRound, setRemoteDisplay, startRemoteQuestion },
  loadLegacyAdmin: () => import('../admin.js'),
})

window.addEventListener('game-night-host-logout', application.logout)
window.addEventListener('game-night-switch-events', application.backToEvents)
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) application.refreshActiveEvent().catch(console.error)
})

application.init()
