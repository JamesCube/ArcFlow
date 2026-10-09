import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import {
  BUSINESS_KEYS, DOCUMENT_TYPE, DOCUMENT_VERSION, SEAL_TYPES, TEXT_LIMITS, COPY_COUNT_INPUT_MAX_LENGTH,
  InvalidSealUse, SEAL_TYPE_LABELS, VALIDATION_TEXT,
  emptySealUse, validateSealUse, normalizeSealUse, serializeSealUse, readSealUse,
  serializeSealUsePayload, readSealUsePayload, copyCountFromInput,
  emptySealUseForm, validateSealUseForm, normalizeSealUseForm, sealUseSummary,
} from './seal-use.mjs'
import { sealUseFormProposal } from './seal-use-form.mjs'
import { sealUseIntentBytes } from './prototype-intent.mjs'

const fixture = (overrides = {}) => ({
  type: 'sealUse', documentVersion: 1, businessId: 'SEAL-2026-001',
  title: 'Synthetic seal request', reason: 'Synthetic business purpose only.',
  documentName: 'Synthetic agreement', documentRef: 'doc:synthetic/001',
  sealType: 'OFFICIAL', copyCount: 2, ...overrides,
})
const encoded = (overrides = {}) => JSON.stringify(fixture(overrides))
const withRaw = (key, raw) => encoded().replace(JSON.stringify(key) + ':' + JSON.stringify(fixture()[key]), JSON.stringify(key) + ':' + raw)
const invalid = value => {
  assert.ok(validateSealUse(value).length)
  assert.throws(() => normalizeSealUse(value), InvalidSealUse)
  assert.throws(() => serializeSealUse(value), InvalidSealUse)
}
const invalidJson = source => assert.throws(() => readSealUse(source), InvalidSealUse)
const digest = value => createHash('sha256').update(sealUseIntentBytes(value)).digest('hex')

test('valid exact business model serializes and reads as an immutable canonical record', () => {
  const original = fixture()
  assert.equal(DOCUMENT_TYPE, 'sealUse')
  assert.equal(DOCUMENT_VERSION, 1)
  assert.deepEqual(validateSealUse(original), [])
  assert.deepEqual(readSealUse(serializeSealUse(original)), original)
  assert.deepEqual(Object.keys(normalizeSealUse(original)), BUSINESS_KEYS)
  assert.ok(Object.isFrozen(normalizeSealUse(original)))
  assert.equal(Object.isFrozen(original), false)
  assert.notEqual(normalizeSealUse(original), original)
  assert.deepEqual(readSealUse(' \n\r\t' + encoded() + '\t\r\n '), original)
})

test('empty business and form drafts are independent and explicitly typed', () => {
  const first = emptySealUse(), second = emptySealUse(), form = emptySealUseForm()
  assert.deepEqual(Object.keys(first), BUSINESS_KEYS)
  assert.equal(first.copyCount, 1)
  assert.equal(form.copyCount, '1')
  assert.equal(first.sealType, 'OFFICIAL')
  assert.deepEqual(validateSealUse(first).map(issue => issue.path), ['businessId', 'title', 'reason', 'documentName', 'documentRef'])
  first.title = 'Changed'
  assert.equal(second.title, '')
  assert.equal(form.title, '')
})

for (const key of BUSINESS_KEYS) {
  test(`required field: ${key}`, () => {
    const missing = fixture(); delete missing[key]
    invalid(missing)
    invalid(fixture({ [key]: undefined }))
    invalid(fixture({ [key]: null }))
  })
}
for (const key of ['purpose', 'currency', 'amount', 'total', 'lines', 'costCenter', 'days', 'quantity', 'unitPrice', 'destination', 'departureDate', 'customerName', 'discount', 'applicantId', 'status', 'history', 'processVersion', 'fingerprint', 'submissionKey', 'tenantId', 'sealImage', 'attachment', 'constructor', 'toJSON', '__proto__']) {
  test(`rejects unknown, derived or foreign field: ${key}`, () => {
    const value = fixture()
    Object.defineProperty(value, key, { value: 'foreign', enumerable: true, configurable: true })
    invalid(value)
    invalidJson(JSON.stringify(value))
  })
}
for (const value of [null, undefined, [], '', 1, true, new Date(), new Map(), Object.create(fixture())]) {
  test(`rejects non-data business shape: ${Object.prototype.toString.call(value)}`, () => invalid(value))
}

