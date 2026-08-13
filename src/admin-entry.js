import { createGameNightClient, getSupabaseConfigError } from './supabase-client.js'
import { advanceRemoteQuestion, copyEventSession, createJoinableEvent, deleteOwnedEvent, hydrateHostEvent, isAnonymousUser, listOwnedEvents, lockRemoteQuestion, markWikipediaChecked, reorderGuessAgeQuestion, restartGuessAgeRound, revealRemoteQuestion, saveCelebrityRecord, saveGuessAgeRound, searchCelebrityLibrary, setRemoteDisplay, startRemoteQuestion, uploadCelebrityImage } from './host-service.js'
import { createAdminApplication } from './admin-application.js'

const supabase = createGameNightClient('game-night-host-auth')

const application = createAdminApplication({
  client: supabase,
  configError: getSupabaseConfigError(),
  services: { advanceRemoteQuestion, copyEventSession, createJoinableEvent, deleteOwnedEvent, hydrateHostEvent, isAnonymousUser, listOwnedEvents, lockRemoteQuestion, markWikipediaChecked, reorderGuessAgeQuestion, restartGuessAgeRound, revealRemoteQuestion, saveCelebrityRecord, saveGuessAgeRound, searchCelebrityLibrary, setRemoteDisplay, startRemoteQuestion, uploadCelebrityImage },
  loadLegacyAdmin: () => import('../admin.js'),
})

window.addEventListener('game-night-host-logout', application.logout)
window.addEventListener('game-night-switch-events', application.backToEvents)
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) application.refreshActiveEvent().catch(console.error)
})

application.init()
