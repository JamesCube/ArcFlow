import { exactKeys, invalid } from './expense-document.js'
import { getScenarioHandler, scenarioHandlers } from './scenario-registry.js'
const translated = value => exactKeys(value, ['zh', 'en']) && ['zh', 'en'].every(key => typeof value[key] === 'string' && value[key].trim() && value[key].length <= 2000)
function fields(items, kinds, enums, lengths) {
  if (!Array.isArray(items)) invalid()
  for (const field of items) {
    if (!exactKeys(field, ['path', 'kind', 'label', 'required', 'maxLength', 'options']) || typeof field.path !== 'string' || !Object.hasOwn(kinds, field.path) || kinds[field.path] !== field.kind || !translated(field.label) || field.required !== true || !Number.isInteger(field.maxLength) || field.maxLength < 0 || field.maxLength > 2000 || !Array.isArray(field.options) || field.options.some(option => !exactKeys(option, ['value', 'label']) || typeof option.value !== 'string' || !translated(option.label)) || new Set(field.options.map(option => option.value)).size !== field.options.length || (field.kind === 'select' ? !field.options.length : field.options.length)) invalid()
    if (lengths && field.maxLength !== lengths[field.path]) invalid()
    if (field.kind === 'select' && (field.options.length !== enums[field.path].length || field.options.some(option => !enums[field.path].includes(option.value)))) invalid()
  }
}
export function validateScenarioCatalog(catalog) {
  if (!Array.isArray(catalog) || catalog.length !== Object.keys(scenarioHandlers).length) invalid()
  if (new Set(catalog.map(template => template?.id)).size !== catalog.length) invalid()
  for (const template of catalog) {
    if (typeof template?.id !== 'string' || !Object.hasOwn(scenarioHandlers, template.id)) invalid()
    const handler = getScenarioHandler(template.id), { rootKinds, lineKinds } = handler
    if (!exactKeys(template, ['id', 'domain', 'documentType', 'documentVersion', 'formVersion', 'title', 'description', 'sections', 'lineItems']) || template.documentType !== handler.documentType || template.documentVersion !== handler.documentVersion || template.formVersion !== handler.formVersion || template.domain !== handler.domain || !translated(template.title) || !translated(template.description) || !Array.isArray(template.sections) || !template.sections.length) invalid()
    const rootFields = []
    for (const section of template.sections) {
      if (!exactKeys(section, ['id', 'title', 'fields']) || typeof section.id !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(section.id) || !translated(section.title)) invalid()
      fields(section.fields, rootKinds, handler.enums, handler.rootLengths); rootFields.push(...section.fields)
    }
    if (new Set(template.sections.map(section => section.id)).size !== template.sections.length || rootFields.length !== Object.keys(rootKinds).length || new Set(rootFields.map(field => field.path)).size !== rootFields.length) invalid()
    const lineItems = template.lineItems
    if (lineKinds === null) { if (lineItems !== null) invalid(); continue }
    if (!exactKeys(lineItems, ['path', 'label', 'minItems', 'maxItems', 'fields']) || lineItems.path !== 'lines' || !translated(lineItems.label) || lineItems.minItems !== 1 || lineItems.maxItems !== 20) invalid()
    fields(lineItems.fields, lineKinds, handler.enums)
    if (lineItems.fields.length !== Object.keys(lineKinds).length || new Set(lineItems.fields.map(field => field.path)).size !== lineItems.fields.length) invalid()
  }
  return catalog
}
