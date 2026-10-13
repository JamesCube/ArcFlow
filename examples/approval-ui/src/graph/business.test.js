import { describe, expect, it } from 'vitest'
import { webcrypto } from 'node:crypto'
import { createApi } from '../api.js'
import { GRAPH_FAMILIES, familyForDefinition, normalizeBusiness, emptyBusiness, businessErrors, expectedFact, expectedRoutes, quoteFromSource, quoteSubmissionKey, validateQuoteSources, businessSummary } from './business.js'
import { graphDefinition, graphInstance, serializeBusiness, submissionBody, previewBody, graphCapabilities } from './api.js'
import { insertOnEdge, validateClientGraph } from './model.js'
import { definition, business, instance, directory } from './fixtures.test-support.js'
export const travel = () => ({ type:'travel',documentVersion:1,businessId:'TR-1',title:'Client visit',reason:'Delivery planning',destination:'Hangzhou',startDate:'2026-11-01',endDate:'2026-11-03',purpose:'CUSTOMER_VISIT',estimatedCost:'12500.01',currency:'CNY',costCenter:'SALES' })
export const receiving = () => ({type:'receiving',documentVersion:1,businessId:'RC-1',title:'Goods inspection',reason:'Purchase delivery',purchaseOrderRef:'PO-1',warehouse:'EAST',receivedOn:'2026-10-12',lines:[{lineId:'line-1',orderLineRef:'PO-1-1',description:'Brackets',unit:'PCS',ordered:10,received:10,accepted:8,rejected:2,exceptionReason:'Bent brackets'},{lineId:'line-2',orderLineRef:'PO-1-2',description:'Boxes',unit:'BOX',ordered:3,received:3,accepted:3,rejected:0,exceptionReason:''}]})
export const source = () => ({businessId:'Q-DEMO-001',revision:1,customerRef:'CUSTOMER-A',ownerId:'publisher',readerIds:['publisher','reviewer-a','reviewer-b'],item:'Equipment',quantity:10,listUnitPrice:'1000.00',currency:'CNY',validUntil:'2099-12-31'})
export const quote = () => quoteFromSource(source(),{title:'Customer discount',reason:'Volume order',requestedUnitPrice:'800.01'})
export const familyInstance = (family, document) => { const value=instance();value.definition.id=family.id;value.definition.schemaVersion=family.schemaVersion;value.business=normalizeBusiness(document);return value }
export const capabilities = family => ({schemaVersion:family.schemaVersion,businessType:family.type,facts:family.fields.map(field=>({field,type:field.includes('hasRejected')?'boolean':field.includes('Percent')?'percent':'money',currencies:field.includes('hasRejected')||field.includes('Percent')?[]:['CNY','USD','EUR','GBP','JPY'],operators:field.includes('hasRejected')?['EQ']:['EQ','GT','GTE','LT','LTE']})),permissions:{canPublish:true,canSubmit:true}})

