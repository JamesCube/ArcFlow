import { mount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { webcrypto } from 'node:crypto'
import GraphHub from './GraphHub.vue'
import GraphBusinessForm from './GraphBusinessForm.vue'
import { api } from '../api.js'
import { GRAPH_FAMILIES, familyFor, quoteFromSource, normalizeBusiness } from './business.js'
import { definition, business, directory, instance } from './fixtures.test-support.js'
vi.mock('../api.js',()=>({api:{request:vi.fn()}}))
const clone=value=>JSON.parse(JSON.stringify(value))
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}}
const source={businessId:'Q-DEMO-001',revision:1,customerRef:'CUSTOMER-A',ownerId:'publisher',readerIds:['publisher','reviewer-a','reviewer-b'],item:'Equipment',quantity:10,listUnitPrice:'1000.00',currency:'CNY',validUntil:'2099-12-31'}
const quote=()=>quoteFromSource(source,{title:'Discount review',reason:'Volume order',requestedUnitPrice:'800.01'})
const wrappers=[]
const button=(wrapper,id)=>wrapper.get(`[data-testid="${id}"]`)
function setup(mode='designer') {
  const state=Object.fromEntries(GRAPH_FAMILIES.map(family=>[family.key,{definition:{...definition(),id:family.id,schemaVersion:family.schemaVersion,name:family.en},items:[],revision:0}]))
  api.request.mockImplementation(async(path,options)=>{
    const family=GRAPH_FAMILIES.find(value=>path.startsWith(`${value.base}/`)),saved=state[family.key]
    if(path.endsWith('/capabilities'))return {schemaVersion:family.schemaVersion,businessType:family.type,facts:family.fields.map(field=>({field,type:field.includes('hasRejected')?'boolean':field.includes('Percent')?'percent':'money',currencies:field.includes('hasRejected')||field.includes('Percent')?[]:['CNY','USD','EUR','GBP','JPY'],operators:field.includes('hasRejected')?['EQ']:['EQ','GT','GTE','LT','LTE']})),permissions:{canPublish:true,canSubmit:true}}
    if(path.endsWith('/users'))return directory
    if(path.endsWith('/process'))return clone(saved.definition)
    if(path.endsWith('/workspace'))return {definition:clone(saved.definition),draft:{revision:saved.revision,definition:clone(saved.definition)}}
    if(path.endsWith('/quotes'))return [clone(source)]
    if(path.endsWith('/requests')&&!options?.method)return clone(saved.items)
    if(path.endsWith('/draft')){saved.definition=JSON.parse(options.body).definition;return {revision:++saved.revision,definition:clone(saved.definition)}}
    throw new Error(`Unhandled ${path}`)
  })
  const wrapper=mount(GraphHub,{props:{actor:directory[0],locale:'en',mode,active:true}});wrappers.push(wrapper)
  return {wrapper,state}
}
const root=(wrapper,key)=>wrapper.get(`[data-testid="graph-workspace"][data-scenario="${key}"]`)
async function choose(wrapper,key){await button(wrapper,'graph-scenario').setValue(key);await flushPromises();return root(wrapper,key)}
async function newQuote(wrapper){const quoteRoot=await choose(wrapper,'quoteDiscount');await button(quoteRoot,'graph-new-request').trigger('click');wrapper.findAllComponents(GraphBusinessForm).find(component=>component.props('modelValue').type==='quoteDiscount').vm.$emit('update:modelValue',quote());await flushPromises();return quoteRoot}
beforeEach(()=>{vi.resetAllMocks();vi.stubGlobal('crypto',webcrypto)})
afterEach(()=>{wrappers.splice(0).forEach(wrapper=>wrapper.unmount());vi.unstubAllGlobals()})

