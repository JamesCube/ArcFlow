import { describe, it, expect, vi } from 'vitest'
import { createApi } from './api'
describe('API transport',()=>{
  it('sends explicit credentials and custom request header without browser credentials',async()=>{
    const fetcher=vi.fn().mockResolvedValue({ok:true,json:async()=>({id:'alice'})})
    const api=createApi(fetcher); api.login('alice','secret'); await api.request('/me')
    expect(fetcher).toHaveBeenCalledWith('/api/me',expect.objectContaining({credentials:'omit',cache:'no-store',headers:expect.objectContaining({Authorization:`Basic ${btoa('alice:secret')}`,'X-Arcflow-Client':'approval-demo'})}))
    api.logout(); await api.request('/me')
    expect(fetcher.mock.calls[1][1].headers.Authorization).toBe('')
  })
  it('normalizes server errors',async()=>{
    const api=createApi(vi.fn().mockResolvedValue({ok:false,status:409,json:async()=>({message:'Already decided'})}))
    await expect(api.request('/requests/r1/decisions')).rejects.toMatchObject({ message: 'Already decided', status: 409 })
  })
  it('forwards an opaque submission key alongside authenticated write headers',async()=>{
    const fetcher=vi.fn().mockResolvedValue({ok:true,json:async()=>({id:'r1'})})
    const api=createApi(fetcher); api.login('alice','secret')
    await api.request('/requests',{method:'POST',headers:{'Idempotency-Key':'submission:123'},body:'{}'})
    expect(fetcher.mock.calls[0][1]).toMatchObject({method:'POST',headers:{'Idempotency-Key':'submission:123','X-Arcflow-Client':'approval-demo',Authorization:`Basic ${btoa('alice:secret')}`}})
  })
  it('handles a non-JSON error response',async()=>{
    const api=createApi(vi.fn().mockResolvedValue({ok:false,status:503,json:async()=>{throw new Error('HTML')}}))
    await expect(api.request('/requests')).rejects.toThrow('Request failed (503)')
  })
})
