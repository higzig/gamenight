import { describe, expect, it, vi } from 'vitest'
import { createJoinableEvent, deleteOwnedEvent, isAnonymousUser, saveGuessAgeRound, uploadCelebrityImage } from './host-service.js'

describe('Host service', () => {
  it('recognizes anonymous Auth users', () => {
    expect(isAnonymousUser({ is_anonymous: true })).toBe(true)
    expect(isAnonymousUser({ is_anonymous: false })).toBe(false)
  })

  it('creates an event before opening its lobby', async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: { id: 'event-id' }, error: null })
      .mockResolvedValueOnce({ data: { id: 'event-id', status: 'lobby' }, error: null })
    const id = await createJoinableEvent({ rpc }, { name: 'Night', venue: 'Pub', eventDate: '2026-08-20', expectedTeams: 12 })
    expect(id).toBe('event-id')
    expect(rpc.mock.calls.map(call => call[0])).toEqual(['create_event', 'open_event_lobby'])
  })
  it('saves lineup references and reusable media instead of base64 data', async () => {
    const rpc=vi.fn().mockResolvedValue({data:'round-id',error:null})
    await saveGuessAgeRound({rpc},'event-id','Guess the Age',[{id:'celebrity-id',name:'Pedro Pascal',dob:'1975-04-02',imageKind:'storage',imagePath:'celebrities/celebrity-id/photo.jpg',imageSourceKind:'upload'}])
    expect(rpc.mock.calls[0][1].p_questions[0]).toMatchObject({celebrity_id:'celebrity-id',date_of_birth:'1975-04-02',image_path:'celebrities/celebrity-id/photo.jpg',external_image_url:null})
  })
  it('sends the exact selected YYYY-MM-DD with a Wikipedia image',async()=>{const rpc=vi.fn().mockResolvedValue({data:'round-id',error:null});await saveGuessAgeRound({rpc},'event-id','Guess the Age',[{name:'Zendaya',dob:'1996-09-01',imageKind:'external',image:'https://upload.wikimedia.org/zendaya.jpg',imageSourceKind:'wikipedia'}]);expect(rpc.mock.calls[0][1].p_questions[0]).toMatchObject({date_of_birth:'1996-09-01',external_image_url:'https://upload.wikimedia.org/zendaya.jpg',image_source:'wikipedia'})})
  it('uploads compressed media under the celebrity-owned path', async () => {
    const upload=vi.fn().mockResolvedValue({error:null}),from=vi.fn(()=>({upload}))
    const path=await uploadCelebrityImage({storage:{from}},'celebrity-id',new Blob(['image'],{type:'image/jpeg'}))
    expect(from).toHaveBeenCalledWith('celebrity-images');expect(path).toMatch(/^celebrities\/celebrity-id\/.+\.jpg$/)
  })
  it('deletes an event only through the owner RPC',async()=>{const rpc=vi.fn().mockResolvedValue({data:null,error:null});await deleteOwnedEvent({rpc},'event-id');expect(rpc).toHaveBeenCalledWith('delete_event',{p_event_id:'event-id'})})
})
