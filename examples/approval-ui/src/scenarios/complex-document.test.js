import { describe, expect, it } from 'vitest'
import { CURRENCIES } from './expense-document.js'
import { PAYMENT_ID, PAYMENT_AMOUNTS, emptyPayment, emptyPaymentLine, paymentAmountCents, paymentErrors, paymentTotal, paymentSummary, normalizePayment, serializePaymentPayload, paymentErrorText } from './payment-document.js'
import { CONTRACT_ID, CONTRACT_CATEGORIES, TERMS_KINDS, emptyContract, emptyContractLine, contractRevision, contractErrors, contractServerErrors, contractTotal, contractSummary, normalizeContract, normalizeContractServer, serializeContractPayload, contractErrorText } from './contract-document.js'

const paymentFixture = (overrides = {}) => ({
  type: 'paymentRequest', documentVersion: 1, businessId: 'PAY-DEMO-001', title: 'Synthetic supplier payment', reason: 'Internal approval only', supplierRef: 'SUPPLIER-DEMO-A', currency: 'CNY', requestedPaymentOn: '2099-01-15',
  lines: [
    { lineId: 'line-1', invoiceRef: 'INV-DEMO-01', description: 'First invoice', invoiceAmount: '10000.00', previouslySettledAmount: '4000.00', allocationAmount: '4500.00', deductionAmount: '500.00', deductionReason: 'Synthetic quality deduction' },
    { lineId: 'line-2', invoiceRef: 'INV-DEMO-02', description: 'Second invoice', invoiceAmount: '4000.00', previouslySettledAmount: '0', allocationAmount: '2500.00', deductionAmount: '0', deductionReason: '' },
  ], ...overrides,
})
const contractFixture = (overrides = {}) => ({
  type: 'contractApproval', documentVersion: 1, businessId: 'CONTRACT-DEMO-001', title: 'Synthetic service contract', reason: 'Internal review of the draft', customerRef: 'CUSTOMER-DEMO-A', contractRevision: '1', contractCategory: 'SERVICE', currency: 'CNY', contractAmount: '100000.00', startOn: '2099-01-01', endOn: '2099-12-31', termsKind: 'NONSTANDARD', deviationReason: 'Synthetic liability clause variation', documentRef: 'DOC-CONTRACT-DEMO-01',
  lines: [
    { lineId: 'line-1', milestoneRef: 'M1', description: 'Plan', dueOn: '2099-01-15', amount: '30000.00', acceptanceCriteria: 'Plan delivered and manually confirmed' },
    { lineId: 'line-2', milestoneRef: 'M2', description: 'Interim', dueOn: '2099-06-30', amount: '40000.00', acceptanceCriteria: 'Interim deliverables accepted' },
    { lineId: 'line-3', milestoneRef: 'M3', description: 'Final', dueOn: '2099-12-15', amount: '30000.00', acceptanceCriteria: 'Final deliverables accepted' },
  ], ...overrides,
})

