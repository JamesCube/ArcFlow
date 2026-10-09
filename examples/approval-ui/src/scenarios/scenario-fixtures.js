// Synthetic, credential-free fixtures shared by the scenario unit tests.
export const clone = value => structuredClone(value)
export const people = [{ id: 'alice', name: 'Alice' }, { id: 'bob', name: 'Bob' }, { id: 'carol', name: 'Carol' }]
export const translated = (en, zh = en) => ({ en, zh })
const field = (path, kind, maxLength = 0, values = []) => ({ path, kind, label: translated(path), required: true, maxLength, options: values.map(value => ({ value, label: translated(value) })) })
export function catalogFixture() {
  return [{
    id: 'oa-expense', domain: 'OA', documentType: 'expense', documentVersion: 1, formVersion: 1,
    title: translated('Expense reimbursement', '费用报销'), description: translated('Submit itemized expenses for approval.', '提交费用明细并发起审批。'),
    sections: [{ id: 'expense-details', title: translated('Expense details', '报销信息'), fields: [
      field('businessId', 'text', 128), field('title', 'text', 120), field('reason', 'textarea', 2000),
      field('costCenter', 'select', 0, ['SALES', 'ENGINEERING', 'OPERATIONS']),
      field('currency', 'select', 0, ['CNY', 'USD', 'EUR', 'GBP', 'JPY']),
    ] }],
    lineItems: { path: 'lines', label: translated('Expense lines', '费用明细'), minItems: 1, maxItems: 20, fields: [
      field('spentOn', 'date'), field('category', 'select', 0, ['TRAVEL', 'MEALS', 'OFFICE', 'OTHER']),
      field('description', 'text', 240), field('amount', 'money'), field('receiptRef', 'text', 128),
    ] },
  }, receivingCatalogFixture()]
}
export function expenseFixture(overrides = {}) {
  return { type: 'expense', documentVersion: 1, businessId: 'EXP-2026-001', title: 'Client visit expenses', reason: 'Synthetic expense fixture; no personal information.', costCenter: 'ENGINEERING', currency: 'CNY', lines: [
    { lineId: 'line-1', spentOn: '2026-10-07', category: 'TRAVEL', description: 'Train ticket', amount: '123.45', receiptRef: 'receipt-1' },
    { lineId: 'line-2', spentOn: '2026-10-07', category: 'MEALS', description: 'Working lunch', amount: '26.55', receiptRef: 'receipt-2' },
  ], ...overrides }
}
export function processFixture(overrides = {}) {
  return { schemaVersion: 2, id: 'oa-expense', version: 1, name: 'Expense approval', nodes: [
    { id: 'start', type: 'start', name: 'Submit expense', assigneeId: null },
    { id: 'manager', type: 'approval', name: 'Manager review', assigneeId: 'bob' },
    { id: 'finance', type: 'approval', name: 'Finance review', assigneeId: 'carol' },
    { id: 'end', type: 'end', name: 'Complete', assigneeId: null },
  ], ...overrides }
}
export const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
export function viewFixture(overrides = {}) {
  const business = expenseFixture(), definition = processFixture(), at = '2026-10-07T09:00:00.000Z'
  return { request: {
    id: 'expense-1', title: business.title, reason: business.reason, days: 0,
    applicantId: 'alice', approverId: 'bob', status: 'PENDING', createdAt: at, updatedAt: at,
    decision: null, comment: null, processId: 'oa-expense', processVersion: definition.version,
    definition, currentStepId: 'manager', history: [{ actorId: 'alice', action: 'SUBMIT', at, stepId: null, comment: '' }], business,
    ...overrides,
  }, total: '150.00' }
}
// Independent transition fixture: no production process/response helpers used.
export function decidedFixture(original, actor = 'bob', decision = 'APPROVE', comment = 'Reviewed') {
  const view = clone(original), item = view.request, steps = item.definition.nodes.slice(1, -1)
  const index = steps.findIndex(step => step.id === item.currentStepId), current = steps[index]
  const members = node => node.type === 'approval' ? [node.assigneeId] : node.assigneeIds
  const at = new Date(Date.parse(item.updatedAt) + 60_000).toISOString()
  item.history.push({ actorId: actor, action: decision, at, stepId: current.id, comment })
  item.updatedAt = at; item.decision = decision; item.comment = comment
  const votes = item.history.filter(event => event.stepId === current.id)
  const all = current.type === 'approval' || current.completionMode === 'ALL'
  const passed = all ? votes.length === members(current).length && votes.every(event => event.action === 'APPROVE') : votes.some(event => event.action === 'APPROVE')
  const failed = all ? votes.some(event => event.action === 'REJECT') : votes.length === members(current).length && votes.every(event => event.action === 'REJECT')
  if (failed || passed && index === steps.length - 1) {
    item.status = failed ? 'REJECTED' : 'APPROVED'; item.currentStepId = null; item.approverId = actor
  } else if (passed) {
    item.currentStepId = steps[index + 1].id; item.approverId = members(steps[index + 1])[0]
  } else item.approverId = members(current).find(member => !votes.some(event => event.actorId === member))
  return view
}