test('rejects hidden, symbolic, accessor and class-instance fields', () => {
  const hidden = fixture(); Object.defineProperty(hidden, 'hidden', { value: true })
  const symbolic = fixture(); symbolic[Symbol('extra')] = true
  const accessor = fixture(); Object.defineProperty(accessor, 'title', { get: () => 'not plain data', enumerable: true })
  const concealedRequired = fixture(); Object.defineProperty(concealedRequired, 'title', { value: 'hidden', enumerable: false })
  class Custom { constructor() { Object.assign(this, fixture()) } }
  for (const value of [hidden, symbolic, accessor, concealedRequired, new Custom()]) invalid(value)
  const nullPrototype = Object.assign(Object.create(null), fixture())
  assert.deepEqual(normalizeSealUse(nullPrototype), fixture())
})

for (const type of ['seal-use', 'sealuse', 'SEALUSE', 'expense', 'travel', '', 1, true, {}, ['sealUse']]) {
  test(`rejects other type ${JSON.stringify(type)}`, () => invalid(fixture({ type })))
}
for (const documentVersion of [0, -1, 2, 1.1, '1', true, false, NaN, Infinity, 1n, new Number(1)]) {
  test(`rejects document version ${String(documentVersion)}`, () => invalid(fixture({ documentVersion })))
}

for (const field of ['businessId', 'documentRef']) {
  test(`${field} accepts exact ASCII grammar and 1/128 boundaries`, () => {
    for (const value of ['a', '0', 'A._:/-09azAZ', 'a'.repeat(128)]) {
      assert.deepEqual(validateSealUse(fixture({ [field]: value })), [])
      assert.equal(readSealUse(encoded({ [field]: value }))[field], value)
    }
  })
  for (const value of ['', 'a'.repeat(129), '_a', '.a', ':a', '/a', '-a', ' a', 'a ', 'a\t', 'a\n', 'é', '中文', 'a@b', 'a\\b', 'a?b', 'a#b', 'a%b', 'a+b', 'a\u0000b', '\u00a0a', 'a\ufeff', 1, true, {}, []]) {
    test(`${field} rejects ${JSON.stringify(value)}`, () => invalid(fixture({ [field]: value })))
  }
}

for (const [field, max] of Object.entries(TEXT_LIMITS)) {
  test(`${field} validates raw UTF-16 length before canonical edge trimming`, () => {
    for (const value of ['a', 'x'.repeat(max), '😀'.repeat(max / 2)]) {
      assert.deepEqual(validateSealUse(fixture({ [field]: value })), [])
      assert.equal(normalizeSealUse(fixture({ [field]: value }))[field], value)
    }
    for (const value of ['x'.repeat(max + 1), '😀'.repeat(max / 2) + 'a', ' ' + 'x'.repeat(max), 'x'.repeat(max) + '\u0000']) invalid(fixture({ [field]: value }))
    const padded = '\u0000\t\r\n ' + 'x'.repeat(max - 10) + ' \n\r\t\u001f'
    assert.equal(padded.length, max)
    assert.equal(normalizeSealUse(fixture({ [field]: padded }))[field], 'x'.repeat(max - 10))
  })
  test(`${field} rejects all-blank C0, Unicode White_Space and BOM strings`, () => {
    const whitespace = [
      ...Array.from({ length: 33 }, (_, index) => String.fromCharCode(index)),
      '\u0085', '\u00a0', '\u1680', ...Array.from({ length: 11 }, (_, index) => String.fromCharCode(0x2000 + index)),
      '\u2028', '\u2029', '\u202f', '\u205f', '\u3000', '\ufeff',
    ]
    for (const value of ['', ...whitespace, whitespace.join('')]) invalid(fixture({ [field]: value }))
    for (const value of [0, true, {}, [], new String('value')]) invalid(fixture({ [field]: value }))
  })
  test(`${field} preserves other edge whitespace and all interior content`, () => {
    for (const value of ['\u00a0text\u00a0', '\u0085text\u0085', '\ufefftext\ufeff', '\u200b', '\u180e', 'a\u0000b', 'a\t\r\nb', 'e\u0301', 'é', '\ud800x', 'x\udfff', '😀']) {
      const actual = normalizeSealUse(fixture({ [field]: ' \t' + value + '\n\r' }))[field]
      assert.equal(actual, value)
      assert.equal(readSealUse(serializeSealUse(fixture({ [field]: value })))[field], value)
    }
  })
}