describe('payment decimal arithmetic and financial invariants', () => {
  it('uses the independent payment identity and all four amount fields', () => {
    expect(PAYMENT_ID).toBe('erp-payment')
    expect(PAYMENT_AMOUNTS).toEqual(['invoiceAmount', 'previouslySettledAmount', 'allocationAmount', 'deductionAmount'])
    expect(Object.isFrozen(PAYMENT_AMOUNTS)).toBe(true)
    expect(paymentErrors(paymentFixture())).toEqual([])
    expect(paymentTotal(paymentFixture())).toBe('6500.00')
    expect(paymentSummary(paymentFixture())).toEqual({ type: 'paymentRequest', declaredOutstanding: '10000.00', grossAllocation: '7000.00', deductionTotal: '500.00', netTotal: '6500.00' })
  })
  it.each(CURRENCIES)('supports the documented currency %s without conversion', currency => {
    expect(paymentErrors(paymentFixture({ currency }))).toEqual([])
    expect(paymentTotal(paymentFixture({ currency }))).toBe(currency === 'JPY' ? '6500' : '6500.00')
  })
  it('allows zero only when the field permits it, using decimal text throughout', () => {
    expect(paymentAmountCents('0', 'CNY')).toBeNull()
    expect(paymentAmountCents('0', 'CNY', true)).toBe(0n)
    expect(paymentAmountCents('0000.00', 'JPY', true)).toBe(0n)
    expect(paymentAmountCents('0001.2', 'CNY')).toBe(120n)
    expect(paymentAmountCents('1000000000.00', 'CNY')).toBe(100000000000n)
  })
  it.each(['', ' ', '-1', '-0', '+1', '1e2', '.10', '1.', ' 1', '1 ', 'NaN', 'Infinity', '0.001', '1.00000000000000001', '1000000000.01', '0'.repeat(33), null, undefined, false, 1, 0.1])('rejects raw malformed or imprecise amount %j', value => {
    expect(paymentAmountCents(value, 'CNY', true)).toBeNull()
    const business = paymentFixture(); business.lines[0].invoiceAmount = value
    expect(paymentErrors(business)).toContain('lines.0.invoiceAmount')
    expect(paymentSummary(business)).toBeNull()
    expect(() => normalizePayment(business)).toThrow('Invalid payment document')
  })
  it('rejects unknown currencies and fractional yen in every payment amount', () => {
    expect(paymentAmountCents('1', 'BTC')).toBeNull()
    for (const field of PAYMENT_AMOUNTS) {
      const business = paymentFixture({ currency: 'JPY' }); business.lines[0][field] = '1.01'
      expect(paymentErrors(business)).toContain(`lines.0.${field}`)
    }
    const normalized = normalizePayment(paymentFixture({ currency: 'JPY' }))
    expect(normalized.lines[1]).toMatchObject({ invoiceAmount: '4000', previouslySettledAmount: '0', allocationAmount: '2500', deductionAmount: '0' })
  })
  it('calculates 0.10 plus 0.20 as exactly 0.30', () => {
    const business = paymentFixture()
    business.lines.forEach((line, index) => Object.assign(line, { invoiceAmount: index ? '0.20' : '0.10', previouslySettledAmount: '0', allocationAmount: index ? '0.20' : '0.10', deductionAmount: '0', deductionReason: '' }))
    expect(paymentErrors(business)).toEqual([])
    expect(paymentSummary(business)).toEqual({ type: 'paymentRequest', declaredOutstanding: '0.30', grossAllocation: '0.30', deductionTotal: '0.00', netTotal: '0.30' })
  })
  it('sums twenty maximum-value lines without rounding and rejects the twenty-first', () => {
    const business = paymentFixture()
    business.lines = Array.from({ length: 20 }, (_, index) => ({ ...business.lines[0], lineId: `line-${index}`, invoiceRef: `INV-${index}`, invoiceAmount: '1000000000.00', previouslySettledAmount: '0', allocationAmount: '1000000000.00', deductionAmount: '0', deductionReason: '' }))
    expect(paymentErrors(business)).toEqual([])
    expect(paymentTotal(business)).toBe('20000000000.00')
    expect(paymentSummary(business).declaredOutstanding).toBe('20000000000.00')
    business.lines.push({ ...business.lines[0], lineId: 'last', invoiceRef: 'last' })
    expect(paymentErrors(business)).toContain('lines')
    expect(paymentSummary(business)).toBeNull()
  })
  it.each([
    ['invoiceAmount', '0', 'invoiceAmount'],
    ['previouslySettledAmount', '-0.01', 'previouslySettledAmount'],
    ['previouslySettledAmount', '10000.01', 'previouslySettledAmount'],
    ['allocationAmount', '0', 'allocationAmount'],
    ['allocationAmount', '6000.01', 'allocationAmount'],
    ['deductionAmount', '-0.01', 'deductionAmount'],
    ['deductionAmount', '4500.01', 'deductionAmount'],
    ['deductionReason', '', 'deductionReason'],
    ['deductionReason', ' \t\n', 'deductionReason'],
    ['deductionReason', 'x'.repeat(1001), 'deductionReason'],
  ])('locates the violated %s invariant', (field, value, path) => {
    const business = paymentFixture(); business.lines[0][field] = value
    expect(paymentErrors(business)).toContain(`lines.0.${path}`)
  })
  it('allows fully deducted lines but requires a positive net request overall', () => {
    const business = paymentFixture(); business.lines[0].deductionAmount = business.lines[0].allocationAmount
    expect(paymentErrors(business)).toEqual([])
    expect(paymentTotal(business)).toBe('2500.00')
    business.lines[1].deductionAmount = business.lines[1].allocationAmount
    business.lines[1].deductionReason = 'Full deduction'
    expect(paymentSummary(business).netTotal).toBe('0.00')
    expect(paymentErrors(business)).toContain('netTotal')
    expect(() => normalizePayment(business)).toThrow()
  })
  it('allows an optional zero-deduction explanation but still requires its typed field', () => {
    const business = paymentFixture(); business.lines[1].deductionReason = 'Optional explanation'
    expect(paymentErrors(business)).toEqual([])
    for (const reason of [null, 0, false, 'x'.repeat(1001)]) {
      business.lines[1].deductionReason = reason
      expect(paymentErrors(business)).toContain('lines.1.deductionReason')
    }
  })
  it('does not require a completed title or reference before showing numeric draft totals', () => {
    const business = paymentFixture({ title: '', supplierRef: '' })
    expect(paymentErrors(business)).toEqual(['supplierRef', 'title'])
    expect(paymentTotal(business)).toBe('6500.00')
  })
})

