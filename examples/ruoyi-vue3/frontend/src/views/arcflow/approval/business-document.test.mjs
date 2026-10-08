import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { businessDocumentErrors, normalizeBusinessDocument, procurementTotal, formatMoney, requestBusiness } from './business-document.js'
import { createSubmissionIntent } from './submission-intent.js'
import { nativeMessages, translateProcess } from './locale.js'
import { validateDefinition } from './process.js'
const business = { type: 'procurement', businessId: 'PO-NATIVE-1', title: ' Adapters ', reason: ' Synthetic only ', item: ' USB-C adapter ', quantity: '3', unitPrice: '0.10', currency: 'USD' }
test('bootstrap and both hosts share byte-identical business, retry and response boundaries', async () => {
  for (const name of ['business-document.js', 'submission-intent.js', 'submission-response.js']) {
    assert.equal(await readFile(new URL(name, import.meta.url), 'utf8'), await readFile(new URL(`../../../../../../approval-ui/src/${name}`, import.meta.url), 'utf8'))
  }
  const bootstrap = await readFile(new URL('../../../../../bootstrap.py', import.meta.url), 'utf8')
  assert.match(bootstrap, /Shared\/native helper drift/)
  assert.match(bootstrap, /shutil.copyfile\(shared \/ name, native \/ name\)/)
})
test('typed native intent retains endpoint, exact money and immutable normalized fields across refresh', () => {
  let count = 0
  const intent = createSubmissionIntent(() => `native-${++count}`)
  const first = intent.prepare('100', { business }, 1)
  assert.equal(first.endpoint, '/documents')
  assert.equal(first.payload.business.unitPrice, 0.1)
  assert.equal(first.payload.business.quantity, 3)
  assert.equal(first.payload.business.item, 'USB-C adapter')
  assert.equal(procurementTotal(first.payload.business.quantity, first.payload.business.unitPrice, 'USD'), '0.30')
  assert.equal(formatMoney(procurementTotal('100000', '999999999.99', 'CNY'), 'CNY'), 'CNY 99,999,999,999,000.00')
  assert.equal(intent.prepare('100', { business: { ...business, unitPrice: '0.1' } }, 2), first)
  assert.equal(first.payload.processVersion, 1)
  assert.ok(Object.isFrozen(first.payload.business))
  assert.notEqual(intent.prepare('100', { business: { ...business, currency: 'EUR' } }, 2).key, first.key)
  assert.notEqual(intent.prepare('100', { title: 'Adapters', reason: 'Synthetic only', days: 1 }, 2).key, first.key)
})
test('native typed business rules fail closed and never treat typed days:0 as leave', () => {
  const normalized = normalizeBusinessDocument(business)
  const record = { business: normalized, title: normalized.title, reason: normalized.reason, days: 0 }
  assert.equal(requestBusiness(record), normalized)
  for (const malformed of [{ ...record, business: null }, { ...record, business: { ...normalized, type: 'other' } }, { ...record, days: 1 }]) {
    assert.throws(() => requestBusiness(malformed))
  }
  for (const [key, value] of [['businessId', 'bad id'], ['quantity', '1.5'], ['unitPrice', '0.001'], ['currency', 'AUD']]) assert.ok(businessDocumentErrors({ ...business, [key]: value }).length)
  assert.ok(businessDocumentErrors({ ...business, currency: 'JPY' }).includes('unitPrice'))
})
test('native locale exposes matching author, detail and validation copy without relabeling user content', () => {
  const zh = nativeMessages('zh-CN'), en = nativeMessages('en')
  assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort())
  assert.deepEqual(Object.keys(zh.errors).sort(), Object.keys(en.errors).sort())
  for (const key of ['type', 'businessId', 'item', 'quantity', 'unitPrice', 'currency', 'total', 'immutable', 'retry']) assert.notEqual(zh[key], en[key])
  assert.equal(translateProcess('当前审批', 'en'), 'Current stage')
  assert.equal(translateProcess('已同意', 'en'), 'Approved')
  assert.equal(translateProcess('Custom process label', 'en'), 'Custom process label')
})
test('native process validation retains the server-supported stable process identifier contract', () => {
  const definition = { schemaVersion: 2, id: 'procurement-approval', version: 1, name: 'Procurement', nodes: [
    { id: 'start', type: 'start', name: 'Start', assigneeId: null },
    { id: 'review', type: 'approval', name: 'Review', assigneeId: '101' },
    { id: 'end', type: 'end', name: 'End', assigneeId: null },
  ] }
  assert.equal(validateDefinition(definition, [{ id: '101' }]), '')
  assert.notEqual(validateDefinition({ ...definition, id: '../bad' }, [{ id: '101' }]), '')
})
