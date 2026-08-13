import { describe, expect, it } from 'vitest'
import { applyCelebrityRecord, hasCelebrityImage, selectCelebrityMatch, shouldTryWikipedia } from './celebrity-library.js'

const imageRecord={id:'c1',display_name:'Pedro Pascal',normalized_name:'pedropascal',date_of_birth:'1975-04-02',image_kind:'external',image_path:null,external_image_url:'https://img.example/pedro.jpg',image_source:'wikipedia',source_reference:'Pedro Pascal',wikipedia_checked_at:'2026-08-13'}
describe('reusable celebrity editor model',()=>{
  it('selects an existing celebrity and populates DOB/image',()=>{const match=selectCelebrityMatch([imageRecord],'PEDRO-PASCAL','');const target=applyCelebrityRecord({},match,'https://storage.example');expect(target.dob).toBe('1975-04-02');expect(target.image).toContain('pedro.jpg')})
  it('skips Wikipedia for an existing image',()=>expect(shouldTryWikipedia(imageRecord)).toBe(false))
  it('tries Wikipedia once when an image is missing',()=>{const missing={...imageRecord,image_kind:'none',external_image_url:null,wikipedia_checked_at:null};expect(shouldTryWikipedia(missing)).toBe(true);expect(shouldTryWikipedia(missing,true)).toBe(false)})
  it('keeps manual controls viable after failed lookup',()=>expect(hasCelebrityImage({...imageRecord,image_kind:'none',external_image_url:null,wikipedia_checked_at:'2026-08-13'})).toBe(false))
  it('reuses uploaded storage paths in another event model',()=>{const target=applyCelebrityRecord({}, {...imageRecord,image_kind:'storage',image_path:'celebrities/c1/photo.jpg',external_image_url:null,image_source:'upload'},'https://storage.example');expect(target.image).toBe('https://storage.example/celebrities/c1/photo.jpg');expect(target.imagePath).toContain('photo.jpg')})
  it('does not clear reusable media during a round restart model refresh',()=>{const target=applyCelebrityRecord({},imageRecord,'https://storage.example');expect(target.image).toBe(imageRecord.external_image_url)})
  it('does not repeat Wikipedia lookup for a copied session with reusable media',()=>expect(shouldTryWikipedia({...imageRecord})).toBe(false))
})