describe('payment strict document and payload contract', () => {
  it('rejects each unknown or missing header/line field, including derived client totals', () => {
    for (const key of Object.keys(paymentFixture())) {
      const business = paymentFixture(); delete business[key]
      expect(paymentErrors(business)).toEqual(['fields'])
    }
    for (const key of ['netTotal', 'grossAllocation', 'deductionTotal', 'declaredOutstanding', 'extra']) expect(paymentErrors(paymentFixture({ [key]: '0' }))).toEqual(['fields'])
    for (const key of Object.keys(paymentFixture().lines[0])) {
      const business = paymentFixture(); delete business.lines[0][key]
      expect(paymentErrors(business)).toContain('lines.0.fields')
    }
    const business = paymentFixture(); business.lines[0].currency = 'CNY'
    expect(paymentErrors(business)).toContain('lines.0.fields')
  })
  it.each([
    ['type', 'expense'], ['documentVersion', '1'], ['documentVersion', 2], ['businessId', 'bad id'], ['supplierRef', '供应商'], ['title', ' '], ['title', 'x'.repeat(121)], ['reason', ''], ['reason', 'x'.repeat(2001)], ['currency', 'BTC'], ['requestedPaymentOn', '2099-02-29'], ['requestedPaymentOn', '0000-01-01'], ['requestedPaymentOn', '2099-1-15'], ['requestedPaymentOn', '2099-01-15T00:00:00Z'], ['lines', []], ['lines', null],
  ])('rejects invalid payment root %s', (key, value) => expect(paymentErrors(paymentFixture({ [key]: value })).length).toBeGreaterThan(0))
  it('accepts leap days and enforces unique valid references', () => {
    expect(paymentErrors(paymentFixture({ requestedPaymentOn: '2000-02-29' }))).toEqual([])
    const business = paymentFixture(); business.lines[1].lineId = business.lines[0].lineId; business.lines[1].invoiceRef = business.lines[0].invoiceRef
    expect(paymentErrors(business)).toEqual(expect.arrayContaining(['lines.1.lineId', 'lines.1.invoiceRef']))
    business.lines[0].description = 'x'.repeat(241)
    expect(paymentErrors(business)).toContain('lines.0.description')
    for (const value of ['_first', 'bad id', 'x'.repeat(129)]) {
      business.lines[0].invoiceRef = value
      expect(paymentErrors(business)).toContain('lines.0.invoiceRef')
    }
  })
  it('normalizes decimal and server-trimmed text into a fresh deeply frozen snapshot', () => {
    const business = paymentFixture({ title: ' \tPayment\n', reason: '\r Reason \t' })
    Object.assign(business.lines[0], { description: ' First invoice ', invoiceAmount: '00010000', previouslySettledAmount: '004000.0', allocationAmount: '04500', deductionAmount: '0500.0', deductionReason: ' Quality deduction ' })
    const original = structuredClone(business), normalized = normalizePayment(business)
    expect(normalized).toMatchObject({ title: 'Payment', reason: 'Reason' })
    expect(normalized.lines[0]).toMatchObject({ description: 'First invoice', invoiceAmount: '10000.00', previouslySettledAmount: '4000.00', allocationAmount: '4500.00', deductionAmount: '500.00', deductionReason: 'Quality deduction' })
    expect(normalized.lines[1]).toMatchObject({ previouslySettledAmount: '0.00', deductionAmount: '0.00' })
    expect(business).toEqual(original)
    expect(normalized).not.toBe(business); expect(normalized.lines).not.toBe(business.lines)
    expect([normalized, normalized.lines, ...normalized.lines].every(Object.isFrozen)).toBe(true)
    expect(() => { normalized.lines[0].allocationAmount = '0' }).toThrow()
    expect(normalizePayment(normalized)).toEqual(normalized)
  })
  it('writes exact numeric money literals and safely escapes ordinary strings', () => {
    const business = paymentFixture({ title: 'Quoted "payment"' })
    business.lines[0].description = 'Quoted "text" \\ newline\nvalue'
    const wire = serializePaymentPayload({ business, processVersion: 7 })
    for (const field of PAYMENT_AMOUNTS) expect(wire).not.toContain(`"${field}":"`)
    expect(wire).toContain('"invoiceAmount":10000.00')
    expect(wire).toContain('"previouslySettledAmount":0.00')
    expect(JSON.parse(wire)).toMatchObject({ business: { type: 'paymentRequest', title: business.title, lines: [{ description: business.lines[0].description, allocationAmount: 4500 }, { deductionAmount: 0 }] }, processVersion: 7 })
    expect(wire).not.toContain('"netTotal"')
    for (const processVersion of [0, -1, 1.1, '1', NaN, 2147483648]) expect(() => serializePaymentPayload({ business, processVersion })).toThrow('Invalid process version')
    expect(() => serializePaymentPayload({ business, processVersion: 1, total: '6500' })).toThrow('Invalid payment payload')
  })
  it('starts blank with independent stable generated identities', () => {
    let sequence = 0; const idFactory = () => String(++sequence)
    const first = emptyPayment(idFactory), line = emptyPaymentLine(idFactory)
    expect(first).toMatchObject({ type: 'paymentRequest', businessId: '', supplierRef: '', requestedPaymentOn: '', lines: [{ lineId: 'line-1', invoiceRef: '', invoiceAmount: '', previouslySettledAmount: '0', allocationAmount: '', deductionAmount: '0', deductionReason: '' }] })
    expect(line.lineId).toBe('line-2'); expect(paymentTotal(first)).toBeNull()
  })
})

