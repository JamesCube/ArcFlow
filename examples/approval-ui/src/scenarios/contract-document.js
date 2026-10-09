import { amountCents, CURRENCIES, decimal, exactKeys, reference, serverTrim, validDate } from './expense-document.js'

export const CONTRACT_ID = 'crm-contract'
export const CONTRACT_CATEGORIES = Object.freeze(['PRODUCT', 'SERVICE'])
export const TERMS_KINDS = Object.freeze(['STANDARD', 'NONSTANDARD'])
const FIELDS = Object.freeze(['type', 'documentVersion', 'businessId', 'title', 'reason', 'customerRef', 'contractRevision', 'contractCategory', 'currency', 'contractAmount', 'startOn', 'endOn', 'termsKind', 'deviationReason', 'documentRef', 'lines'])
const LINE_FIELDS = Object.freeze(['lineId', 'milestoneRef', 'description', 'dueOn', 'amount', 'acceptanceCriteria'])
const text = (value, max) => typeof value === 'string' && !/^[\u0000-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]*$/.test(value) && value.length <= max

export function contractRevision(value) {
  if (typeof value === 'string' && (value.length > 16 || !/^\d+$/.test(value))) return null
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 2147483647 ? parsed : null
}

export function contractErrors(business) {
  if (!exactKeys(business, FIELDS)) return ['fields']
  const errors = []
  if (business.type !== 'contractApproval' || business.documentVersion !== 1) errors.push('type')
  for (const key of ['businessId', 'customerRef', 'documentRef']) if (!reference(business[key])) errors.push(key)
  if (!text(business.title, 120)) errors.push('title')
  if (!text(business.reason, 2000)) errors.push('reason')
  if (contractRevision(business.contractRevision) === null) errors.push('contractRevision')
  if (!CONTRACT_CATEGORIES.includes(business.contractCategory)) errors.push('contractCategory')
  if (!CURRENCIES.includes(business.currency)) errors.push('currency')
  const contract = amountCents(business.contractAmount, business.currency)
  if (contract === null) errors.push('contractAmount')
  const startValid = validDate(business.startOn), endValid = validDate(business.endOn)
  if (!startValid) errors.push('startOn')
  if (!endValid || startValid && business.endOn < business.startOn) errors.push('endOn')
  if (!TERMS_KINDS.includes(business.termsKind)) errors.push('termsKind')
  if (typeof business.deviationReason !== 'string' || business.deviationReason.length > 2000 ||
      business.termsKind === 'NONSTANDARD' && !text(business.deviationReason, 2000) ||
      business.termsKind === 'STANDARD' && typeof business.deviationReason === 'string' && serverTrim(business.deviationReason) !== '') errors.push('deviationReason')
  if (!Array.isArray(business.lines) || business.lines.length < 1 || business.lines.length > 20) return [...errors, 'lines']
  const ids = new Set(), milestones = new Set()
  let sum = 0n, amountsValid = true, previousDate = null
  Array.from(business.lines).forEach((line, index) => {
    const prefix = `lines.${index}.`
    if (!exactKeys(line, LINE_FIELDS)) { errors.push(prefix + 'fields'); amountsValid = false; return }
    if (!reference(line.lineId) || ids.has(line.lineId)) errors.push(prefix + 'lineId'); ids.add(line.lineId)
    if (!reference(line.milestoneRef) || milestones.has(line.milestoneRef)) errors.push(prefix + 'milestoneRef'); milestones.add(line.milestoneRef)
    if (!text(line.description, 240)) errors.push(prefix + 'description')
    const dueValid = validDate(line.dueOn)
    if (!dueValid || startValid && line.dueOn < business.startOn || endValid && line.dueOn > business.endOn || previousDate !== null && line.dueOn < previousDate) errors.push(prefix + 'dueOn')
    if (dueValid) previousDate = line.dueOn
    const amount = amountCents(line.amount, business.currency)
    if (amount === null) { errors.push(prefix + 'amount'); amountsValid = false } else sum += amount
    if (!text(line.acceptanceCriteria, 1000)) errors.push(prefix + 'acceptanceCriteria')
  })
  if (amountsValid && contract !== null && sum !== contract) errors.push('reconciliation')
  return [...new Set(errors)]
}

// Editable revisions may be digit strings. A response snapshot must already
// contain the typed integer, just as the HTTP schema requires.
export function contractServerErrors(business) {
  const errors = contractErrors(business)
  if (errors.includes('fields')) return errors
  return typeof business.contractRevision === 'number' ? errors : [...new Set([...errors, 'contractRevision'])]
}

export const contractTotal = business => {
  const cents = amountCents(business?.contractAmount, business?.currency)
  return cents === null ? null : decimal(cents, business.currency)
}
export function contractSummary(business) {
  const contract = amountCents(business?.contractAmount, business?.currency)
  if (contract === null || !Array.isArray(business?.lines) || business.lines.length < 1 || business.lines.length > 20) return null
  let sum = 0n
  for (const line of business.lines) {
    const amount = amountCents(line?.amount, business.currency)
    if (amount === null) return null
    sum += amount
  }
  const balance = contract - sum
  return Object.freeze({ type: 'contractApproval', contractAmount: decimal(contract, business.currency), milestoneTotal: decimal(sum, business.currency), balance: `${balance < 0n ? '-' : ''}${decimal(balance < 0n ? -balance : balance, business.currency)}` })
}