test('normalization is deterministic, idempotent, immutable, and does not alter source', () => {
  const raw = fixture({ title: ' \u0000 Title\t', reason: '\nPurpose\r', documentName: '\u001fDocument ' })
  const before = structuredClone(raw), first = normalizeSealUse(raw)
  assert.deepEqual(raw, before)
  assert.deepEqual(first, fixture({ title: 'Title', reason: 'Purpose', documentName: 'Document' }))
  assert.deepEqual(normalizeSealUse(first), first)
  assert.throws(() => { first.title = 'changed' }, TypeError)
  const reversed = Object.fromEntries(Object.entries(raw).reverse())
  assert.equal(serializeSealUse(raw), serializeSealUse(reversed))
})

for (const sealType of SEAL_TYPES) {
  test(`accepts and labels synthetic seal ${sealType}`, () => {
    const business = fixture({ sealType })
    assert.deepEqual(validateSealUse(business), [])
    assert.equal(readSealUse(encoded({ sealType })).sealType, sealType)
    assert.match(SEAL_TYPE_LABELS[sealType].zh, /合成示例/)
    assert.match(SEAL_TYPE_LABELS[sealType].en, /Synthetic/)
  })
}
for (const sealType of ['official', 'OFFICIAL ', '公章', 'OTHER', '', 1, true, {}, []]) {
  test(`rejects unsupported seal type ${JSON.stringify(sealType)}`, () => invalid(fixture({ sealType })))
}

test('copyCount accepts every numeric integer from 1 through 100', () => {
  for (let copyCount = 1; copyCount <= 100; copyCount++) {
    assert.deepEqual(validateSealUse(fixture({ copyCount })), [])
    assert.equal(readSealUse(encoded({ copyCount })).copyCount, copyCount)
    assert.equal(typeof readSealUse(encoded({ copyCount })).copyCount, 'number')
  }
})
for (const copyCount of [0, -0, -1, 101, 1.5, 1.0000000000000002, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER, '1', '100', '', true, false, {}, [], new Number(2), 1n]) {
  test(`rejects noninteger/coercive model copy count ${String(copyCount)}`, () => invalid(fixture({ copyCount })))
}
for (const raw of ['1.0', '2.00', '1e0', '1E+0', '1e2', '1e-0', '1.00000000000000001', '2.1', '"1"', 'true', 'false', 'null', '[]', '{}', '0', '-0', '-1', '101', '9007199254740992', '1e100000', '01', '+1', 'NaN', 'Infinity']) {
  test(`raw JSON rejects copyCount lexeme ${raw}`, () => invalidJson(withRaw('copyCount', raw)))
}
for (const raw of ['1.0', '1e0', '1E+0', '"1"', 'true', 'null', '0', '2']) {
  test(`raw JSON rejects documentVersion lexeme ${raw}`, () => invalidJson(withRaw('documentVersion', raw)))
}

