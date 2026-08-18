export function assertExpectedBranch(actualBranch, expectedBranch = 'main') {
  const actual = String(actualBranch || '').trim()
  if (actual !== expectedBranch) throw new Error(`Release must run from branch "${expectedBranch}"; current branch is "${actual || 'unknown'}".`)
  return actual
}

export function hasCommitChanges(porcelainStatus) {
  return String(porcelainStatus || '').trim().length > 0
}

export function isExplicitConfirmation(answer) {
  return ['y', 'yes'].includes(String(answer || '').trim().toLowerCase())
}

export function normalizeCommitMessage(message) {
  const normalized = String(message || '').trim()
  if (!normalized) throw new Error('A non-empty Git commit message is required.')
  if (/\r|\n/.test(normalized)) throw new Error('Use a single-line Git commit message.')
  return normalized
}
