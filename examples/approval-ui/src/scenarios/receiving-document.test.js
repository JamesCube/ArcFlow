import { describe, expect, it } from 'vitest'
import { emptyReceiving, quantity, receivingErrors, normalizeReceiving, receivingSummary, serializeReceivingPayload } from './receiving-document.js'
import { clone, receivingFixture, receivingViewFixture, decidedFixture, viewFixture, catalogFixture } from './scenario-fixtures.js'
import { parseScenarioJson } from './scenario-api.js'
import { getScenarioHandler } from './scenario-registry.js'
import { validateScenarioCatalog } from './scenario-template.js'
const handler = getScenarioHandler('erp-receiving')
describe('receiving exact quantity boundary', () => {
  it.each([0, '0', 1, '1', 100000, '100000'])('accepts canonical integer %j', value => expect(quantity(value)).toBe(Number(value)))
  it.each(['', ' ', ' 1', '1 ', '01', '+1', '-0', '-1', '1.0', '1.0000000000000000001', '1e2', 'Infinity', 'NaN', true, false, null, undefined, [], {}, -1, -0, .1, 100001, NaN, Infinity, 9007199254740992])('rejects invalid raw input %j', value => expect(quantity(value)).toBeNull())
  it.each(['0.0', '1.000000000000000000000001', '1e0', '1E+2', '9007199254740993'])('rejects raw numeric token before lossy native parsing: %s', token => {
    expect(() => parseScenarioJson(`{"received":${token}}`)).toThrow()
  })
  it('serializes validated draft quantities as JSON integers and trims only C0 edges', () => {
    const business = receivingFixture(); business.title = ' \t收货验收\n'; business.lines[0].received = '80'; business.lines[1].exceptionReason = '  Note  '
    const payload = serializeReceivingPayload({ business, processVersion: 1 })
    expect(JSON.parse(payload).business.title).toBe('收货验收'); expect(JSON.parse(payload).business.lines[0].received).toBe(80)
    expect(JSON.parse(payload).business.lines[1].exceptionReason).toBe('Note'); expect(payload).not.toContain('"received":"80"')
    const normalized = normalizeReceiving(business); expect(Object.isFrozen(normalized.lines[0])).toBe(true)
  })
  it('totals quantities per unit rather than combining pieces and boxes', () => {
    expect(receivingSummary(receivingFixture())).toEqual({ kind: 'receiving', lineCount: 2, exceptionLineCount: 1, quantities: [{ unit: 'PCS', received: 80, accepted: 78, rejected: 2 }, { unit: 'BOX', received: 10, accepted: 10, rejected: 0 }] })
    const business = receivingFixture(); business.lines.reverse()
    expect(receivingSummary(business).quantities.map(row => row.unit)).toEqual(['PCS', 'BOX'])
    business.lines = business.lines.filter(line => line.unit === 'BOX'); expect(receivingSummary(business).quantities).toHaveLength(1)
  })
  it('keeps 20 lines at the upper quantity bound exact', () => {
    const business = receivingFixture(); business.lines = Array.from({ length: 20 }, (_, index) => ({ ...business.lines[0], lineId: `line-${index}`, orderLineRef: `PO-${index}`, ordered: 100000, received: 100000, accepted: 100000, rejected: 0, exceptionReason: '' }))
    expect(receivingErrors(business)).toEqual([]); expect(receivingSummary(business).quantities[0].received).toBe(2000000)
    business.lines.push({ ...business.lines[0], lineId: 'extra', orderLineRef: 'extra' }); expect(receivingErrors(business)).toContain('lines')
  })
  it('allows a zero-received line only when another line receives goods', () => {
    const business = receivingFixture(); Object.assign(business.lines[0], { received: 0, accepted: 0, rejected: 0, exceptionReason: '' })
    expect(receivingErrors(business)).toEqual([])
    Object.assign(business.lines[1], { received: 0, accepted: 0, rejected: 0 }); expect(receivingErrors(business)).toContain('received')
  })
  it.each(['\u0000', '\u0085', '\u00a0', '\u1680', '\u2000', '\u2028', '\u202f', '\u205f', '\u3000', '\ufeff'])('rejects mandatory whitespace-only text %j', space => {
    const business = receivingFixture({ title: space }); business.lines[0].exceptionReason = space
    expect(receivingErrors(business)).toContain('title'); expect(receivingErrors(business)).toContain('lines.0.exceptionReason')
    business.title = `${space}中文${space}`; business.lines[0].exceptionReason = 'Valid reason'; expect(receivingErrors(business)).toEqual([])
  })
  it('checks raw UTF-16 lengths, preserves optional notes, and refuses unknown fields', () => {
    const business = receivingFixture(); business.lines[1].exceptionReason = '  Optional note  '
    expect(normalizeReceiving(business).lines[1].exceptionReason).toBe('Optional note')
    business.title = 'a'.repeat(120) + ' '; expect(receivingErrors(business)).toContain('title')
    business.title = '😀'.repeat(61); expect(receivingErrors(business)).toContain('title')
    business.unapproved = true; expect(receivingErrors(business)).toEqual(['fields'])
  })
  const mutations = [
    [b => { b.lines[0].ordered = 0 }, 'lines.0.ordered'], [b => { b.lines[0].received = 101 }, 'lines.0.received'],
    [b => { b.lines[0].accepted = 77 }, 'lines.0.reconciliation'], [b => { b.lines[0].exceptionReason = '' }, 'lines.0.exceptionReason'],
    [b => { b.lines[0].exceptionReason = 'x'.repeat(1001) }, 'lines.0.exceptionReason'],
    [b => { b.lines[1].orderLineRef = b.lines[0].orderLineRef }, 'lines.1.orderLineRef'], [b => { b.lines[1].lineId = b.lines[0].lineId }, 'lines.1.lineId'],
    [b => { b.receivedOn = '2026-02-29' }, 'receivedOn'], [b => { b.warehouse = 'UNKNOWN' }, 'warehouse'],
    [b => { b.lines[0].unit = 'KG' }, 'lines.0.unit'], [b => { b.purchaseOrderRef = ' PO-1 ' }, 'purchaseOrderRef'],
  ]
  it.each(mutations.map(([change, error], index) => [index, change, error]))('rejects malformed document case %i', (_, change, error) => {
    const business = receivingFixture(); change(business); expect(receivingErrors(business)).toContain(error); expect(() => normalizeReceiving(business)).toThrow(); expect(receivingSummary(business)).toBeNull()
  })
  it('creates independent empty drafts and lines', () => {
    let id = 0; const a = emptyReceiving(() => ++id), b = emptyReceiving(() => ++id)
    expect(a.lines[0].lineId).not.toBe(b.lines[0].lineId); expect(a.type).toBe('receiving'); expect(a.lines[0].received).toBe('')
  })
})
describe('strict receiving metadata and acknowledged snapshots', () => {
  it('accepts its metadata, integer summary and completed repeated-Bob stages', () => {
    expect(validateScenarioCatalog(catalogFixture())).toHaveLength(4)
    const start = receivingViewFixture(); expect(handler.validateView(start)).toBe(start)
    const warehouse = decidedFixture(start, 'bob'), quality = decidedFixture(warehouse, 'carol'), procurement = decidedFixture(quality, 'bob')
    expect(handler.validateDecision(warehouse, start, 'bob', 'receiving-inspection', 'APPROVE')).toBe(warehouse)
    expect(handler.validateView(quality).request.currentStepId).toBe('procurement-review')
    expect(handler.validateDecision(procurement, quality, 'bob', 'procurement-review', 'APPROVE').request.status).toBe('APPROVED')
  })
  it('validates ALL rejection with later stages not reached', () => {
    const start = receivingViewFixture(), rejected = decidedFixture(start, 'carol', 'REJECT', 'Damaged goods')
    expect(handler.validateDecision(rejected, start, 'carol', 'receiving-inspection', 'REJECT', 'Damaged goods').request.status).toBe('REJECTED')
  })
  it('prevents expense and receiving envelopes or histories crossing handlers', () => {
    expect(() => handler.validateView(viewFixture())).toThrow()
    expect(() => getScenarioHandler('oa-expense').validateView(receivingViewFixture())).toThrow()
    const receipt = receivingViewFixture(); receipt.request.definition.id = 'oa-expense'; expect(() => handler.validateView(receipt)).toThrow()
  })
  const mutations = [v => { v.total = '90' }, v => { delete v.summary }, v => { v.summary.quantities[0].received = 90 }, v => { v.summary.quantities.reverse() }, v => { v.summary.received = 90 }, v => { v.summary.exceptionLineCount = 0 }, v => { v.request.business.lines[0].received = '80' }, v => { v.request.currentStepId = 'procurement-review' }, v => { v.request.business.stockPosted = true }, v => { v.summary.quantities[0].accepted = '78' }]
  it.each(mutations.map((change, index) => [index, change]))('rejects forged acknowledgement case %i', (_, change) => {
    const view = receivingViewFixture(); change(view); expect(() => handler.validateView(view)).toThrow()
  })
  it('pins all business values and process nodes to the original submission', () => {
    const before = receivingViewFixture(), changed = clone(before); changed.request.business.purchaseOrderRef = 'PO-OTHER'
    expect(() => handler.validateView(changed, { actor: 'alice', payload: { business: before.request.business, processVersion: 1 }, definition: before.request.definition })).toThrow()
    const after = decidedFixture(before); after.request.history.at(-1).comment = 'Other note'; after.request.comment = 'Other note'
    expect(() => handler.validateDecision(after, before, 'bob', 'receiving-inspection', 'APPROVE', 'Expected note')).toThrow(expect.objectContaining({ code: 'DECISION_COMMENT_MISMATCH' }))
  })
  it('allows only the compiled optional exception field and explicit quantity kind', () => {
    let catalog = catalogFixture(); catalog.find(template => template.id === 'erp-receiving').lineItems.fields.find(f => f.path === 'exceptionReason').required = true; expect(() => validateScenarioCatalog(catalog)).toThrow()
    catalog = catalogFixture(); catalog.find(template => template.id === 'erp-receiving').lineItems.fields.find(f => f.path === 'ordered').kind = 'number'; expect(() => validateScenarioCatalog(catalog)).toThrow()
    catalog = catalogFixture(); catalog.find(template => template.id === 'erp-receiving').sections[0].fields.find(f => f.path === 'warehouse').options[0].value = 'NORTH'; expect(() => validateScenarioCatalog(catalog)).toThrow()
  })
})