for (const source of ['', 'undefined', 'null', 'true', '[]', '{}', '{', '[1,]', '{"a":1,}', encoded() + ' false', encoded() + encoded(), '\ufeff' + encoded(), encoded().slice(0, -1) + ',}', encoded().replace('"title":', 'title:'), encoded().replace('Synthetic seal request', 'bad\nstring'), encoded().replace('"copyCount":2', '"copyCount":2,"copyCount":3'), encoded().replace('"copyCount":2', '"copyCount":2,"\\u0063opyCount":3'), encoded().replace('"title":"Synthetic seal request"', '"title":"first","title":"second"')]) {
  test(`raw JSON fails closed: ${source.slice(0, 60)}`, () => invalidJson(source))
}

test('parser rejects excessive nesting/size and non-string input', () => {
  invalidJson('['.repeat(66) + '1' + ']'.repeat(66))
  invalidJson(' '.repeat(8_000_001))
  for (const value of [null, undefined, 1, {}, []]) invalidJson(value)
})

test('safe integer input converts all canonical 1–100 strings', () => {
  for (let expected = 1; expected <= 100; expected++) {
    const result = copyCountFromInput(String(expected))
    assert.deepEqual(result, { ok: true, value: expected, issue: null })
    assert.ok(Object.isFrozen(result))
  }
})
for (const raw of ['', ' ', '\t', '0', '-0', '-1', '101', '+1', '2copies', '2.0', '2.', '.2', '2e0', '2E1', '2e', '1_0', '２', '١', '2\u0000', '2 0', '00', '000', '000101', '00000000000000001', ' '.repeat(16) + '1', '1' + ' '.repeat(16), 'Infinity', 'NaN', '1000', true, false, null, undefined, 2, {}, []]) {
  test(`integer input preserves and rejects ${JSON.stringify(raw)}`, () => {
    const result = copyCountFromInput(raw)
    assert.equal(result.ok, false)
    assert.equal(result.value, null)
    assert.equal(result.issue.path, 'copyCount')
    const draft = { ...fixture(), copyCount: raw }
    const before = structuredClone(draft)
    assert.ok(validateSealUseForm(draft).some(issue => issue.path === 'copyCount'))
    assert.throws(() => normalizeSealUseForm(draft), InvalidSealUse)
    assert.deepEqual(draft, before)
  })
}

test('benign pasted whitespace and leading zeros survive editing and normalize only on submit', () => {
  assert.equal(COPY_COUNT_INPUT_MAX_LENGTH, 16)
  for (const [raw, expected] of [
    [' 2 ', 2], ['02', 2], ['0001', 1], ['000100', 100],
    ['\t002\n', 2], ['2\u00a0', 2], ['\ufeff02\u3000', 2],
    ['0000000000000001', 1], [' '.repeat(15) + '1', 1],
  ]) {
    const draft = { ...fixture(), copyCount: raw }
    assert.deepEqual(copyCountFromInput(raw), { ok: true, value: expected, issue: null })
    assert.deepEqual(validateSealUseForm(draft), [])
    assert.equal(draft.copyCount, raw)
    assert.equal(normalizeSealUseForm(draft).copyCount, expected)
    assert.equal(draft.copyCount, raw)
    assert.equal(typeof normalizeSealUseForm(draft).copyCount, 'number')
  }
})

test('valid text form becomes a numeric immutable model only at normalization', () => {
  const draft = { ...fixture(), title: '  Test  ', copyCount: '100' }
  assert.deepEqual(validateSealUseForm(draft), [])
  assert.ok(validateSealUse(draft).some(issue => issue.path === 'copyCount'))
  const normalized = normalizeSealUseForm(draft)
  assert.equal(normalized.copyCount, 100)
  assert.equal(normalized.title, 'Test')
  assert.equal(draft.copyCount, '100')
  assert.equal(draft.title, '  Test  ')
  assert.ok(Object.isFrozen(normalized))
  assert.deepEqual(readSealUse(serializeSealUse(normalized)), normalized)
})

