import { mount, flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App.vue'
import { api } from './api'
vi.mock('./api', () => ({ api: { login: vi.fn(), logout: vi.fn(), request: vi.fn() } }))
const people = [{id:'alice',displayName:'Alice'}, {id:'bob',displayName:'Bob'}, {id:'carol',displayName:'Carol'}]
const blueprint = {schemaVersion:1,id:'leave-approval',version:1,name:'Leave approval',nodes:[]}
const item = {id:'r1',title:'Annual leave',reason:'Family trip',days:2,applicantId:'alice',approverId:'bob',status:'PENDING',createdAt:'2026-10-02T12:00:00Z',processId:'leave-approval',processVersion:1,history:[{actorId:'alice',action:'SUBMIT',comment:'',at:'2026-10-02T12:00:00Z'}]}
function setup(identity='alice', items=[]) {
  api.request.mockImplementation(async path => ({'/me':people.find(p => p.id===identity),'/people':people,'/process':blueprint,'/requests':items})[path])
  return mount(App)
}
async function login(wrapper) {
  await wrapper.find('input[type=password]').setValue('demo-password')
  await wrapper.find('form').trigger('submit')
  await flushPromises()
}
beforeEach(() => vi.clearAllMocks())
describe('approval workflow', () => {
  it('logs in, submits a request, and shows its status and history', async () => {
    const wrapper = setup(); await login(wrapper)
    expect(api.login).toHaveBeenCalledWith('alice','demo-password')
    await wrapper.find('input[maxlength="120"]').setValue('Annual leave')
    await wrapper.find('textarea').setValue('Family trip')
    await wrapper.find('input[type=number]').setValue('2')
    api.request.mockResolvedValueOnce(item)
    await wrapper.find('.new-request').trigger('submit'); await flushPromises()
    expect(api.request).toHaveBeenLastCalledWith('/requests', {method:'POST',body:JSON.stringify({title:'Annual leave',reason:'Family trip',days:2,approverId:'bob'})})
    expect(wrapper.find('.detail').text()).toContain('Awaiting review')
    expect(wrapper.text()).toContain('Request submitted.')
  })
  it('shows login errors without entering the workspace', async () => {
    const wrapper = setup(); api.request.mockRejectedValue(new Error('Unauthorized'))
    await login(wrapper)
    expect(wrapper.find('[role=alert]').text()).toBe('Unauthorized')
    expect(wrapper.find('.workspace').exists()).toBe(false)
    expect(api.logout).toHaveBeenCalled()
    expect(wrapper.find('input[type=password]').element.value).toBe('')
  })
  it('suppresses repeated submissions while a request is in flight', async () => {
    const wrapper = setup(); await login(wrapper)
    let resolve
    api.request.mockImplementationOnce(() => new Promise(r => {resolve=r}))
    await wrapper.find('.new-request').trigger('submit'); await wrapper.find('.new-request').trigger('submit')
    expect(api.request.mock.calls.filter(([, opts]) => opts?.method==='POST')).toHaveLength(1)
    resolve(item); await flushPromises()
  })
  it('keeps form data after failed submission and provides recovery guidance', async () => {
    const wrapper=setup(); await login(wrapper)
    await wrapper.find('input[maxlength="120"]').setValue('Annual leave')
    api.request.mockRejectedValueOnce(new Error('Service unavailable'))
    await wrapper.find('.new-request').trigger('submit'); await flushPromises()
    expect(wrapper.find('[role=alert]').text()).toContain('Refresh requests before retrying')
    expect(wrapper.find('input[maxlength="120"]').element.value).toBe('Annual leave')
    expect(wrapper.find('.new-request button').attributes('disabled')).toBeUndefined()
  })
  it.each(['APPROVE','REJECT'])('records %s and removes decision controls', async decision => {
    const wrapper=setup('bob',[item]); await login(wrapper)
    await wrapper.find('.request-item').trigger('click')
    await wrapper.find('.decision-form textarea').setValue('Reviewed')
    api.request.mockResolvedValueOnce({...item,status:decision==='APPROVE'?'APPROVED':'REJECTED',comment:'Reviewed',history:[...item.history,{actorId:'bob',action:decision,comment:'Reviewed',at:'2026-10-02T13:00:00Z'}]})
    if(decision==='APPROVE') await wrapper.find('.decision-form').trigger('submit')
    else await wrapper.find('.danger').trigger('click')
    await flushPromises()
    expect(api.request).toHaveBeenLastCalledWith('/requests/r1/decisions',{method:'POST',body:JSON.stringify({decision,comment:'Reviewed'})})
    expect(wrapper.find('.decision-form').exists()).toBe(false)
    expect(wrapper.text()).toContain('Reviewed')
  })
  it('does not expose decision controls to an applicant', async () => {
    const wrapper=setup('alice',[item]); await login(wrapper)
    await wrapper.find('.request-item').trigger('click')
    expect(wrapper.find('.decision-form').exists()).toBe(false)
    expect(wrapper.text()).toContain('Only the designated approver')
  })
  it('offers only Carol when Bob submits a request', async () => {
    const wrapper=setup('bob'); await login(wrapper)
    const options=wrapper.find('.new-request select').findAll('option')
    expect(options.map(o=>o.element.value)).toEqual(['carol'])
  })
  it('suppresses repeated decisions and preserves the pending request after an error', async () => {
    const wrapper=setup('bob',[item]); await login(wrapper)
    await wrapper.find('.request-item').trigger('click')
    let reject
    api.request.mockImplementationOnce(()=>new Promise((_,r)=>{reject=r}))
    await wrapper.find('.decision-form').trigger('submit')
    await wrapper.find('.decision-form').trigger('submit')
    expect(api.request.mock.calls.filter(([,opts])=>opts?.method==='POST')).toHaveLength(1)
    reject(new Error('Request already has a different terminal decision')); await flushPromises()
    expect(wrapper.find('[role=alert]').text()).toContain('Refresh to check the latest status')
    expect(wrapper.find('.decision-form').exists()).toBe(true)
  })
  it('clears account state at logout and ignores stale pending responses', async () => {
    const wrapper=setup(); await login(wrapper)
    let resolve
    api.request.mockImplementationOnce(() => new Promise(r=>{resolve=r}))
    await wrapper.find('.new-request').trigger('submit')
    await wrapper.find('[aria-label="Sign out"]').trigger('click')
    resolve(item); await flushPromises()
    expect(wrapper.find('.workspace').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Annual leave')
    expect(api.logout).toHaveBeenCalled()
  })
})
