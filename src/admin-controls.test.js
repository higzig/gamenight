import { describe, expect, it, vi } from 'vitest'
import { moveItem, runConfirmed } from './admin-controls.js'

describe('Phase 2C Admin controls', () => {
  it('moves lineup items up and down', () => { const x=['A','B','C'];expect(moveItem(x,1,-1)).toBe(true);expect(x).toEqual(['B','A','C']) })
  it('refuses moves beyond first and last item', () => { expect(moveItem(['A'],0,-1)).toBe(false);expect(moveItem(['A'],0,1)).toBe(false) })
  it('does not run restart when confirmation is cancelled', () => { const action=vi.fn();expect(runConfirmed(()=>false,'Restart?',action)).toBe(false);expect(action).not.toHaveBeenCalled() })
})