describe('contract arithmetic, revision and temporal invariants', () => {
  it('uses its own identity, typed enums, declared total and balanced milestone summary', () => {
    expect(CONTRACT_ID).toBe('crm-contract'); expect(CONTRACT_CATEGORIES).toEqual(['PRODUCT', 'SERVICE']); expect(TERMS_KINDS).toEqual(['STANDARD', 'NONSTANDARD'])
    expect(Object.isFrozen(CONTRACT_CATEGORIES)).toBe(true); expect(Object.isFrozen(TERMS_KINDS)).toBe(true)
    expect(contractErrors(contractFixture())).toEqual([])
    expect(contractTotal(contractFixture())).toBe('100000.00')
    expect(contractSummary(contractFixture())).toEqual({ type: 'contractApproval', contractAmount: '100000.00', milestoneTotal: '100000.00', balance: '0.00' })
  })
  it.each(CURRENCIES)('supports currency %s', currency => expect(contractErrors(contractFixture({ currency }))).toEqual([]))
  it('adds 0.10 and 0.20 exactly and reports a one-cent over/under allocation', () => {
    const business = contractFixture({ contractAmount: '0.30' }); business.lines = business.lines.slice(0, 2)
    business.lines[0].amount = '0.10'; business.lines[1].amount = '0.20'
    expect(contractErrors(business)).toEqual([])
    expect(contractSummary(business)).toEqual({ type: 'contractApproval', contractAmount: '0.30', milestoneTotal: '0.30', balance: '0.00' })
    business.lines[1].amount = '0.19'
    expect(contractErrors(business)).toContain('reconciliation'); expect(contractSummary(business).balance).toBe('0.01')
    business.lines[1].amount = '0.21'
    expect(contractErrors(business)).toContain('reconciliation'); expect(contractSummary(business).balance).toBe('-0.01')
    expect(contractTotal(business)).toBe('0.30')
  })
  it('accepts twenty balanced lines at the total limit but rejects extra lines or amounts', () => {
    const business = contractFixture({ contractAmount: '1000000000' })
    business.lines = Array.from({ length: 20 }, (_, index) => ({ ...business.lines[0], lineId: `line-${index}`, milestoneRef: `M-${index}`, amount: '50000000' }))
    expect(contractErrors(business)).toEqual([])
    expect(contractSummary(business)).toMatchObject({ contractAmount: '1000000000.00', milestoneTotal: '1000000000.00', balance: '0.00' })
    business.lines[0].amount = '1000000000.01'; expect(contractErrors(business)).toContain('lines.0.amount')
    business.lines.forEach(line => { line.amount = '1000000000' })
    expect(contractSummary(business)).toMatchObject({ milestoneTotal: '20000000000.00', balance: '-19000000000.00' })
    expect(contractErrors(business)).toContain('reconciliation')
    business.lines.push({ ...business.lines[0], lineId: 'last', milestoneRef: 'last' }); expect(contractErrors(business)).toContain('lines')
    expect(contractSummary(business)).toBeNull()
    expect(contractErrors(contractFixture({ contractAmount: '1000000000.01' }))).toContain('contractAmount')
  })
  it('rejects fractional yen and normalizes whole-yen totals and balance', () => {
    const business = contractFixture({ currency: 'JPY' })
    expect(contractSummary(business)).toEqual({ type: 'contractApproval', contractAmount: '100000', milestoneTotal: '100000', balance: '0' })
    business.contractAmount = '100000.01'; expect(contractErrors(business)).toContain('contractAmount')
    business.contractAmount = '100000'; business.lines[0].amount = '30000.01'; expect(contractErrors(business)).toContain('lines.0.amount')
  })
  it.each(['', ' ', '-1', '+1', '1.0', '1e2', '1 2', ' 1', '1 ', 'NaN', '0'.repeat(17), '0', '2147483648', 0, -1, 1.1, NaN, Infinity, null, false, undefined])('rejects invalid revision %j without lossy coercion', value => {
    expect(contractRevision(value)).toBeNull()
    expect(contractErrors(contractFixture({ contractRevision: value }))).toContain('contractRevision')
  })
  it('normalizes raw integer text but strictly rejects response numeric strings', () => {
    for (const value of ['1', '0001', 1, '2147483647', 2147483647]) {
      const business = contractFixture({ contractRevision: value })
      expect(contractErrors(business)).toEqual([])
      expect(normalizeContract(business).contractRevision).toBe(Number(value))
      expect(contractServerErrors(business)).toEqual(typeof value === 'number' ? [] : ['contractRevision'])
    }
    expect(() => normalizeContractServer(contractFixture())).toThrow('Invalid contract document')
    expect(contractServerErrors(normalizeContract(contractFixture()))).toEqual([])
    expect(normalizeContractServer(normalizeContract(contractFixture()))).toEqual(normalizeContract(contractFixture()))
  })
  it('requires true dates, inclusive contract bounds and nondecreasing visible order', () => {
    const business = contractFixture()
    business.lines[0].dueOn = business.startOn; business.lines[2].dueOn = business.endOn
    expect(contractErrors(business)).toEqual([])
    business.lines[1].dueOn = business.lines[0].dueOn; expect(contractErrors(business)).toEqual([])
    business.lines[0].dueOn = '2098-12-31'; expect(contractErrors(business)).toContain('lines.0.dueOn')
    business.lines[0].dueOn = '2099-01-01'; business.lines[2].dueOn = '2100-01-01'; expect(contractErrors(business)).toContain('lines.2.dueOn')
    business.lines[2].dueOn = '2099-02-29'; expect(contractErrors(business)).toContain('lines.2.dueOn')
    const outOfOrder = contractFixture(); [outOfOrder.lines[0], outOfOrder.lines[1]] = [outOfOrder.lines[1], outOfOrder.lines[0]]
    expect(contractErrors(outOfOrder)).toContain('lines.1.dueOn')
    const leap = contractFixture({ startOn: '2000-02-29', endOn: '2000-02-29' }); leap.lines.forEach(line => { line.dueOn = '2000-02-29' })
    expect(contractErrors(leap)).toEqual([])
  })
  it('requires nonstandard explanations and rejects contradictory standard terms', () => {
    for (const reason of ['', ' \t', '\u00a0', null, 'x'.repeat(2001)]) expect(contractErrors(contractFixture({ deviationReason: reason }))).toContain('deviationReason')
    expect(contractErrors(contractFixture({ termsKind: 'STANDARD', deviationReason: '' }))).toEqual([])
    expect(contractErrors(contractFixture({ termsKind: 'STANDARD', deviationReason: ' \t\n' }))).toEqual([])
    expect(normalizeContract(contractFixture({ termsKind: 'STANDARD', deviationReason: ' \t\n' })).deviationReason).toBe('')
    expect(contractErrors(contractFixture({ termsKind: 'STANDARD' }))).toContain('deviationReason')
    expect(contractErrors(contractFixture({ deviationReason: 'x'.repeat(2000) }))).toEqual([])
  })
})

