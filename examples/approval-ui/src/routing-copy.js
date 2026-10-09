const names = {
  'payment.netTotal': ['Payment net total', '付款净申请额'],
  'receiving.hasRejectedLines': ['Receipt has rejected lines', '收货单存在不合格明细'],
  'contract.termsKind': ['Contract terms kind', '合同条款类型'],
}
export function routingFieldLabel(field, locale = 'en') { return names[field]?.[locale === 'zh' ? 1 : 0] || field }
// Display-only labels. Keep the saved canonical fact untouched for validation,
// replay and audit comparisons; unknown strings remain escaped text in Vue.
const actualValueLabels = {
  'receiving.hasRejectedLines': {
    true: ['Has lines with rejected goods', '有不合格明细'],
    false: ['No lines with rejected goods', '无不合格明细'],
  },
  'contract.termsKind': {
    STANDARD: ['Standard terms', '标准条款'],
    NONSTANDARD: ['Nonstandard terms', '非标准条款'],
  },
}
export function routingActualValueLabel(field, actualValue, locale = 'en') {
  if (typeof actualValue !== 'string') return '—'
  const labels = Object.hasOwn(actualValueLabels, field) ? actualValueLabels[field] : null
  return labels && Object.hasOwn(labels, actualValue) ? labels[actualValue][locale === 'zh' ? 1 : 0] : actualValue
}
export function routingPredicateLabel(atom, locale = 'en') {
  const zh = locale === 'zh', name = routingFieldLabel(atom.field, locale)
  if (atom.field === 'payment.netTotal') return `${name} ${{ EQ: '=', GT: '>', GTE: '≥', LT: '<', LTE: '≤' }[atom.operator]} ${atom.currency} ${atom.threshold}`
  if (atom.field === 'receiving.hasRejectedLines') return `${name} = ${atom.expected ? (zh ? '是' : 'Yes') : (zh ? '否' : 'No')}`
  return `${name} ${atom.operator === 'IN' ? (zh ? '属于' : 'is one of') : '='} ${atom.values.map(value => value === 'STANDARD' ? (zh ? '标准条款' : 'Standard') : (zh ? '非标准条款' : 'Nonstandard')).join(zh ? '、' : ', ')}`
}
export function routingErrorText(error, locale = 'en') {
  const zh = locale === 'zh'
  if (error?.code === 'CURRENCY_MISMATCH') return zh ? '单据币种与已发布金额条件不一致。请选择相同币种，或由 Alice 修改并发布条件；不会进行汇率换算，也不会因币种不同而跳过节点。' : 'The document currency does not match the published amount conditions. Use the matching currency, or ask Alice to edit and publish the conditions. No conversion or currency-based skipping is allowed.'
  return zh ? '请先完成有效的业务单据，才能预览条件路径。提交时由服务端计算并冻结最终路径。' : 'Complete a valid document to preview the conditional route. The server calculates and freezes the final path on submission.'
}
