import { describe, it, expect, vi } from 'vitest'
import { createApi } from './api'
describe('API transport',()=>{
  it('sends explicit credentials and custom request header without browser credentials',async()=>{
    const fetcher=vi.fn().mockResolvedValue({ok:true,text:async()=>JSON.stringify({id:'alice'})})
    const api=createApi(fetcher); api.login('alice','secret'); await api.request('/me')
    expect(fetcher).toHaveBeenCalledWith('/api/me',expect.objectContaining({credentials:'omit',cache:'no-store',headers:expect.objectContaining({Authorization:`Basic ${btoa('alice:secret')}`,'X-Arcflow-Client':'approval-demo'})}))
    api.logout(); await api.request('/me')
    expect(fetcher.mock.calls[1][1].headers.Authorization).toBe('')
  })
  it('normalizes server errors',async()=>{
    const api=createApi(vi.fn().mockResolvedValue({ok:false,status:409,text:async()=>JSON.stringify({message:'Already decided'})}))
    await expect(api.request('/requests/r1/decisions')).rejects.toMatchObject({ message: 'Already decided', status: 409 })
  })
  it('forwards an opaque submission key alongside authenticated write headers',async()=>{
    const fetcher=vi.fn().mockResolvedValue({ok:true,text:async()=>JSON.stringify({id:'r1'})})
    const api=createApi(fetcher); api.login('alice','secret')
    await api.request('/requests',{method:'POST',headers:{'Idempotency-Key':'submission:123'},body:'{}'})
    expect(fetcher.mock.calls[0][1]).toMatchObject({method:'POST',headers:{'Idempotency-Key':'submission:123','X-Arcflow-Client':'approval-demo',Authorization:`Basic ${btoa('alice:secret')}`}})
  })
  it('handles a non-JSON error response',async()=>{
    const api=createApi(vi.fn().mockResolvedValue({ok:false,status:503,text:async()=>'<html>Error</html>'}))
    await expect(api.request('/requests')).rejects.toThrow('Request failed (503)')
  })
})


describe('raw approval money decoding', () => {
  it.each(['/requests', '/documents', '/requests/r1/decisions', '/requests/inbox?box=PENDING&limit=25'])('rejects a malformed decimal token before native rounding on %s', async path => {
    const api = createApi(vi.fn().mockResolvedValue({ ok: true, text: async () => '{"business":{"type":"procurement","currency":"CNY","unitPrice":1.00000000000000001}}' }))
    await expect(api.request(path)).rejects.toThrow('Invalid approval response')
  })
  it('accepts canonical exact scientific prices and rejects duplicate JSON keys', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce({ ok: true, text: async () => '[{"business":{"currency":"CNY","unitPrice":1E+9,"quantity":100000}}]' })
      .mockResolvedValueOnce({ ok: true, text: async () => '{"days":1,"days":0}' })
    const api = createApi(fetcher)
    expect(await api.request('/requests')).toEqual([{ business: { currency: 'CNY', unitPrice: 1000000000, quantity: 100000 } }])
    await expect(api.request('/requests')).rejects.toThrow('Invalid approval response')
  })
})

describe('API session cancellation', () => {
  const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
  it('aborts active requests on logout and rejects late response bodies', async () => {
    const body = deferred(), fetcher = vi.fn().mockResolvedValue({ ok: true, text: () => body.promise })
    const api = createApi(fetcher); api.login('bob', 'secret'); const pending = api.request('/requests/inbox')
    await Promise.resolve(); api.logout(); expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true)
    body.resolve(JSON.stringify({ items: [], nextCursor: null })); await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })
  it('forwards caller cancellation and rejects ignored aborts across login changes', async () => {
    const response = deferred(), fetcher = vi.fn(() => response.promise), api = createApi(fetcher), controller = new AbortController()
    api.login('bob', 'secret'); const pending = api.request('/requests/inbox', { signal: controller.signal })
    controller.abort(); expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true)
    api.login('carol', 'new-secret'); response.resolve({ ok: true, text: async () => '[]' })
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })
})