describe('graph family wire isolation',()=>{
  it('keeps every legacy schema 5 ID payment-bound, including names reserved only by schema 6',()=>{
    for(const id of ['custom-payment', 'travel-graph', 'receiving-graph', 'quote-graph']) {
      const legacy=instance();legacy.definition.id=id
      expect(familyForDefinition(legacy.definition).key).toBe('payment')
      expect(graphInstance(legacy,'payment')).toBe(legacy)
      expect(validateClientGraph(legacy.definition)).toEqual([])
      expect(JSON.parse(previewBody(legacy.definition,business())).business.type).toBe('paymentRequest')
      expect(()=>graphDefinition(legacy.definition,'travel')).toThrow()
      const edited=insertOnEdge(legacy.definition,'finish','exclusiveGateway',directory)
      expect(edited.edges.find(edge=>edge.condition).condition.predicates[0].field).toBe('payment.netTotal')
    }
  })
  it('rejects schema 6 unknown/payment IDs and schema downgrades even without any conditional predicates',()=>{
    for(const id of ['unknown-graph', 'payment-graph']) {
      const graph={...definition(),schemaVersion:6,id}
      expect(()=>graphDefinition(graph)).toThrow()
      expect(validateClientGraph(graph).map(item=>item.code)).toContain('INVALID_DEFINITION')
    }
    for(const family of GRAPH_FAMILIES.filter(value=>value.schemaVersion===6)) {
      const graph={...definition(),schemaVersion:6,id:family.id}
      expect(graphDefinition(graph,family.key)).toBe(graph)
      expect(()=>graphDefinition({...graph,schemaVersion:5},family.key)).toThrow()
      expect(()=>graphInstance({...instance(),definition:graph},family.key)).toThrow()
      expect(()=>graphCapabilities({...capabilities(family),schemaVersion:5},family.key)).toThrow()
    }
  })
  it.each([[0,business],[1,travel],[2,receiving],[3,quote]])('accepts only the fixed family and exact snapshot shape (%i)',(index,make)=>{
    const family=GRAPH_FAMILIES[index],value=familyInstance(family,make())
    expect(graphInstance(value,family.key)).toBe(value)
    for(const other of GRAPH_FAMILIES.filter(entry=>entry!==family)) { expect(()=>graphInstance(value,other.key)).toThrow();expect(()=>graphDefinition(value.definition,other.key)).toThrow();expect(()=>serializeBusiness(value.business,other.key)).toThrow() }
    expect(()=>graphInstance({...value,business:{...value.business,discountPercent:20}},family.key)).toThrow()
    expect(()=>graphInstance({...value,business:{...value.business,title:' unnormalized '}},family.key)).toThrow()
    expect(businessErrors(emptyBusiness(family.key,()=> 'test')).length).toBeGreaterThan(0)
  })
  it('keeps exact travel and quote money as numeric lexemes and receiving quantities as integers',()=>{
    expect(serializeBusiness(travel())).toContain('"estimatedCost":12500.01')
    expect(serializeBusiness(quote())).toContain('"requestedUnitPrice":800.01')
    expect(serializeBusiness(receiving())).toContain('"rejected":2')
    expect(JSON.parse(submissionBody(quote(),3))).toMatchObject({expectedVersion:3,business:{quoteRevision:1}})
    for(const make of [travel,quote]){const value=make(),key=value.type==='travel'?'estimatedCost':'requestedUnitPrice';for(const invalid of ['1.001','1.0000000000000001','1e2','',-1,true])expect(()=>serializeBusiness({...value,[key]:invalid})).toThrow();expect(()=>serializeBusiness({...value,currency:'JPY',[key]:'1.01'})).toThrow()}
    expect(()=>previewBody(definition(),travel())).toThrow()
  })
  it('preserves quote prices and percent lexemes before native JSON rounding',async()=>{
    const read=raw=>createApi(async()=>({ok:true,text:async()=>raw})).request('/graphs/quote/process')
    expect(await read('{"currency":"CNY","listUnitPrice":1E+3,"requestedUnitPrice":8.0001E+2}')).toEqual({currency:'CNY',listUnitPrice:'1000.00',requestedUnitPrice:'800.01'})
    expect(await read('{"field":"quote.discountPercent","operator":"GTE","threshold":2E+1}')).toMatchObject({threshold:20})
    for(const raw of ['{"currency":"CNY","requestedUnitPrice":1.0000000000000001}','{"currency":"JPY","requestedUnitPrice":0.99}','{"currency":"CNY","listUnitPrice":1000000001}','{"field":"quote.discountPercent","threshold":20.000000000000001}','{"field":"quote.discountPercent","threshold":100.01}','{"field":"quote.discountPercent","threshold":1e2147483648}','{"field":"quote.discountPercent","currency":"CNY","threshold":20}','{"field":"unknown","threshold":20}'])await expect(read(raw)).rejects.toThrow()
  })
  it('trusts only matching typed capability fields and rejects forged family metadata',()=>{
    for(const family of GRAPH_FAMILIES){expect(graphCapabilities(capabilities(family),family.key).businessType).toBe(family.type);const wrong=capabilities(family);wrong.facts[0].field='untrusted.amount';expect(()=>graphCapabilities(wrong,family.key)).toThrow()}
  })
})
describe('typed graph route facts',()=>{
  it.each(GRAPH_FAMILIES)('creates editable default predicates only for $key',family=>{
    const graph={...definition(),id:family.id,schemaVersion:family.schemaVersion};const next=insertOnEdge(graph,'finish','exclusiveGateway',directory)
    expect(validateClientGraph(next)).toEqual([])
    const atom=next.edges.find(edge=>edge.condition).condition.predicates[0]
    expect(family.fields).toContain(atom.field)
    atom.field='other.arbitraryFact';expect(validateClientGraph(next).map(item=>item.code)).toContain('INVALID_PREDICATE')
  })
  it('uses exact cross multiplication at percentage boundaries and rejects rounded server evidence',()=>{
    const rule={field:'quote.discountPercent',operator:'GTE',threshold:20}
    expect(expectedFact(rule,quote())).toEqual({field:rule.field,actualValue:'19999/1000%',result:false})
    expect(expectedFact(rule,{...quote(),requestedUnitPrice:'800.00'}).result).toBe(true)
    expect(expectedFact({field:'receiving.hasRejectedLines',operator:'EQ',expected:true},receiving()).actualValue).toBe('true')
    const value=familyInstance(GRAPH_FAMILIES[3],quote());value.definition=insertOnEdge(value.definition,'finish','exclusiveGateway',directory);value.definition.edges.find(edge=>edge.condition).condition.predicates=[rule];value.routes=expectedRoutes(value.definition,value.business)
    expect(graphInstance(value,'quoteDiscount')).toBe(value)
    value.routes[0].evaluations[0].facts[0].actualValue='20%';expect(()=>graphInstance(value,'quoteDiscount')).toThrow()
  })
  it('preserves quantities by unit and strict canonical quote source identity',async()=>{
    expect(businessSummary(receiving()).value).toBe('10 PCS · 3 BOX')
    expect(validateQuoteSources([source()])).toHaveLength(1)
    expect(()=>validateQuoteSources([{...source(),discountPercent:20}])).toThrow()
    expect(quoteFromSource(source(),{title:'Saved',reason:'Reason',requestedUnitPrice:'799.99',customerRef:'forged'})).toMatchObject({title:'Saved',customerRef:'CUSTOMER-A',requestedUnitPrice:'799.99'})
    const previous=globalThis.crypto;Object.defineProperty(globalThis,'crypto',{value:webcrypto,configurable:true})
    try { const expected=await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode('Q-DEMO-001\\n1'));expect(await quoteSubmissionKey(quote())).toBe('quote:'+Array.from(new Uint8Array(expected),value=>value.toString(16).padStart(2,'0')).join('')) } finally {Object.defineProperty(globalThis,'crypto',{value:previous,configurable:true})}
  })
})
