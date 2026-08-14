import { createGameNightClient, getSupabaseConfigError } from './supabase-client.js'
import { activateHostedRound, advanceRemoteQuestion, changeIBetYouCategory, challengeIBetYou, copyEventSession, correctIBetYouShowdown, createJoinableEvent, deleteOwnedEvent, hydrateHostEvent, isAnonymousUser, judgeIBetYouGroup, listOwnedEvents, lockRemoteQuestion, markWikipediaChecked, nextIBetYouGroup, reorderGuessAgeQuestion, resetIBetYouGroup, restartGuessAgeRound, revealRemoteQuestion, saveCelebrityRecord, saveGuessAgeRound, searchCelebrityLibrary, setIBetYouBid, setRemoteDisplay, setupIBetYouRound, startIBetYouTimer, startRemoteQuestion, swapIBetYouTeams, uploadCelebrityImage } from './host-service.js'
import { createAdminApplication } from './admin-application.js'

const supabase = createGameNightClient('game-night-host-auth')

const application = createAdminApplication({
  client: supabase,
  configError: getSupabaseConfigError(),
  services: { activateHostedRound, advanceRemoteQuestion, changeIBetYouCategory, challengeIBetYou, copyEventSession, correctIBetYouShowdown, createJoinableEvent, deleteOwnedEvent, hydrateHostEvent, isAnonymousUser, judgeIBetYouGroup, listOwnedEvents, lockRemoteQuestion, markWikipediaChecked, nextIBetYouGroup, reorderGuessAgeQuestion, resetIBetYouGroup, restartGuessAgeRound, revealRemoteQuestion, saveCelebrityRecord, saveGuessAgeRound, searchCelebrityLibrary, setIBetYouBid, setRemoteDisplay, setupIBetYouRound, startIBetYouTimer, startRemoteQuestion, swapIBetYouTeams, uploadCelebrityImage },
  loadLegacyAdmin: () => import('../admin.js'),
})

window.addEventListener('game-night-host-logout', application.logout)
window.addEventListener('game-night-switch-events', application.backToEvents)
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) application.refreshActiveEvent().catch(console.error)
})

application.init()