export function normalizeContract(business) {
  if (contractErrors(business).length) throw new Error('Invalid contract document')
  return Object.freeze({ ...business, title: serverTrim(business.title), reason: serverTrim(business.reason), contractRevision: contractRevision(business.contractRevision), contractAmount: contractTotal(business), deviationReason: serverTrim(business.deviationReason), lines: Object.freeze(business.lines.map(line => Object.freeze({ ...line, description: serverTrim(line.description), amount: decimal(amountCents(line.amount, business.currency), business.currency), acceptanceCriteria: serverTrim(line.acceptanceCriteria) }))) })
}
export function normalizeContractServer(business) {
  if (contractServerErrors(business).length) throw new Error('Invalid contract document')
  return normalizeContract(business)
}

export function serializeContractPayload(payload) {
  if (!exactKeys(payload, ['business', 'processVersion'])) throw new Error('Invalid contract payload')
  const business = normalizeContract(payload.business)
  if (!Number.isInteger(payload.processVersion) || payload.processVersion < 1 || payload.processVersion > 2147483647) throw new Error('Invalid process version')
  const lines = business.lines.map(line => `{${Object.entries(line).map(([key, value]) => `${JSON.stringify(key)}:${key === 'amount' ? value : JSON.stringify(value)}`).join(',')}}`)
  return `{"business":{${Object.entries(business).map(([key, value]) => `${JSON.stringify(key)}:${key === 'lines' ? `[${lines.join(',')}]` : key === 'contractAmount' ? value : JSON.stringify(value)}`).join(',')}},"processVersion":${payload.processVersion}}`
}

export const emptyContractLine = idFactory => ({ lineId: `line-${idFactory()}`, milestoneRef: '', description: '', dueOn: '', amount: '', acceptanceCriteria: '' })
export const emptyContract = idFactory => ({ type: 'contractApproval', documentVersion: 1, businessId: '', title: '', reason: '', customerRef: '', contractRevision: '1', contractCategory: 'SERVICE', currency: 'CNY', contractAmount: '', startOn: '', endOn: '', termsKind: 'STANDARD', deviationReason: '', documentRef: '', lines: [emptyContractLine(idFactory)] })

const REFERENCE_EN = 'Use 1–128 ASCII letters, digits or . _ : / -; start with a letter or digit.'
const REFERENCE_ZH = '请输入 1–128 位字母、数字或 . _ : / -，以字母或数字开头。'
const AMOUNT_EN = 'Enter an amount above 0 and at most 1,000,000,000, with up to 2 decimals; JPY must be whole yen.'
const AMOUNT_ZH = '金额须大于 0 且不超过 1,000,000,000，最多两位小数；日元须为整数。'
const ERROR_TEXT = Object.freeze({
  fields: ['Only the documented contract fields are allowed; all fields are required.', '合同审批只能包含约定字段，且字段不可缺失。'],
  type: ['Use a contract approval with document version 1.', '合同审批类型与单据版本 1 必须匹配。'],
  businessId: [REFERENCE_EN, REFERENCE_ZH], customerRef: [REFERENCE_EN, REFERENCE_ZH], documentRef: [REFERENCE_EN, REFERENCE_ZH],
  title: ['Enter a title, up to 120 characters.', '请填写标题，最多 120 字。'],
  reason: ['Enter the contract approval purpose, up to 2,000 characters.', '请填写合同审批事由，最多 2,000 字。'],
  contractRevision: ['Enter a whole-number revision from 1 to 2,147,483,647; no fractions, signs or exponents.', '合同修订号须为 1–2,147,483,647 的整数，不接受小数、正负号或指数。'],
  contractCategory: ['Choose PRODUCT or SERVICE.', '请选择产品或服务合同。'],
  currency: ['Choose CNY, USD, EUR, GBP or JPY.', '请选择 CNY、USD、EUR、GBP 或 JPY。'],
  contractAmount: [AMOUNT_EN, AMOUNT_ZH], amount: [AMOUNT_EN, AMOUNT_ZH],
  startOn: ['Enter a real contract start date in YYYY-MM-DD format.', '请输入真实有效的合同开始日期，格式为 YYYY-MM-DD。'],
  endOn: ['Enter a real contract end date on or after the start date.', '请输入真实有效的合同结束日期，不能早于开始日期。'],
  termsKind: ['Choose STANDARD or NONSTANDARD terms.', '请选择标准或非标条款。'],
  deviationReason: ['Nonstandard terms require a deviation reason, up to 2,000 characters. Standard terms must leave this empty.', '非标条款必须填写差异说明，最多 2,000 字；标准条款必须留空。'],
  lines: ['Include 1–20 payment milestones.', '请填写 1–20 个付款里程碑。'],
  lineId: ['Each line needs a unique reference. ' + REFERENCE_EN, '每行编号必须唯一。' + REFERENCE_ZH],
  milestoneRef: ['Each milestone reference must be unique in this request. ' + REFERENCE_EN, '同一申请内里程碑引用不可重复。' + REFERENCE_ZH],
  description: ['Describe this milestone, up to 240 characters.', '请填写里程碑说明，最多 240 字。'],
  dueOn: ['Enter a real date inside the contract term. Milestone dates must stay in nondecreasing display order; the same date is allowed.', '里程碑日期须真实有效且在合同期限内，并按展示顺序不递减；允许同日多个里程碑。'],
  acceptanceCriteria: ['Enter the delivery or acceptance criteria, up to 1,000 characters.', '请填写交付或验收条件，最多 1,000 字。'],
  reconciliation: ['Milestone amounts must add up exactly to the contract amount; the remaining balance must be zero.', '里程碑金额精确合计必须等于合同总额，未分配余额须为零。'],
})
export function contractErrorText(path, locale = 'en') { return (ERROR_TEXT[path.split('.').at(-1)] || ERROR_TEXT.fields)[locale === 'zh' ? 1 : 0] }
