import { describe, expect, it, vi } from 'vitest'
import { moveItem, runConfirmed } from './admin-controls.js'

describe('Phase 2C Admin controls', () => {
  it('moves lineup items up and down', () => { const x=['A','B','C'];expect(moveItem(x,1,-1)).toBe(true);expect(x).toEqual(['B','A','C']) })
  it('preserves each celebrity DOB while reordering',()=>{const x=[{name:'A',dob:'1980-01-01'},{name:'B',dob:'1990-02-03'}];moveItem(x,1,-1);expect(x.map(item=>item.dob)).toEqual(['1990-02-03','1980-01-01'])})
  it('refuses moves beyond first and last item', () => { expect(moveItem(['A'],0,-1)).toBe(false);expect(moveItem(['A'],0,1)).toBe(false) })
  it('does not run restart when confirmation is cancelled', () => { const action=vi.fn();expect(runConfirmed(()=>false,'Restart?',action)).toBe(false);expect(action).not.toHaveBeenCalled() })
})