test('form validation collects purpose and integer errors without dropping raw text', () => {
  const draft = { ...fixture(), reason: '\ufeff\u0085', copyCount: '2copies' }
  assert.deepEqual(validateSealUseForm(draft).map(issue => issue.path), ['reason', 'copyCount'])
  assert.equal(draft.copyCount, '2copies')
  assert.equal(validateSealUseForm({ ...draft, extra: true })[0].code, 'fields')
  assert.equal(validateSealUseForm(null)[0].code, 'fields')
})

test('prototype submit envelope validates exact keys and processVersion', () => {
  for (const processVersion of [1, 2147483647]) {
    const payload = { business: fixture(), processVersion }
    assert.deepEqual(readSealUsePayload(serializeSealUsePayload(payload)), payload)
    assert.ok(Object.isFrozen(readSealUsePayload(JSON.stringify(payload))))
    assert.ok(Object.isFrozen(readSealUsePayload(JSON.stringify(payload)).business))
  }
  for (const payload of [null, [], {}, { business: fixture() }, { business: fixture(), processVersion: 1, total: 0 }]) assert.throws(() => serializeSealUsePayload(payload), InvalidSealUse)
  for (const processVersion of [0, -1, 2147483648, 1.5, '1', true, null, NaN]) assert.throws(() => serializeSealUsePayload({ business: fixture(), processVersion }), InvalidSealUse)
  for (const raw of ['1.0', '1e0', '"1"', 'true', 'null']) assert.throws(() => readSealUsePayload(`{"business":${encoded()},"processVersion":${raw}}`), InvalidSealUse)
  assert.throws(() => readSealUsePayload(`{"business":${encoded()},"processVersion":1,"processVersion":1}`), InvalidSealUse)
})

test('summary reports the actual copy count and synthetic seal without a monetary placeholder', () => {
  for (const copyCount of [1, 2, 100]) for (const sealType of SEAL_TYPES) {
    const summary = sealUseSummary(fixture({ sealType, copyCount }))
    assert.deepEqual(Object.keys(summary), ['sealType', 'sealTypeLabel', 'copyCount', 'copyCountLabel'])
    assert.equal(summary.copyCount, copyCount)
    assert.equal(summary.sealType, sealType)
    assert.equal(summary.copyCountLabel.zh, `${copyCount} 份`)
    assert.equal(summary.copyCountLabel.en, `${copyCount} ${copyCount === 1 ? 'copy' : 'copies'}`)
    assert.ok(Object.isFrozen(summary))
    for (const forbidden of ['amount', 'currency', 'total', 'money']) assert.equal(Object.hasOwn(summary, forbidden), false)
  }
  assert.throws(() => sealUseSummary(fixture({ copyCount: 0 })), InvalidSealUse)
})

test('every validation message is useful in Chinese and English, including business purpose', () => {
  for (const [code, text] of Object.entries(VALIDATION_TEXT)) {
    assert.match(text.zh, /[\u4e00-\u9fff]/, code)
    assert.match(text.en, /[A-Za-z]/, code)
    assert.ok(Object.isFrozen(text))
  }
  assert.match(VALIDATION_TEXT.reason.zh, /用途说明/)
  assert.match(VALIDATION_TEXT.reason.en, /business purpose/)
  for (const key of ['title', 'reason', 'documentName', 'copyCountInput']) {
    assert.doesNotMatch(VALIDATION_TEXT[key].zh + VALIDATION_TEXT[key].en, /UTF-16|C0|trim|代码单元|控制字符|leading zeros|前导零/i)
  }
  assert.match(VALIDATION_TEXT.copyCountInput.zh, /1–100.*整数份数/)
  assert.match(VALIDATION_TEXT.copyCountInput.en, /whole-number.*1 to 100/)
  const problem = validateSealUse(fixture({ copyCount: '2' }))[0]
  assert.ok(Object.isFrozen(problem))
  assert.throws(() => { problem.message.en = 'changed' }, TypeError)
})

