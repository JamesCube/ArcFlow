// Runtime adapter reuses the reviewed, dependency-free Seal contract. Drafts
// retain raw count text; only validated submissions become integer snapshots.
import { emptySealUseForm, validateSealUseForm, normalizeSealUseForm, validateSealUse, normalizeSealUse, serializeSealUsePayload, sealUseSummary, VALIDATION_TEXT, SEAL_TYPES } from './seal-contract.js'
import { invalid } from './expense-document.js'
export const SEAL_TEMPLATE_ID = 'oa-seal-use'
export { SEAL_TYPES }
export const emptySeal = emptySealUseForm
export const sealFormErrors = value => validateSealUseForm(value).map(issue => issue.path || 'fields')
export const sealErrors = value => validateSealUse(value).map(issue => issue.path || 'fields')
export const normalizeSealForm = normalizeSealUseForm
export const normalizeSeal = normalizeSealUse
export const serializeSealPayload = serializeSealUsePayload
export const sealErrorText = (path, locale) => (VALIDATION_TEXT[path === 'copyCount' ? 'copyCountInput' : path] || VALIDATION_TEXT.fields)[locale]
export function sealSummary(value, locale = 'en') {
  try { const summary = sealUseSummary(value); return `${summary.copyCountLabel[locale]} · ${summary.sealTypeLabel[locale]}` } catch { return invalid() }
}
export function sealDraftSummary(value, locale = 'en') {
  try { return sealSummary(normalizeSealForm(value), locale) } catch { return locale === 'zh' ? '份数 1–100 · 合成示例印章' : '1–100 copies · synthetic example seal' }
}
