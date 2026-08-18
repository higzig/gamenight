import {describe,expect,it} from 'vitest'
import {MASCOTS,mascotChoices,mascotEmoji,mascotGridHtml} from './mascots.js'
describe('Team mascot catalogue',()=>{
  it('provides a broad local curated catalogue',()=>{expect(MASCOTS.length).toBeGreaterThanOrEqual(24);expect(new Set(MASCOTS.map(x=>x.id)).size).toBe(MASCOTS.length)})
  it('marks taken mascots unavailable while preserving the Team current choice',()=>{const choices=mascotChoices(['frog','robot'],'frog');expect(choices.find(x=>x.id==='frog')).toMatchObject({selected:true,taken:false});expect(choices.find(x=>x.id==='robot').taken).toBe(true)})
  it('renders a tappable mascot grid with taken choices disabled',()=>{const html=mascotGridHtml(['frog'],'robot');expect(html).toContain('data-mascot="robot"');expect(html).toContain('data-mascot="frog" disabled');expect(html).toContain('selected')})
  it('uses a neutral fallback for legacy Teams',()=>expect(mascotEmoji(null)).toBe('❔'))
})