export function receivingCatalogFixture() {
  return { id: 'erp-receiving', domain: 'ERP', documentType: 'receiving', documentVersion: 1, formVersion: 1,
    title: translated('Purchase order receiving', '采购收货验收'), description: translated('Reconcile received, accepted and rejected quantities before approval.', '核对实收、合格与不合格数量，再提交审批。'),
    sections: [{ id: 'receiving-details', title: translated('Receiving details', '收货信息'), fields: [
      field('businessId', 'text', 128), field('title', 'text', 120), field('reason', 'textarea', 2000), field('purchaseOrderRef', 'text', 128), field('warehouse', 'select', 0, ['EAST', 'WEST']), field('receivedOn', 'date'),
    ] }],
    lineItems: { path: 'lines', label: translated('Receiving lines', '收货明细'), minItems: 1, maxItems: 20, fields: [
      field('orderLineRef', 'text', 128), field('description', 'text', 240), field('unit', 'select', 0, ['PCS', 'BOX']),
      ...['ordered', 'received', 'accepted', 'rejected'].map(path => field(path, 'quantity')),
      { ...field('exceptionReason', 'textarea', 1000), required: false },
    ] },
  }
}
export function receivingFixture(overrides = {}) {
  return { type: 'receiving', documentVersion: 1, businessId: 'GRN-DEMO-001', title: 'Workshop supply delivery', reason: 'Synthetic goods receipt for a sample purchase order.', purchaseOrderRef: 'PO-DEMO-001', warehouse: 'EAST', receivedOn: '2026-10-08', lines: [
    { lineId: 'receiving-line-1', orderLineRef: 'PO-DEMO-001-10', description: 'Mounting brackets', unit: 'PCS', ordered: 100, received: 80, accepted: 78, rejected: 2, exceptionReason: 'Two bent brackets' },
    { lineId: 'receiving-line-2', orderLineRef: 'PO-DEMO-001-20', description: 'Protective packaging', unit: 'BOX', ordered: 10, received: 10, accepted: 10, rejected: 0, exceptionReason: '' },
  ], ...overrides }
}
export function receivingProcessFixture(overrides = {}) {
  return { schemaVersion: 3, id: 'erp-receiving', version: 1, name: 'Receiving approval', nodes: [
    { id: 'start', type: 'start', name: 'Submit receiving', assigneeId: null },
    { id: 'receiving-inspection', type: 'parallelApproval', name: 'Warehouse and quality inspection', assigneeId: null, assigneeIds: ['bob', 'carol'], completionMode: 'ALL' },
    { id: 'procurement-review', type: 'approval', name: 'Procurement review (Bob)', assigneeId: 'bob' },
    { id: 'end', type: 'end', name: 'Complete', assigneeId: null },
  ], ...overrides }
}
export function receivingViewFixture(overrides = {}) {
  const business = receivingFixture(), definition = receivingProcessFixture()
  const view = viewFixture({ id: 'receiving-1', title: business.title, reason: business.reason, business, definition, processId: 'erp-receiving', currentStepId: 'receiving-inspection', ...overrides })
  return { ...view, total: null, summary: { kind: 'receiving', lineCount: 2, exceptionLineCount: 1, quantities: [ { unit: 'PCS', received: 80, accepted: 78, rejected: 2 }, { unit: 'BOX', received: 10, accepted: 10, rejected: 0 } ] } }
}
