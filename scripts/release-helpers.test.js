import { describe, expect, it } from 'vitest'
import { assertExpectedBranch, hasCommitChanges, isExplicitConfirmation, normalizeCommitMessage } from './release-helpers.mjs'

describe('release safety helpers', () => {
  it('accepts only the expected main branch', () => {
    expect(assertExpectedBranch('main\n')).toBe('main')
    expect(() => assertExpectedBranch('feature/release')).toThrow(/current branch/)
  })

  it('detects whether there is anything to commit', () => {
    expect(hasCommitChanges(' M README.md\n?? scripts/release.mjs')).toBe(true)
    expect(hasCommitChanges('  \n')).toBe(false)
  })

  it('requires an explicit yes before remote changes', () => {
    expect(isExplicitConfirmation('yes')).toBe(true)
    expect(isExplicitConfirmation('Y')).toBe(true)
    expect(isExplicitConfirmation('')).toBe(false)
    expect(isExplicitConfirmation('sure')).toBe(false)
  })

  it('requires a safe non-empty single-line commit message', () => {
    expect(normalizeCommitMessage('  Release Phase 3B  ')).toBe('Release Phase 3B')
    expect(() => normalizeCommitMessage('')).toThrow(/non-empty/)
    expect(() => normalizeCommitMessage('line one\nline two')).toThrow(/single-line/)
  })
})
