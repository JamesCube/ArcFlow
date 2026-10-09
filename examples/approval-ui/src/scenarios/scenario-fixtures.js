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
  }, travelTemplateFixture(), sealTemplateFixture(), receivingCatalogFixture(), paymentTemplateFixture(), contractTemplateFixture()]
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

export function travelTemplateFixture() {
  return {
    id: 'oa-travel', domain: 'OA', documentType: 'travel', documentVersion: 1, formVersion: 1,
    title: translated('Business travel review', '出差申请审批'), description: translated('Synthetic itinerary and budget. Approval does not book travel, reimburse expenses or issue a payment.', '合成行程与预算，审批通过不会预订、报销或付款。'),
    sections: [
      { id: 'identity', title: translated('Request details', '申请信息'), fields: [field('businessId', 'text', 128), field('title', 'text', 120), field('costCenter', 'select', 0, ['ENGINEERING', 'SALES', 'OPERATIONS']), field('currency', 'select', 0, ['CNY', 'USD', 'EUR', 'GBP', 'JPY'])] },
      { id: 'itinerary', title: translated('Itinerary and budget', '行程与预算'), fields: [field('destination', 'text', 160), field('startDate', 'date', 10), field('endDate', 'date', 10), field('purpose', 'select', 0, ['CUSTOMER_VISIT', 'PROJECT_DELIVERY', 'TRAINING', 'CONFERENCE', 'OTHER']), field('estimatedCost', 'money')] },
      { id: 'reason', title: translated('Business purpose', '出差事由'), fields: [field('reason', 'textarea', 2000)] },
    ], lineItems: null,
  }
}
export function travelFixture(overrides = {}) {
  return { type: 'travel', documentVersion: 1, businessId: 'TRIP-2026-001', title: 'Synthetic project delivery', reason: 'Synthetic itinerary for testing only.', destination: 'Shanghai', startDate: '2026-10-12', endDate: '2026-10-14', purpose: 'PROJECT_DELIVERY', estimatedCost: '2800.00', currency: 'CNY', costCenter: 'ENGINEERING', ...overrides }
}
export function travelProcessFixture(overrides = {}) {
  return { schemaVersion: 2, id: 'oa-travel', version: 1, name: 'Business travel review', nodes: [
    { id: 'start', type: 'start', name: 'Submit travel request', assigneeId: null },
    { id: 'tripReview', type: 'approval', name: 'Trip review', assigneeId: 'bob' },
    { id: 'budget', type: 'approval', name: 'Budget review', assigneeId: 'carol' },
    { id: 'end', type: 'end', name: 'Complete', assigneeId: null },
  ], ...overrides }
}
export function travelViewFixture(overrides = {}) {
  const business = travelFixture(), definition = travelProcessFixture()
  const view = viewFixture({ id: 'travel-1', title: business.title, reason: business.reason, processId: 'oa-travel', definition, currentStepId: 'tripReview', business, ...overrides })
  return { ...view, total: business.estimatedCost }
}