test('compiled metadata exactly matches reviewable JSON, is deeply immutable and explicitly a proposal', () => {
  const json = JSON.parse(readFileSync(new URL('../form-template.json', import.meta.url), 'utf8'))
  assert.deepEqual(sealUseFormProposal, json)
  const visit = value => {
    if (value && typeof value === 'object') {
      assert.ok(Object.isFrozen(value))
      Object.values(value).forEach(visit)
    }
  }
  visit(sealUseFormProposal)
  assert.equal(sealUseFormProposal.status, 'proposal')
  assert.equal(sealUseFormProposal.registered, false)
  assert.equal(sealUseFormProposal.runnable, false)
  assert.equal(sealUseFormProposal.synthetic, true)
  assert.equal(sealUseFormProposal.lineItems, null)
  assert.deepEqual(sealUseFormProposal.sections.map(section => section.id), ['identity', 'document', 'purpose'])
  assert.deepEqual(Object.keys(sealUseFormProposal.proposedResponse), ['request', 'total'])
  assert.equal(sealUseFormProposal.proposedResponse.total, null)
  assert.match(sealUseFormProposal.integrationRequirements.join(' '), /integer/)
  assert.match(sealUseFormProposal.integrationRequirements.join(' '), /null lineItems/)
  assert.throws(() => { sealUseFormProposal.sections[0].fields[0].kind = 'money' }, TypeError)
})

test('metadata has exact typed fields, synthetic enum labels and the existing reason-purpose mapping', () => {
  const fields = sealUseFormProposal.sections.flatMap(section => section.fields)
  assert.deepEqual(new Set(fields.map(field => field.path)), new Set(BUSINESS_KEYS.filter(key => !['type', 'documentVersion'].includes(key))))
  assert.equal(fields.length, 7)
  assert.deepEqual(new Set(fields.map(field => field.kind)), new Set(['text', 'textarea', 'select', 'integer']))
  assert.ok(fields.every(field => field.required))
  const purpose = fields.find(field => field.path === 'reason')
  assert.deepEqual(purpose.label, { zh: '用途说明', en: 'Business purpose' })
  assert.equal(fields.some(field => field.path === 'purpose'), false)
  const copies = fields.find(field => field.path === 'copyCount')
  assert.deepEqual([copies.minimum, copies.maximum, copies.step], [1, 100, 1])
  assert.equal(copies.maxLength, COPY_COUNT_INPUT_MAX_LENGTH)
  assert.equal(copies.draftValueType, 'string')
  assert.equal(copies.businessValueType, 'number')
  const seals = fields.find(field => field.path === 'sealType')
  assert.deepEqual(seals.options.map(option => option.value), SEAL_TYPES)
  for (const option of seals.options) assert.deepEqual(option.label, SEAL_TYPE_LABELS[option.value])
  for (const field of fields) {
    assert.equal(Object.hasOwn(field, 'placeholder'), false)
    assert.equal(['money', 'amount', 'currency', 'total'].includes(field.path), false)
  }
})

test('prototype intent frame compares canonical values and remains separate from the wire model', () => {
  const base = fixture(), padded = fixture({ title: '  Synthetic seal request\n' })
  assert.equal(digest(base), digest(padded))
  assert.equal(digest(base), digest(Object.fromEntries(Object.entries(base).reverse())))
  for (const [key, value] of Object.entries({ businessId: 'other', title: 'other', reason: 'other', documentName: 'other', documentRef: 'other', sealType: 'FINANCE', copyCount: 3 })) {
    assert.notEqual(digest(base), digest(fixture({ [key]: value })))
  }
  assert.notEqual(digest(fixture({ title: '\ud800' })), digest(fixture({ title: '\ufffd' })))
  assert.notEqual(digest(fixture({ title: 'é' })), digest(fixture({ title: 'e\u0301' })))
  assert.deepEqual(Object.keys(readSealUse(serializeSealUse(base))), BUSINESS_KEYS)
  assert.match(digest(base), /^[0-9a-f]{64}$/)
})
