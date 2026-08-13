import { describe, expect, it } from 'vitest'
import { applyCelebrityRecord, createNewCelebrityDraft, dobInputValue, hasCelebrityImage, lineupValidationError, selectCelebrityMatch, shouldTryWikipedia, updateCelebrityDob, wikidataDobFromClaims } from './celebrity-library.js'

const imageRecord={id:'c1',display_name:'Pedro Pascal',normalized_name:'pedropascal',date_of_birth:'1975-04-02',image_kind:'external',image_path:null,external_image_url:'https://img.example/pedro.jpg',image_source:'wikipedia',source_reference:'Pedro Pascal',wikipedia_checked_at:'2026-08-13'}
describe('reusable celebrity editor model',()=>{
  it('selects an existing celebrity and populates DOB/image',()=>{const match=selectCelebrityMatch([imageRecord],'PEDRO-PASCAL','');const target=applyCelebrityRecord({},match,'https://storage.example');expect(target.dob).toBe('1975-04-02');expect(target.image).toContain('pedro.jpg')})
  it('skips Wikipedia for an existing image',()=>expect(shouldTryWikipedia(imageRecord)).toBe(false))
  it('tries Wikipedia once when an image is missing',()=>{const missing={...imageRecord,image_kind:'none',external_image_url:null,wikipedia_checked_at:null};expect(shouldTryWikipedia(missing)).toBe(true);expect(shouldTryWikipedia(missing,true)).toBe(false)})
  it('keeps manual controls viable after failed lookup',()=>expect(hasCelebrityImage({...imageRecord,image_kind:'none',external_image_url:null,wikipedia_checked_at:'2026-08-13'})).toBe(false))
  it('reuses uploaded storage paths in another event model',()=>{const target=applyCelebrityRecord({}, {...imageRecord,image_kind:'storage',image_path:'celebrities/c1/photo.jpg',external_image_url:null,image_source:'upload'},'https://storage.example');expect(target.image).toBe('https://storage.example/celebrities/c1/photo.jpg');expect(target.imagePath).toContain('photo.jpg')})
  it('does not clear reusable media during a round restart model refresh',()=>{const target=applyCelebrityRecord({},imageRecord,'https://storage.example');expect(target.image).toBe(imageRecord.external_image_url)})
  it('does not repeat Wikipedia lookup for a copied session with reusable media',()=>expect(shouldTryWikipedia({...imageRecord})).toBe(false))
  it('updates and renders a newly selected DOB as an exact calendar string',()=>{const draft=createNewCelebrityDraft();updateCelebrityDob(draft,'1987-06-24');expect(draft.dob).toBe('1987-06-24');expect(dobInputValue(draft)).toBe('1987-06-24')})
  it('does not insert a fake default DOB for new celebrities',()=>expect(createNewCelebrityDraft().dob).toBe(''))
  it('does not match a stale same-name library row when the Host selected another DOB',()=>expect(selectCelebrityMatch([imageRecord],'Pedro Pascal','1980-01-01')).toBe(null))
  it('preserves a newer Host DOB while asynchronous enrichment merges image metadata',()=>{const draft={dob:'1980-01-01'};applyCelebrityRecord(draft,imageRecord,'https://storage.example',{preserveDob:true});expect(draft.dob).toBe('1980-01-01');expect(draft.image).toContain('pedro.jpg')})
  it('still populates the known DOB when selecting an existing celebrity without one',()=>{const draft={dob:''};applyCelebrityRecord(draft,imageRecord,'https://storage.example');expect(draft.dob).toBe('1975-04-02')})
  it('returns an actionable validation message for a missing DOB',()=>expect(lineupValidationError([{name:'Pedro Pascal',dob:''}])).toBe('Pedro Pascal needs a valid date of birth before syncing.'))
  it('accepts a valid name, DOB, and Wikipedia image lineup',()=>expect(lineupValidationError([{name:'Pedro Pascal',dob:'1975-04-02',image:imageRecord.external_image_url}])).toBe(null))
  it('extracts a full-precision Wikidata DOB without Date conversion',()=>expect(wikidataDobFromClaims({claims:{P569:[{rank:'normal',mainsnak:{datavalue:{value:{time:'+1975-04-02T00:00:00Z',precision:11}}}}]}})).toBe('1975-04-02'))
  it('rejects incomplete or deprecated Wikidata birth dates',()=>{expect(wikidataDobFromClaims({claims:{P569:[{rank:'normal',mainsnak:{datavalue:{value:{time:'+1975-04-00T00:00:00Z',precision:10}}}}]}})).toBe(null);expect(wikidataDobFromClaims({claims:{P569:[{rank:'deprecated',mainsnak:{datavalue:{value:{time:'+1975-04-02T00:00:00Z',precision:11}}}}]}})).toBe(null)})
})