describe('contract strict document and payload contract', () => {
  it('rejects every unknown or missing document and milestone field', () => {
    for (const key of Object.keys(contractFixture())) {
      const business = contractFixture(); delete business[key]
      expect(contractErrors(business)).toEqual(['fields'])
      expect(contractServerErrors(business)).toEqual(['fields'])
    }
    for (const key of ['balance', 'milestoneTotal', 'approved', 'summary']) expect(contractErrors(contractFixture({ [key]: '0' }))).toEqual(['fields'])
    for (const key of Object.keys(contractFixture().lines[0])) {
      const business = contractFixture(); delete business.lines[0][key]
      expect(contractErrors(business)).toContain('lines.0.fields')
    }
    const business = contractFixture(); business.lines[0].currency = 'CNY'
    expect(contractErrors(business)).toContain('lines.0.fields')
  })
  it.each([
    ['type', 'expense'], ['documentVersion', 2], ['businessId', 'bad id'], ['title', ' '], ['title', 'x'.repeat(121)], ['reason', ''], ['reason', 'x'.repeat(2001)], ['customerRef', 'bad id'], ['documentRef', 'x'.repeat(129)], ['contractCategory', 'OTHER'], ['currency', 'BTC'], ['contractAmount', '0'], ['contractAmount', '-1'], ['contractAmount', '0.001'], ['contractAmount', 100000], ['startOn', '0000-01-01'], ['startOn', '2099-02-29'], ['endOn', '2098-12-31'], ['endOn', '2099-2-01'], ['termsKind', 'CUSTOM'], ['lines', []], ['lines', null],
  ])('rejects invalid contract root %s', (key, value) => expect(contractErrors(contractFixture({ [key]: value })).length).toBeGreaterThan(0))
  it.each([
    ['description', ''], ['description', 'x'.repeat(241)], ['acceptanceCriteria', ' '], ['acceptanceCriteria', 'x'.repeat(1001)], ['milestoneRef', 'bad id'], ['lineId', '_bad'], ['dueOn', '2099-01-15T00:00:00Z'], ['amount', '0'], ['amount', '-1'], ['amount', '0.001'], ['amount', 30000],
  ])('locates invalid milestone %s', (key, value) => {
    const business = contractFixture(); business.lines[0][key] = value
    expect(contractErrors(business)).toContain(`lines.0.${key}`)
  })
  it('rejects duplicate line and milestone references separately', () => {
    const business = contractFixture(); business.lines[1].lineId = business.lines[0].lineId; business.lines[1].milestoneRef = business.lines[0].milestoneRef
    expect(contractErrors(business)).toEqual(expect.arrayContaining(['lines.1.lineId', 'lines.1.milestoneRef']))
  })
  it('normalizes a fresh immutable snapshot without changing draft amounts, text or revision', () => {
    const business = contractFixture({ title: ' Contract \t', reason: '\n Review ', contractRevision: '0001', contractAmount: '00100000', deviationReason: ' Liability change \r' })
    Object.assign(business.lines[0], { description: ' Plan ', amount: '0030000.0', acceptanceCriteria: ' Confirm plan ' })
    const original = structuredClone(business), normalized = normalizeContract(business)
    expect(normalized).toMatchObject({ title: 'Contract', reason: 'Review', contractRevision: 1, contractAmount: '100000.00', deviationReason: 'Liability change' })
    expect(normalized.lines[0]).toMatchObject({ description: 'Plan', amount: '30000.00', acceptanceCriteria: 'Confirm plan' })
    expect(business).toEqual(original); expect(normalized).not.toBe(business); expect(normalized.lines).not.toBe(business.lines)
    expect([normalized, normalized.lines, ...normalized.lines].every(Object.isFrozen)).toBe(true)
    expect(() => { normalized.lines.push({}) }).toThrow()
    expect(normalizeContract(normalized)).toEqual(normalized)
    expect(() => normalizeContract({ ...business, contractAmount: '0.01' })).toThrow('Invalid contract document')
  })
  it('serializes exact numeric money literals plus an integer revision and escapes prose', () => {
    const business = contractFixture({ title: 'Quoted "contract"', deviationReason: 'Quote " and slash \\ and newline\n' })
    const wire = serializeContractPayload({ business, processVersion: 2147483647 })
    expect(wire).toContain('"contractAmount":100000.00'); expect(wire).toContain('"amount":30000.00'); expect(wire).toContain('"contractRevision":1')
    expect(wire).not.toContain('"amount":"'); expect(wire).not.toContain('"contractAmount":"'); expect(wire).not.toContain('"balance"')
    expect(JSON.parse(wire)).toMatchObject({ business: { type: 'contractApproval', contractRevision: 1, contractAmount: 100000, title: business.title, deviationReason: business.deviationReason.trim() }, processVersion: 2147483647 })
    for (const processVersion of [0, -1, 1.1, '1', NaN, 2147483648]) expect(() => serializeContractPayload({ business, processVersion })).toThrow('Invalid process version')
    expect(() => serializeContractPayload({ business, processVersion: 1, balance: 0 })).toThrow('Invalid contract payload')
  })
  it('starts with raw revision text and independently generated milestone identities', () => {
    let sequence = 0; const idFactory = () => String(++sequence)
    const first = emptyContract(idFactory), line = emptyContractLine(idFactory)
    expect(first).toMatchObject({ type: 'contractApproval', businessId: '', contractRevision: '1', contractAmount: '', termsKind: 'STANDARD', deviationReason: '', lines: [{ lineId: 'line-1', milestoneRef: '', amount: '', acceptanceCriteria: '' }] })
    expect(line.lineId).toBe('line-2'); expect(contractTotal(first)).toBeNull(); expect(contractSummary(first)).toBeNull()
  })
})

