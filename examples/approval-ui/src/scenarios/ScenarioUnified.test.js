import { afterEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import ScenarioApp from './ScenarioApp.vue'
import {
  catalogFixture, clone, people, processFixture, viewFixture,
  travelProcessFixture, travelViewFixture, sealProcessFixture, sealViewFixture,
  receivingProcessFixture, receivingViewFixture,
} from './scenario-fixtures.js'

enableAutoUnmount(afterEach)
const scenes = [
  { id: 'oa-expense', prefix: 'expense', process: processFixture, view: viewFixture },
  { id: 'oa-travel', prefix: 'travel', process: travelProcessFixture, view: travelViewFixture },
  { id: 'oa-seal-use', prefix: 'seal', process: sealProcessFixture, view: sealViewFixture },
  { id: 'erp-receiving', prefix: 'receiving', process: receivingProcessFixture, view: receivingViewFixture },
]
function setup(withItems = false) {
  let identity = 'alice'
  const api = { login: vi.fn(user => { identity = user }), logout: vi.fn(), request: vi.fn(async (path, options) => {
    if (options?.method === 'POST') throw new Error(`Unexpected mutation ${path}`)
    if (path === '/me') return clone(people.find(person => person.id === identity))
    if (path === '/people') return clone(people)
    if (path === '/scenarios') return catalogFixture()
    const scene = scenes.find(entry => path.startsWith(`/scenarios/${entry.id}/`))
    if (!scene) throw new Error(`Unexpected route ${path}`)
    return path.endsWith('/process') ? scene.process() : withItems ? [scene.view()] : []
  }) }
  return { wrapper: mount(ScenarioApp, { attachTo: document.body, props: { api } }), api }
}
async function login(c, identity = 'alice') {
  await c.wrapper.get('.sf-login-form select').setValue(identity)
  await c.wrapper.get('input[type=password]').setValue('synthetic-test-password')
  await c.wrapper.get('.sf-login-form').trigger('submit'); await flushPromises()
}
async function tab(c, value) { await c.wrapper.get(`[data-testid=${value}-tab]`).trigger('click'); await flushPromises() }
async function open(c, prefix, destination = 'new') {
  await tab(c, 'catalog')
  await c.wrapper.get(`[data-testid=open-${prefix}]`).trigger('click'); await flushPromises()
  if (destination) await tab(c, destination)
}

describe('unified compiled scenario component catalog', () => {
  it.each(['en', 'zh'])('keeps all four forms and drafts independent in %s', async locale => {
    const c = setup(); await login(c)
    await c.wrapper.get('.sf-topbar select').setValue(locale)
    expect(c.wrapper.findAll('.sf-template-card')).toHaveLength(4)
    expect(c.wrapper.find('.sf-travel-art').exists()).toBe(true)
    expect(c.wrapper.find('.sf-seal-art').exists()).toBe(true)
    for (const scene of scenes) {
      await open(c, scene.prefix)
      await c.wrapper.get(`#${scene.prefix}-title`).setValue(`${scene.prefix} draft / 草稿`)
      expect(c.wrapper.get(`[data-testid=submit-${scene.prefix}]`).exists()).toBe(true)
      for (const other of scenes.filter(value => value !== scene)) expect(c.wrapper.find(`#${other.prefix}-title`).exists()).toBe(false)
      if (['travel', 'seal'].includes(scene.prefix)) {
        expect(c.wrapper.findAll('fieldset.sf-line-card, fieldset.rf-line-card')).toHaveLength(0)
        expect(c.wrapper.find('[data-testid=add-expense-line]').exists()).toBe(false)
      }
      if (scene.prefix === 'seal') {
        expect(c.wrapper.get('#seal-copyCount').attributes()).toMatchObject({ type: 'text', inputmode: 'numeric', maxlength: '16' })
        expect(c.wrapper.find('[data-testid=expense-total]').exists()).toBe(false)
      }
      if (scene.prefix === 'receiving') {
        expect(c.wrapper.get('#receiving-lines-0-received').attributes()).toMatchObject({ type: 'text', inputmode: 'numeric', 'aria-required': 'true' })
        expect(c.wrapper.get('#receiving-lines-0-exceptionReason').attributes('aria-required')).toBe('false')
      }
    }
    for (const scene of [...scenes].reverse()) {
      await open(c, scene.prefix)
      expect(c.wrapper.get(`#${scene.prefix}-title`).element.value).toBe(`${scene.prefix} draft / 草稿`)
    }
    expect(c.api.login).toHaveBeenCalledTimes(1)
    expect(c.api.request.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(0)
  })

  it('shows receiving quantities by unit inside the shared catalog workspace', async () => {
    const c = setup(); await login(c); await open(c, 'receiving')
    expect(c.wrapper.text()).toContain('No dynamic role assignment or separation-of-duties guarantee')
    await c.wrapper.get('[data-testid=fill-receiving-sample]').trigger('click')
    const summary = c.wrapper.get('[data-testid=receiving-summary]')
    expect(summary.text()).toContain('PCS'); expect(summary.text()).toContain('BOX')
    expect(summary.text()).toContain('78'); expect(summary.text()).toContain('2')
    expect(c.wrapper.get('#receiving-lines-0-exceptionReason').attributes('aria-required')).toBe('true')
    await c.wrapper.get('#receiving-lines-0-received').setValue('8e1')
    await c.wrapper.get('.rf-form').trigger('submit'); await flushPromises()
    expect(c.wrapper.get('#receiving-lines-0-received').element.value).toBe('8e1')
    expect(c.wrapper.get('#receiving-lines-0-received').attributes('aria-invalid')).toBe('true')
    expect(c.wrapper.find('[data-testid=expense-total]').exists()).toBe(false)
  })

  it('keeps each reviewer selection, note, typed summary and controls scoped to its document', async () => {
    const c = setup(true); await login(c, 'bob')
    for (const scene of scenes) {
      await open(c, scene.prefix, 'review')
      await c.wrapper.get('.sf-request-item').trigger('click')
      await c.wrapper.get('#scenario-comment').setValue(`${scene.prefix} note`)
      expect(c.wrapper.get(`[data-testid=approve-${scene.prefix}]`).exists()).toBe(true)
      if (scene.prefix === 'travel') expect(c.wrapper.get('[data-testid=saved-travel-duration]').text()).toBe('3 days')
      if (scene.prefix === 'seal') expect(c.wrapper.get('.sf-detail-header').text()).toContain('2 copies · Synthetic official seal')
      if (scene.prefix === 'receiving') {
        expect(c.wrapper.get('[data-testid=receiving-saved-summary]').text()).toContain('Received 80')
        expect(c.wrapper.get('.sf-request-item footer').text()).toContain('80 PCS · 10 BOX')
      }
      if (['travel', 'seal'].includes(scene.prefix)) expect(c.wrapper.find('.sf-saved-lines').exists()).toBe(false)
    }
    for (const scene of scenes) {
      await open(c, scene.prefix, 'review')
      expect(c.wrapper.get('#scenario-comment').element.value).toBe(`${scene.prefix} note`)
      await c.wrapper.get('.sf-request-item').trigger('click')
      expect(c.wrapper.get('#scenario-comment').element.value).toBe(`${scene.prefix} note`)
      await tab(c, 'mine')
      expect(c.wrapper.find('.sf-request-detail').exists()).toBe(false)
      await tab(c, 'review')
      expect(c.wrapper.get('#scenario-comment').element.value).toBe(`${scene.prefix} note`)
    }
  })

  it('preserves four independent designer undo stacks with only the active controls mounted', async () => {
    const c = setup(); await login(c)
    for (const scene of scenes) {
      await open(c, scene.prefix, 'designer')
      expect(c.wrapper.findAll('[data-testid=process-name]')).toHaveLength(1)
      await c.wrapper.get('[data-testid=process-name]').setValue(`${scene.prefix} local process`)
      expect(c.wrapper.get('.step-inspector').attributes('aria-labelledby')).toBe(`${scene.id}-inspector-heading`)
    }
    for (const scene of scenes) {
      await open(c, scene.prefix, 'designer')
      expect(c.wrapper.get('[data-testid=process-name]').element.value).toBe(`${scene.prefix} local process`)
      expect(c.wrapper.get('[data-testid=undo]').attributes('disabled')).toBeUndefined()
      await c.wrapper.get('[data-testid=undo]').trigger('click')
      expect(c.wrapper.get('[data-testid=process-name]').element.value).toBe(scene.process().name)
    }
    await c.wrapper.get('[data-testid=scenario-logout]').trigger('click'); await login(c)
    await open(c, 'expense', 'designer')
    expect(c.wrapper.get('[data-testid=process-name]').element.value).toBe(processFixture().name)
    expect(c.wrapper.get('[data-testid=undo]').attributes('disabled')).toBeDefined()
  })
})
