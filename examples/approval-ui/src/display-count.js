// Display-only grammar; counts and workflow semantics are unchanged.
const label = (count, locale, single, plural, zh) => locale === 'zh' ? `${count} ${zh}` : `${count} ${count === 1 ? single : plural}`
export const loadedRecordCount = (count, locale) => label(count, locale, 'loaded record', 'loaded records', '条已加载记录')
export const rejectedLineCount = (count, locale) => label(count, locale, 'line with rejected goods', 'lines with rejected goods', '行有不合格品')
export const approvalStageCount = (count, locale) => label(count, locale, 'approval stage', 'approval stages', '个审批节点')
export const lineCount = (count, locale) => label(count, locale, 'line', 'lines', '行明细')
