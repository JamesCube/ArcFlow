import { afterEach, describe, expect, it } from 'vitest'
import { enableAutoUnmount, mount } from '@vue/test-utils'
import ScenarioDetail from './ScenarioDetail.vue'
import { readFileSync } from 'node:fs'
const stylesheet = readFileSync('src/scenarios/scenario.css', 'utf8')
import { catalogFixture, decidedFixture, people, viewFixture } from './scenario-fixtures.js'

enableAutoUnmount(afterEach)
const styles = []
afterEach(() => styles.splice(0).forEach(style => style.remove()))

describe('scenario audit timestamp separation', () => {
  it.each(['en', 'zh'])('keeps the initial SUBMIT timestamp on its own spaced line in %s', locale => {
    const style = document.createElement('style'); style.textContent = stylesheet
    document.head.append(style); styles.push(style)
    const wrapper = mount(ScenarioDetail, { attachTo: document.body, props: {
      view: viewFixture(), template: catalogFixture()[0], locale, people, comment: '', busy: false, canDecide: false, blocked: false,
    } })
    const event = wrapper.get('.timeline li'), timestamp = event.get('small').element
    expect(event.find('p').exists()).toBe(false)
    expect(event.get('strong').text()).toContain(locale === 'zh' ? '提交申请' : 'Submitted request')
    expect(getComputedStyle(timestamp).display).toBe('block')
    expect(getComputedStyle(timestamp).marginTop).toBe('6px')
  })
})


describe('meaningful approval snapshot text', () => {
  it('uses readable type and AA contrast on white and lightly tinted cards', () => {
    const style = document.createElement('style'); style.textContent = stylesheet
    document.head.append(style); styles.push(style)
    const wrapper = mount(ScenarioDetail, { attachTo: document.body, props: {
      view: decidedFixture(viewFixture(), 'bob', 'APPROVE', 'Receipts verified'), template: catalogFixture()[0], locale: 'en', people,
    } })
    const selectors = [
      ['.sf-snapshot-flow .approved header > span', 11],
      ['.sf-vote > span:nth-child(2)', 11],
      ['.sf-vote p', 12],
      ['.sf-detail-fields dt', 12],
    ]
    for (const [selector, minimum] of selectors) {
      const computed = getComputedStyle(wrapper.get(selector).element)
      expect(computed.color).toBe('rgb(99, 115, 147)')
      expect(parseFloat(computed.fontSize)).toBeGreaterThanOrEqual(minimum)
    }
    const luminance = rgb => rgb.map(value => value / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0)
    const ink = luminance([99, 115, 147])
    for (const background of [[255, 255, 255], [250, 250, 255]]) expect((luminance(background) + 0.05) / (ink + 0.05)).toBeGreaterThanOrEqual(4.5)
    // The existing purple current-stage cue is intentionally preserved.
    expect(getComputedStyle(wrapper.get('.sf-snapshot-flow .current header > span').element).color).toBe('rgb(101, 97, 198)')
  })
})
