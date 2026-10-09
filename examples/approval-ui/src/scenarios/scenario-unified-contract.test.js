import { describe, expect, it, vi } from 'vitest'
import { getScenarioHandler } from './scenario-registry.js'
import { validateScenarioCatalog } from './scenario-template.js'
import { createScenarioWorkspace } from './scenario-workspace.js'
import { catalogFixture, clone, people, viewFixture, travelViewFixture, sealViewFixture, receivingViewFixture, expenseFixture, travelFixture, sealFixture, receivingFixture, processFixture, travelProcessFixture, sealProcessFixture, receivingProcessFixture, deferred, paymentFixture, contractFixture, complexProcessFixture, paymentViewFixture, contractViewFixture } from './scenario-fixtures.js'

const specs = [
  { id: 'erp-payment', form: paymentFixture, process: () => complexProcessFixture('erp-payment'), view: paymentViewFixture },
  { id: 'crm-contract', form: contractFixture, process: () => complexProcessFixture('crm-contract'), view: contractViewFixture },
  { id: 'oa-expense', form: expenseFixture, process: processFixture, view: viewFixture },
  { id: 'oa-travel', form: travelFixture, process: travelProcessFixture, view: travelViewFixture },
  { id: 'oa-seal-use', form: () => sealFixture({ copyCount: '2' }), process: sealProcessFixture, view: sealViewFixture },
  { id: 'erp-receiving', form: receivingFixture, process: receivingProcessFixture, view: receivingViewFixture },
]

describe('six compiled scenario response contracts', () => {
  it('accepts all catalog entries in either API order while rejecting any omitted entry', () => {
    const catalog = catalogFixture().sort((a, b) => a.id.localeCompare(b.id))
    expect(validateScenarioCatalog(catalog)).toBe(catalog)
    expect(validateScenarioCatalog([...catalog].reverse())).toHaveLength(6)
    for (let index = 0; index < catalog.length; index++) expect(() => validateScenarioCatalog(catalog.filter((_, position) => position !== index))).toThrow()
  })
  it.each(specs.flatMap(owner => specs.map(source => [owner.id, source.id, source.view])))('%s accepts only its own %s snapshot', (ownerId, sourceId, view) => {
    const handler = getScenarioHandler(ownerId), response = view()
    if (ownerId === sourceId) expect(handler.validateView(response)).toBe(response)
    else expect(() => handler.validateView(response)).toThrow()
  })
  it('does not let receiving summary comparison erase negative zero or unknown keys', () => {
    const handler = getScenarioHandler('erp-receiving')
    const negativeZero = receivingViewFixture(); negativeZero.summary.quantities[1].rejected = -0
    const extraRoot = receivingViewFixture(); extraRoot.summary.extra = undefined
    const extraRow = receivingViewFixture(); extraRow.summary.quantities[0].extra = undefined
    for (const response of [negativeZero, extraRoot, extraRow]) expect(() => handler.validateView(response)).toThrow()
  })
  it.each(specs)('$id retains an exact envelope, with no union of optional summary/total fields', spec => {
    const handler = getScenarioHandler(spec.id), response = spec.view()
    const wrong = [{ ...response, total: undefined }, { ...response, extra: true }]
    if (spec.id === 'erp-receiving') {
      const noSummary = clone(response); delete noSummary.summary
      wrong.push(noSummary, { ...response, total: '0' }, { ...response, summary: null })
    } else {
      wrong.push({ ...response, summary: {} })
      if (spec.id === 'oa-seal-use') wrong.push({ ...response, total: '0' }, { ...response, total: 0 })
      else wrong.push({ ...response, total: null }, { ...response, total: Number(response.total) })
    }
    wrong.forEach(view => expect(() => handler.validateView(view)).toThrow())
  })
})

describe('six-way workspace isolation', () => {
  it('retains six concurrent intents, raw forms, immutable process pins and same-ID records across switches', async () => {
    const server = Object.fromEntries(specs.map(spec => [spec.id, { process: spec.process(), items: [], pending: deferred() }]))
    const posts = [], api = { login: vi.fn(), logout: vi.fn(), request: vi.fn(async (path, options) => {
      if (path === '/me') return people[0]
      if (path === '/people') return clone(people)
      if (path === '/scenarios') return catalogFixture().reverse()
      const [, , id, resource] = path.split('/'), scope = server[id]
      if (options?.method === 'POST') { posts.push([path, options]); return scope.pending.promise }
      return clone(resource === 'process' ? scope.process : scope.items)
    }) }
    let key = 0
    const workspace = createScenarioWorkspace(api, () => `six-way-${++key}`)
    await workspace.login('alice', 'synthetic')
    const running = []
    for (const spec of specs) {
      await workspace.activate(spec.id)
      workspace.setForm(spec.form())
      workspace.state.draft.name = `Draft ${spec.id}`
      running.push(workspace.submit())
      expect(workspace.state.busy).toBe(true)
    }
    expect(posts.map(([path]) => path)).toEqual(specs.map(spec => `/scenarios/${spec.id}/documents`))
    expect(new Set(posts.map(([, options]) => options.headers['Idempotency-Key'])).size).toBe(6)
    workspace.state.tab = 'catalog'
    for (const [index, spec] of specs.entries()) {
      server[spec.id].pending.resolve(spec.view({ id: 'shared-id' }))
      await running[index]
      expect(workspace.state.tab).toBe('catalog')
    }
    for (const spec of specs) {
      await workspace.activate(spec.id)
      expect(workspace.state.items).toEqual([spec.view({ id: 'shared-id' })])
      expect(workspace.state.form.title).toBe('')
      expect(workspace.state.draft.name).toBe(`Draft ${spec.id}`)
      expect(workspace.state.notice).toBe('submitted')
      expect(workspace.state.selectedId).toBeNull()
    }
    workspace.logout()
    for (const spec of specs) {
      const state = workspace.scopeFor(spec.id).state
      expect(state.items).toEqual([]); expect(state.form.title).toBe(''); expect(state.draft).toBeNull()
      expect(state.busy).toBe(false); expect(state.retainedNotes).toEqual({})
    }
  })
})
