// Reviewed Seal contract copied from contracts/seal-use/js/seal-use.mjs.
// Runtime integration keeps the prototype source and its independent tests unchanged.
// The imported baseline parser preserves JSON number lexemes and rejects duplicates.
import { parseScenarioJson } from './scenario-api.js'

export const DOCUMENT_TYPE = 'sealUse'
export const DOCUMENT_VERSION = 1
export const COPY_COUNT_INPUT_MAX_LENGTH = 16
export const BUSINESS_KEYS = Object.freeze([
  'type', 'documentVersion', 'businessId', 'title', 'reason',
  'documentName', 'documentRef', 'sealType', 'copyCount',
])
export const SEAL_TYPES = Object.freeze(['OFFICIAL', 'CONTRACT', 'FINANCE'])
export const TEXT_LIMITS = Object.freeze({ title: 120, reason: 2000, documentName: 160 })
export const SEAL_TYPE_LABELS = Object.freeze({
  OFFICIAL: Object.freeze({ zh: '合成示例公章', en: 'Synthetic official seal' }),
  CONTRACT: Object.freeze({ zh: '合成示例合同章', en: 'Synthetic contract seal' }),
  FINANCE: Object.freeze({ zh: '合成示例财务章', en: 'Synthetic finance seal' }),
})

const bilingual = (zh, en) => Object.freeze({ zh, en })
export const VALIDATION_TEXT = Object.freeze({
  fields: bilingual('仅接受规定的用印字段，所有字段均须提供。', 'Provide exactly the required seal-use fields; extra fields are not accepted.'),
  type: bilingual('单据类型必须为 sealUse。', 'Document type must be sealUse.'),
  documentVersion: bilingual('单据版本必须为整数 1。', 'Document version must be the integer 1.'),
  businessId: bilingual('申请编号须为 1–128 个 ASCII 字符，以字母或数字开头；其余仅可使用字母、数字及 . _ : / -。', 'Use a 1–128 character ASCII application reference, starting with a letter or digit; then only letters, digits and . _ : / -.'),
  title: bilingual('请填写标题，最多 120 字。', 'Enter a title, up to 120 characters.'),
  reason: bilingual('请填写用途说明，最多 2000 字。', 'Enter a business purpose, up to 2000 characters.'),
  documentName: bilingual('请填写文件名称，最多 160 字。', 'Enter a document name, up to 160 characters.'),
  documentRef: bilingual('文件编号须为 1–128 个 ASCII 字符，以字母或数字开头；其余仅可使用字母、数字及 . _ : / -。', 'Use a 1–128 character ASCII document reference, starting with a letter or digit; then only letters, digits and . _ : / -.'),
  sealType: bilingual('请选择一种合成示例印章：公章、合同章或财务章。', 'Choose a synthetic example seal: official, contract or finance.'),
  copyCount: bilingual('请填写 1–100 的整数份数，不接受小数、指数、空值或文字。', 'Enter a whole-number copy count from 1 to 100; fractions, exponents, empty values and text are not accepted.'),
  copyCountInput: bilingual('请填写 1–100 的整数份数，例如 2。', 'Enter a whole-number copy count from 1 to 100, for example 2.'),
  processVersion: bilingual('流程版本须为 1–2147483647 的整数。', 'Process version must be an integer from 1 to 2147483647.'),
  json: bilingual('JSON 无效：请勿重复字段或使用非整数字面量，且不可包含尾随内容。', 'Invalid JSON: duplicate fields, noninteger numeric literals and trailing content are not accepted.'),
})

export class InvalidSealUse extends Error {
  constructor(issues) {
    super(issues.map(issue => issue.message.en).join(' '))
    this.name = 'InvalidSealUse'
    this.issues = Object.freeze([...issues])
  }
}
const issue = (path, code = path) => Object.freeze({ path, code, message: VALIDATION_TEXT[code] })

// Capture each own data-descriptor value exactly once. Validation and canonical
// output use only this ordinary snapshot, so Proxy get traps cannot change a
// value between validation and serialization. Accessors/classes/extra keys reject.
function captureDataRecord(value, keys) {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== null && prototype !== Object.prototype) return null
    const own = Reflect.ownKeys(value)
    if (own.length !== keys.length || !own.every(key => keys.includes(key))) return null
    const snapshot = {}
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return null
      snapshot[key] = descriptor.value
    }
    return Object.freeze(snapshot)
  } catch {
    // Revoked or otherwise invalid proxy reflection is an invalid record.
    return null
  }
}

export const trimSealUseText = value => value.replace(/^[\u0000-\u0020]+|[\u0000-\u0020]+$/g, '')
// Explicit Unicode White_Space list, C0 edge set and BOM; do not depend on a
// runtime's evolving \s/trim semantics. U+200B is intentionally not whitespace.
const BLANK = /^[\u0000-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]*$/u
const reference = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(value)
const validText = (value, maximum) => typeof value === 'string' && value.length <= maximum && !BLANK.test(trimSealUseText(value))
const validCopies = value => typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 100