describe('independent graph scenario workspaces',()=>{
  it('rejects wrong-process schema-5 payment endpoint responses while preserving the visible workspace',async()=>{
    const {wrapper,state}=setup('requests');await flushPromises();const payment=root(wrapper,'payment')
    const wrong=instance();wrong.definition.id='travel-graph';state.payment.items=[wrong]
    await button(payment,'graph-refresh').trigger('click');await flushPromises()
    expect(payment.get('[role="alert"]').text()).toContain('Wrong graph process response')
    expect(payment.find('[data-testid="graph-request-request-1"]').exists()).toBe(false)
    expect(payment.attributes('data-definition-id')).toBe('payment-graph')
    state.payment.items=[];state.payment.definition.id='custom-payment'
    await button(payment,'graph-refresh').trigger('click');await flushPromises()
    expect(payment.get('[role="alert"]').text()).toContain('Wrong graph process response')
    expect(payment.attributes('data-definition-id')).toBe('payment-graph')
  })
  it('preserves unsaved per-family drafts, undo history and locale across repeated switching',async()=>{
    const {wrapper}=setup();await flushPromises()
    await button(root(wrapper,'payment'),'graph-process-name').setValue('Unfinished payment')
    const travel=await choose(wrapper,'travel');await button(travel,'graph-process-name').setValue('Unfinished travel')
    await choose(wrapper,'receiving');await wrapper.setProps({locale:'zh'})
    await choose(wrapper,'payment');expect(button(root(wrapper,'payment'),'graph-process-name').element.value).toBe('Unfinished payment')
    await button(root(wrapper,'payment'),'graph-undo').trigger('click');expect(button(root(wrapper,'payment'),'graph-process-name').element.value).toBe('Payment')
    await choose(wrapper,'travel');expect(button(travel,'graph-process-name').element.value).toBe('Unfinished travel')
    await button(travel,'graph-save').trigger('click');await flushPromises()
    expect(api.request.mock.calls.filter(([path,options])=>options?.method==='PUT').map(([path])=>path)).toEqual(['/graphs/travel/draft'])
  })
  it('keeps uncertain original submission body/key with its family while another scenario is edited',async()=>{
    const {wrapper}=setup('requests');await flushPromises();const payment=root(wrapper,'payment')
    await button(payment,'graph-new-request').trigger('click');wrapper.getComponent(GraphBusinessForm).vm.$emit('update:modelValue',business());await flushPromises()
    const original=api.request.getMockImplementation();api.request.mockImplementation((path,options)=>options?.method==='POST'?Promise.reject(new Error('Lost response')):original(path,options))
    await button(payment,'graph-submit').trigger('click');await flushPromises();await choose(wrapper,'travel');await button(root(wrapper,'travel'),'graph-new-request').trigger('click');await button(root(wrapper,'travel'),'graph-travel-title').setValue('Preserved trip')
    await choose(wrapper,'payment');expect(button(payment,'graph-payment-title').element.disabled).toBe(true);await button(payment,'graph-submit').trigger('click');await flushPromises()
    const attempts=api.request.mock.calls.filter(([,options])=>options?.method==='POST');expect(attempts).toHaveLength(2);expect(attempts[0]).toEqual(attempts[1]);expect(attempts[0][0]).toBe('/graphs/payment/requests')
    await choose(wrapper,'travel');expect(button(root(wrapper,'travel'),'graph-travel-title').element.value).toBe('Preserved trip')
  })
  it('applies an inactive late submit only to its original workspace and never steals current scenario focus',async()=>{
    const {wrapper}=setup('requests');await flushPromises();const payment=root(wrapper,'payment')
    await button(payment,'graph-new-request').trigger('click');wrapper.getComponent(GraphBusinessForm).vm.$emit('update:modelValue',business());await flushPromises()
    const wait=deferred(),original=api.request.getMockImplementation();let options
    api.request.mockImplementation((path,input)=>{if(input?.method==='POST'){options=input;return wait.promise}return original(path,input)})
    await button(payment,'graph-submit').trigger('click');await choose(wrapper,'travel')
    const result=instance();result.submissionKey=options.headers['Idempotency-Key'];wait.resolve(result);await flushPromises()
    expect(button(wrapper,'graph-scenario').element.value).toBe('travel');expect(root(wrapper,'travel').find('[data-testid="graph-runtime"]').exists()).toBe(false)
    await choose(wrapper,'payment');expect(payment.get('[data-testid="graph-runtime"]').attributes('data-request-id')).toBe(result.id)
  })
  it('retains uncertain decisions per family and retries the exact original task command',async()=>{
    const {wrapper,state}=setup('requests');state.payment.items=[instance()];await flushPromises();const payment=root(wrapper,'payment')
    // The publisher is deliberately also an assigned reviewer in this fixture.
    state.payment.items[0].definition.nodes.filter(node=>node.assigneeIds.length).forEach(node=>node.assigneeIds=node.assigneeIds.map(id=>id==='reviewer-a'?'publisher':id));state.payment.items[0].tasks.forEach(task=>task.participants=['publisher'])
    await button(payment,'graph-refresh').trigger('click');await flushPromises();await button(payment,'graph-request-request-1').trigger('click')
    const original=api.request.getMockImplementation();api.request.mockImplementation((path,input)=>path.endsWith('/decision')?Promise.reject(new Error('Lost decision')):original(path,input))
    await button(payment,'graph-comment-first').setValue('Original comment');await button(payment,'graph-approve-first').trigger('click');await flushPromises();await choose(wrapper,'travel');await choose(wrapper,'payment');await button(payment,'graph-retry-first').trigger('click');await flushPromises()
    const attempts=api.request.mock.calls.filter(([path])=>path.endsWith('/decision'));expect(attempts).toHaveLength(2);expect(attempts[0]).toEqual(attempts[1])
  })
})

describe('source quote interrupted submission safety',()=>{
  it.each([400,403,404,409])('unlocks form after definitive source rejection %i without losing the requested terms',async status=>{
    const {wrapper}=setup('requests');await flushPromises();const quoteRoot=await newQuote(wrapper),original=api.request.getMockImplementation()
    api.request.mockImplementation((path,input)=>input?.method==='POST'?Promise.reject(Object.assign(new Error('Quote source or durable payload changed'),{status})):original(path,input))
    await button(quoteRoot,'graph-submit').trigger('click');await vi.waitFor(()=>expect(button(quoteRoot,'graph-submit').element.disabled).toBe(false));await flushPromises()
    expect(button(quoteRoot,'graph-quote-requestedUnitPrice').element.disabled).toBe(false);expect(button(quoteRoot,'graph-quote-requestedUnitPrice').element.value).toBe('800.01');expect(button(quoteRoot,'graph-submit').text()).not.toContain('Retry')
  })
  it('never posts a source quote after logout/unmount while canonical-key hashing is pending',async()=>{
    const {wrapper}=setup('requests');await flushPromises();const quoteRoot=await newQuote(wrapper),wait=deferred()
    vi.stubGlobal('crypto',{randomUUID:()=>webcrypto.randomUUID(),subtle:{digest:()=>wait.promise}})
    await button(quoteRoot,'graph-submit').trigger('click');wrapper.unmount();wait.resolve(new Uint8Array(32).buffer);await flushPromises()
    expect(api.request.mock.calls.filter(([,options])=>options?.method==='POST')).toHaveLength(0)
  })
})
