import { describe, expect, it } from 'vitest'
import { loadedRecordCount, rejectedLineCount, approvalStageCount, lineCount } from './display-count.js'
import { translate } from './locale.js'
describe('bilingual display counts', () => {
  for (const count of [0, 1, 2]) {
    it.each([
      ['records', loadedRecordCount, 'loaded record', 'loaded records', '条已加载记录'],
      ['rejected lines', rejectedLineCount, 'line with rejected goods', 'lines with rejected goods', '行有不合格品'],
      ['approval stages', approvalStageCount, 'approval stage', 'approval stages', '个审批节点'],
      ['receipt lines', lineCount, 'line', 'lines', '行明细'],
    ])(`formats ${count} %s without changing the count`, (_name, format, one, many, zh) => {
      expect(format(count, 'en')).toBe(`${count} ${count === 1 ? one : many}`)
      expect(format(count, 'zh')).toBe(`${count} ${zh}`)
    })
    it(`formats the published-card reviewSteps translation for ${count}`, () => {
      expect(translate('en', 'reviewSteps', { count })).toBe(`${count} approval ${count === 1 ? 'stage' : 'stages'}`)
      expect(translate('zh', 'reviewSteps', { count })).toBe(`${count} 个审批节点`)
    })
  }
})