function validateCapturedSealUse(business) {
  if (!business) return Object.freeze([issue('', 'fields')])
  const issues = []
  if (business.type !== DOCUMENT_TYPE) issues.push(issue('type'))
  if (business.documentVersion !== DOCUMENT_VERSION) issues.push(issue('documentVersion'))
  if (!reference(business.businessId)) issues.push(issue('businessId'))
  for (const [key, maximum] of Object.entries(TEXT_LIMITS)) {
    if (!validText(business[key], maximum)) issues.push(issue(key))
  }
  if (!reference(business.documentRef)) issues.push(issue('documentRef'))
  if (!SEAL_TYPES.includes(business.sealType)) issues.push(issue('sealType'))
  if (!validCopies(business.copyCount)) issues.push(issue('copyCount'))
  return Object.freeze(issues)
}

/** Validate captured scalar values without coercion. Lengths are UTF-16 units. */
export function validateSealUse(business) {
  return validateCapturedSealUse(captureDataRecord(business, BUSINESS_KEYS))
}

/** A fresh editable draft, deliberately invalid until required text is entered. */
export function emptySealUse() {
  return {
    type: DOCUMENT_TYPE, documentVersion: DOCUMENT_VERSION,
    businessId: '', title: '', reason: '', documentName: '', documentRef: '',
    sealType: 'OFFICIAL', copyCount: 1,
  }
}

/** Canonical immutable business snapshot; validates raw lengths before trim. */
function normalizeCapturedSealUse(business) {
  const issues = validateCapturedSealUse(business)
  if (issues.length) throw new InvalidSealUse(issues)
  return Object.freeze(Object.fromEntries(BUSINESS_KEYS.map(key => [
    key, Object.hasOwn(TEXT_LIMITS, key) ? trimSealUseText(business[key]) : business[key],
  ])))
}
export function normalizeSealUse(business) {
  return normalizeCapturedSealUse(captureDataRecord(business, BUSINESS_KEYS))
}
export const serializeSealUse = business => JSON.stringify(normalizeSealUse(business))
function parse(source) {
  try { return parseScenarioJson(source) }
  catch { throw new InvalidSealUse([issue('', 'json')]) }
}
/** Read raw JSON, preserving the distinction between 1, 1.0 and 1e0. */
export const readSealUse = source => normalizeSealUse(parse(source))

const validProcessVersion = value => typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 2147483647
function normalizePayload(payload) {
  const snapshot = captureDataRecord(payload, ['business', 'processVersion'])
  if (!snapshot) throw new InvalidSealUse([issue('', 'fields')])
  if (!validProcessVersion(snapshot.processVersion)) throw new InvalidSealUse([issue('processVersion')])
  return Object.freeze({ business: normalizeSealUse(snapshot.business), processVersion: snapshot.processVersion })
}
/** Optional proposed submit envelope only; these functions do not submit anything. */
export const serializeSealUsePayload = payload => JSON.stringify(normalizePayload(payload))
export const readSealUsePayload = source => normalizePayload(parse(source))

/**
 * Safe HTML-input adapter. Keep raw text in form-local state while editing.
 * Use the candidate for validation, and commit only on successful form submission.
 * Trim ECMAScript edge whitespace and allow leading zeros within a raw length cap.
 * Empty/intermediate text never becomes 0, 1, NaN, or a truncated integer.
 */
export function copyCountFromInput(raw) {
  if (typeof raw !== 'string' || raw.length > COPY_COUNT_INPUT_MAX_LENGTH) {
    return Object.freeze({ ok: false, value: null, issue: issue('copyCount', 'copyCountInput') })
  }
  const digits = raw.trim()
  if (!/^[0-9]+$/.test(digits) || !validCopies(Number(digits))) {
    return Object.freeze({ ok: false, value: null, issue: issue('copyCount', 'copyCountInput') })
  }
  return Object.freeze({ ok: true, value: Number(digits), issue: null })
}

/** Typed business summary. There is no monetary total or placeholder amount. */
export function sealUseSummary(business) {
  const normalized = normalizeSealUse(business)
  return Object.freeze({
    sealType: normalized.sealType, sealTypeLabel: SEAL_TYPE_LABELS[normalized.sealType],
    copyCount: normalized.copyCount,
    copyCountLabel: bilingual(`${normalized.copyCount} 份`, `${normalized.copyCount} ${normalized.copyCount === 1 ? 'copy' : 'copies'}`),
  })
}

/** Separate editable form shape: copyCount is text, never a business snapshot. */
export function emptySealUseForm() {
  return { ...emptySealUse(), copyCount: '1' }
}
function validateCapturedSealUseForm(draft) {
  if (!draft) return Object.freeze([issue('', 'fields')])
  const converted = copyCountFromInput(draft.copyCount)
  const issues = [...validateCapturedSealUse({ ...draft, copyCount: converted.ok ? converted.value : 1 })]
  if (!converted.ok) issues.push(converted.issue)
  return Object.freeze(issues)
}
export function validateSealUseForm(draft) {
  return validateCapturedSealUseForm(captureDataRecord(draft, BUSINESS_KEYS))
}
/** Invalid raw input remains untouched in draft; normalization fails closed. */
export function normalizeSealUseForm(draft) {
  const snapshot = captureDataRecord(draft, BUSINESS_KEYS)
  const issues = validateCapturedSealUseForm(snapshot)
  if (issues.length) throw new InvalidSealUse(issues)
  return normalizeCapturedSealUse({ ...snapshot, copyCount: copyCountFromInput(snapshot.copyCount).value })
}