describe('concrete bilingual invariant messages', () => {
  it('matches the backend Unicode blank set and rejects sparse line collections', () => {
    for (const blank of ['\u0085', '\u0000\u00a0', '\u2007\u202f', '\u3000\ufeff']) {
      expect(paymentErrors(paymentFixture({ title: blank }))).toContain('title')
      const payment = paymentFixture(); payment.lines[0].deductionReason = blank
      expect(paymentErrors(payment)).toContain('lines.0.deductionReason')
      expect(contractErrors(contractFixture({ reason: blank }))).toContain('reason')
      const contract = contractFixture(); contract.lines[0].acceptanceCriteria = blank
      expect(contractErrors(contract)).toContain('lines.0.acceptanceCriteria')
    }
    const payment = paymentFixture(); delete payment.lines[1]
    expect(paymentErrors(payment)).toContain('lines.1.fields')
    const contract = contractFixture(); contract.lines[0].amount = contract.contractAmount; delete contract.lines[1]; delete contract.lines[2]
    expect(contractErrors(contract)).toEqual(expect.arrayContaining(['lines.1.fields', 'lines.2.fields']))
  })
  it('explains each payment relationship in both languages', () => {
    expect(paymentErrorText('lines.0.previouslySettledAmount', 'en')).toContain('invoice amount')
    expect(paymentErrorText('lines.0.allocationAmount', 'en')).toContain('minus settled')
    expect(paymentErrorText('lines.0.deductionAmount', 'en')).toContain('allocation amount')
    expect(paymentErrorText('lines.0.deductionReason', 'zh')).toContain('扣减大于 0')
    expect(paymentErrorText('netTotal', 'zh')).toContain('净申请总额')
    for (const path of ['fields', 'type', 'businessId', 'title', 'reason', 'currency', 'supplierRef', 'requestedPaymentOn', 'lines', 'lines.0.lineId', 'lines.0.invoiceRef', 'lines.0.description', ...PAYMENT_AMOUNTS.map(key => `lines.0.${key}`), 'lines.0.deductionReason', 'netTotal']) {
      expect(paymentErrorText(path, 'en')).toMatch(/[A-Za-z]/); expect(paymentErrorText(path, 'zh')).toMatch(/[\u4e00-\u9fff]/)
    }
  })
  it('explains contract reconciliation, date order and contradictory terms', () => {
    expect(contractErrorText('reconciliation', 'en')).toContain('exactly')
    expect(contractErrorText('lines.1.dueOn', 'en')).toContain('nondecreasing')
    expect(contractErrorText('deviationReason', 'en')).toContain('Standard terms must leave this empty')
    for (const path of ['fields', 'type', 'businessId', 'title', 'reason', 'customerRef', 'contractRevision', 'contractCategory', 'currency', 'contractAmount', 'startOn', 'endOn', 'termsKind', 'deviationReason', 'documentRef', 'lines', 'lines.0.lineId', 'lines.0.milestoneRef', 'lines.0.description', 'lines.0.amount', 'lines.0.dueOn', 'lines.0.acceptanceCriteria', 'reconciliation']) {
      expect(contractErrorText(path, 'en')).toMatch(/[A-Za-z]/); expect(contractErrorText(path, 'zh')).toMatch(/[\u4e00-\u9fff]/)
    }
  })
})
