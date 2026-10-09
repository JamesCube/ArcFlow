import { afterEach, describe, expect, it } from 'vitest'
import { mount, enableAutoUnmount, flushPromises } from '@vue/test-utils'
import ScenarioApp from './ScenarioApp.vue'
import ReceivingApp from './ReceivingApp.vue'
import ScenarioDetail from './ScenarioDetail.vue'
import { catalogFixture, clone, people, processFixture, receivingProcessFixture, receivingViewFixture, receivingCatalogFixture } from './scenario-fixtures.js'
import { receivingSummary } from './receiving-document.js'
enableAutoUnmount(afterEach)
function receipt(id, rejected) {
  const view = receivingViewFixture({ id })
  view.request.business.lines.forEach((line, index) => {
    line.rejected = index < rejected ? 1 : 0
    line.accepted = line.received - line.rejected
    line.exceptionReason = line.rejected ? 'Synthetic rejected goods' : ''
  })
  view.summary = receivingSummary(view.request.business)
  return view
}
async function workspace(Component, count) {
  const items = Array.from({ length: count }, (_, index) => receipt(`receipt-${index}`, count))
  const api = { login() {}, logout() {}, async request(path) {
    return clone({ '/me': people[0], '/people': people, '/scenarios': catalogFixture(), '/scenarios/oa-expense/process': processFixture(), '/scenarios/oa-expense/requests': [], '/scenarios/erp-receiving/process': receivingProcessFixture(), '/scenarios/erp-receiving/requests': items }[path])
  } }
  const wrapper = mount(Component, { props: { api } })
  await wrapper.find('input[type=password]').setValue('synthetic-test-only')
  await wrapper.find('.sf-login-form').trigger('submit'); await flushPromises()
  if (Component === ScenarioApp) { await wrapper.find('[data-testid=open-receiving]').trigger('click'); await flushPromises() }
  await wrapper.find('[data-testid=mine-tab]').trigger('click')
  return wrapper
}
for (const Component of [ScenarioApp, ReceivingApp]) describe(`${Component.__name} count copy`, () => {
  it.each([0, 1, 2])('shows %i loaded record(s) and rejected-line labels in both languages', async count => {
    const wrapper = await workspace(Component, count)
    expect(wrapper.find('.sf-request-list > header').text()).toBe(`${count} loaded ${count === 1 ? 'record' : 'records'}`)
    if (count) expect(wrapper.find('.rf-exception-label').text()).toBe(`${count} ${count === 1 ? 'line' : 'lines'} with rejected goods`)
    await wrapper.find('.sf-topbar select').setValue('zh')
    expect(wrapper.find('.sf-request-list > header').text()).toBe(`${count} 条已加载记录`)
    if (count) expect(wrapper.find('.rf-exception-label').text()).toBe(`${count} 行有不合格品`)
  })
})
describe('saved receiving summary count copy', () => {
  it.each([0, 1, 2])('shows %i rejected line(s) without changing saved quantities', async count => {
    const view = receipt('detail', count), before = JSON.stringify(view)
    const wrapper = mount(ScenarioDetail, { props: { view, template: receivingCatalogFixture(), people, locale: 'en' } })
    expect(wrapper.find('[data-testid=receiving-saved-summary] > p').text()).toBe(`${count} ${count === 1 ? 'line' : 'lines'} with rejected goods · units totalled separately`)
    await wrapper.setProps({ locale: 'zh' })
    expect(wrapper.find('[data-testid=receiving-saved-summary] > p').text()).toBe(`${count} 行有不合格品 · 各单位分别合计`)
    expect(JSON.stringify(view)).toBe(before)
  })
})