export function sealTemplateFixture() {
  return {
    id: 'oa-seal-use', domain: 'OA', documentType: 'sealUse', documentVersion: 1, formVersion: 1,
    title: translated('Seal-use request (synthetic example)', '用印申请（合成示例）'),
    description: translated('Review a synthetic document and proposed seal use.', '审核合成文件与拟定用印用途。'),
    sections: [
      { id: 'identity', title: translated('Request identity', '申请信息'), fields: [field('businessId', 'text', 128), field('title', 'text', 120)] },
      { id: 'document', title: translated('Document and seal', '文件与印章'), fields: [field('documentName', 'text', 160), field('documentRef', 'text', 128), { ...field('sealType', 'select', 0, ['OFFICIAL', 'CONTRACT', 'FINANCE']), options: ['OFFICIAL', 'CONTRACT', 'FINANCE'].map(value => ({ value, label: translated(`Synthetic ${value.toLowerCase()} seal`, `合成示例${value}`) })) }, field('copyCount', 'integer', 16)] },
      { id: 'purpose', title: translated('Purpose', '用途'), fields: [{ ...field('reason', 'textarea', 2000), label: translated('Business purpose', '用途说明') }] },
    ], lineItems: null,
  }
}
export function sealFixture(overrides = {}) {
  return { type: 'sealUse', documentVersion: 1, businessId: 'SEAL-DEMO-001', title: 'Synthetic delivery document review', reason: 'Synthetic review only; no physical seal use.', documentName: 'Synthetic project handover', documentRef: 'DEMO-DOC-001', sealType: 'OFFICIAL', copyCount: 2, ...overrides }
}
export function sealProcessFixture(overrides = {}) {
  return { schemaVersion: 2, id: 'oa-seal-use', version: 1, name: 'Seal-use review', nodes: [
    { id: 'start', type: 'start', name: 'Submit seal-use request', assigneeId: null },
    { id: 'documentReview', type: 'approval', name: 'Document review', assigneeId: 'bob' },
    { id: 'sealReview', type: 'approval', name: 'Seal-use review', assigneeId: 'carol' },
    { id: 'end', type: 'end', name: 'Review complete', assigneeId: null },
  ], ...overrides }
}
export function sealViewFixture(overrides = {}) {
  const business = sealFixture(), definition = sealProcessFixture()
  const view = viewFixture({ id: 'seal-1', title: business.title, reason: business.reason, business, definition, processId: definition.id, currentStepId: 'documentReview', ...overrides })
  return { ...view, total: null }
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

const labelled = (path, kind, en, zh, length = 0, values = []) => ({ ...field(path, kind, length, values), label: translated(en, zh) })
export function paymentTemplateFixture() {
  return { id: 'erp-payment', domain: 'ERP', documentType: 'paymentRequest', documentVersion: 1, formVersion: 1,
    title: translated('Payment request', '付款申请'), description: translated('Reconcile synthetic invoice allocations and deductions for human review.', '核对合成发票分配与扣减，提交人工审批。'),
    sections: [{ id: 'payment-details', title: translated('Payment request details', '付款申请信息'), fields: [
      labelled('businessId', 'text', 'Request reference', '申请编号', 128), labelled('title', 'text', 'Title', '申请标题', 120), labelled('reason', 'textarea', 'Business purpose', '申请事由', 2000), labelled('supplierRef', 'text', 'Synthetic supplier reference', '合成供应商编号', 128), labelled('currency', 'select', 'Currency', '币种', 0, ['CNY', 'USD', 'EUR', 'GBP', 'JPY']), labelled('requestedPaymentOn', 'date', 'Requested payment date', '申请付款日', 10),
    ] }], lineItems: { path: 'lines', label: translated('Invoice allocation', '发票分配明细'), minItems: 1, maxItems: 20, fields: [
      labelled('invoiceRef', 'text', 'Invoice reference', '发票编号', 128), labelled('description', 'text', 'Description', '明细说明', 240), labelled('invoiceAmount', 'money', 'Invoice amount', '发票金额'), labelled('previouslySettledAmount', 'money', 'Previously settled', '声明已结金额'), labelled('allocationAmount', 'money', 'Allocation', '本次分配'), labelled('deductionAmount', 'money', 'Deduction', '本次扣减'), { ...labelled('deductionReason', 'textarea', 'Deduction reason', '扣减说明', 1000), required: false },
    ] },
  }
}
export function contractTemplateFixture() {
  return { id: 'crm-contract', domain: 'CRM', documentType: 'contractApproval', documentVersion: 1, formVersion: 1,
    title: translated('Contract approval', '合同审批'), description: translated('Review synthetic terms and a conserved milestone schedule.', '审核合成合同条款与金额守恒的里程碑。'),
    sections: [ { id: 'contract-details', title: translated('Contract dossier', '合同信息'), fields: [
      labelled('businessId', 'text', 'Request reference', '申请编号', 128), labelled('title', 'text', 'Title', '合同标题', 120), labelled('customerRef', 'text', 'Synthetic customer reference', '合成客户编号', 128), labelled('contractRevision', 'integer', 'Contract revision', '合同修订', 16), labelled('contractCategory', 'select', 'Contract category', '合同类别', 0, ['PRODUCT', 'SERVICE']), labelled('documentRef', 'text', 'Synthetic document reference', '合成文件编号', 128),
    ] }, { id: 'contract-term', title: translated('Term and value', '期限与金额'), fields: [labelled('currency', 'select', 'Currency', '币种', 0, ['CNY', 'USD', 'EUR', 'GBP', 'JPY']), labelled('contractAmount', 'money', 'Contract amount', '合同金额'), labelled('startOn', 'date', 'Start date', '开始日期', 10), labelled('endOn', 'date', 'End date', '结束日期', 10)] }, { id: 'contract-terms', title: translated('Terms for review', '条款审核'), fields: [labelled('termsKind', 'select', 'Terms kind', '条款类型', 0, ['STANDARD', 'NONSTANDARD']), { ...labelled('deviationReason', 'textarea', 'Deviation reason', '非标说明', 2000), required: false }, labelled('reason', 'textarea', 'Business purpose', '申请事由', 2000)] } ],
    lineItems: { path: 'lines', label: translated('Delivery milestones', '交付里程碑'), minItems: 1, maxItems: 20, fields: [labelled('milestoneRef', 'text', 'Milestone reference', '里程碑编号', 128), labelled('description', 'text', 'Description', '里程碑说明', 240), labelled('dueOn', 'date', 'Due date', '到期日', 10), labelled('amount', 'money', 'Milestone amount', '里程碑金额'), labelled('acceptanceCriteria', 'textarea', 'Acceptance criteria', '验收标准', 1000)] },
  }
}
export function paymentFixture(overrides = {}) {
  return { type: 'paymentRequest', documentVersion: 1, businessId: 'PAY-DEMO-001', title: 'Synthetic supplier invoice allocation', reason: 'Synthetic request only; no payment execution.', supplierRef: 'SUPPLIER-DEMO-A', currency: 'CNY', requestedPaymentOn: '2099-01-15', lines: [
    { lineId: 'payment-line-1', invoiceRef: 'INV-DEMO-01', description: 'Workshop components', invoiceAmount: '10000.00', previouslySettledAmount: '4000.00', allocationAmount: '4500.00', deductionAmount: '500.00', deductionReason: 'Synthetic quality deduction' },
    { lineId: 'payment-line-2', invoiceRef: 'INV-DEMO-02', description: 'Delivery supplies', invoiceAmount: '4000.00', previouslySettledAmount: '0.00', allocationAmount: '2500.00', deductionAmount: '0.00', deductionReason: '' },
  ], ...overrides }
}
export function contractFixture(overrides = {}) {
  return { type: 'contractApproval', documentVersion: 1, businessId: 'CONTRACT-DEMO-001', title: 'Synthetic project delivery contract', reason: 'Synthetic internal review only.', customerRef: 'CUSTOMER-DEMO-A', contractRevision: 1, contractCategory: 'SERVICE', currency: 'CNY', contractAmount: '100000.00', startOn: '2099-01-01', endOn: '2099-12-31', termsKind: 'NONSTANDARD', deviationReason: 'Synthetic limitation of liability deviation; manual review required.', documentRef: 'DOC-CONTRACT-DEMO-01', lines: [
    { lineId: 'contract-line-1', milestoneRef: 'M1', description: 'Proposal delivery', dueOn: '2099-01-15', amount: '30000.00', acceptanceCriteria: 'Proposal delivered and manually confirmed' },
    { lineId: 'contract-line-2', milestoneRef: 'M2', description: 'Interim delivery', dueOn: '2099-06-30', amount: '40000.00', acceptanceCriteria: 'Interim deliverables accepted' },
    { lineId: 'contract-line-3', milestoneRef: 'M3', description: 'Final delivery', dueOn: '2099-12-15', amount: '30000.00', acceptanceCriteria: 'Final deliverables accepted' },
  ], ...overrides }
}
export function complexProcessFixture(id = 'erp-payment', overrides = {}) {
  const payment = id === 'erp-payment'
  return { schemaVersion: 3, id, version: 1, name: payment ? 'Payment request review' : 'Contract internal review', nodes: [
    { id: 'start', type: 'start', name: 'Submit for review', assigneeId: null },
    ...(payment ? [{ id: 'payment-check', type: 'parallelApproval', name: 'Joint payment check', assigneeId: null, assigneeIds: ['bob', 'carol'], completionMode: 'ALL' }, { id: 'payment-final', type: 'parallelApproval', name: 'Final payment review', assigneeId: null, assigneeIds: ['bob', 'carol'], completionMode: 'ANY' }]
      : [{ id: 'commercial-review', type: 'approval', name: 'Commercial review', assigneeId: 'bob' }, { id: 'contract-review', type: 'parallelApproval', name: 'Joint contract review', assigneeId: null, assigneeIds: ['bob', 'carol'], completionMode: 'ALL' }]),
    { id: 'end', type: 'end', name: 'Review complete', assigneeId: null },
  ], ...overrides }
}
export function paymentViewFixture(overrides = {}) {
  const business = paymentFixture(), definition = complexProcessFixture()
  const view = viewFixture({ id: 'payment-1', title: business.title, reason: business.reason, business, definition, processId: definition.id, currentStepId: 'payment-check', ...overrides })
  return { ...view, total: '6500.00', paymentSummary: { type: 'paymentRequest', declaredOutstanding: '10000.00', grossAllocation: '7000.00', deductionTotal: '500.00', netTotal: '6500.00' } }
}
export function contractViewFixture(overrides = {}) {
  const business = contractFixture(), definition = complexProcessFixture('crm-contract')
  const view = viewFixture({ id: 'contract-1', title: business.title, reason: business.reason, business, definition, processId: definition.id, currentStepId: 'commercial-review', ...overrides })
  return { ...view, total: '100000.00' }
}
