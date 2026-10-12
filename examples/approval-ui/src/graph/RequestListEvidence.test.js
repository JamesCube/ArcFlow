import { describe, expect, it } from 'vitest'
import { readRequestListState } from '../../e2e/graph-rendered-state.mjs'

describe('request navigation capture evidence', () => {
  it('reads selected row geometry relative to the real independent list viewport', () => {
    const row = { getAttribute: () => 'graph-request-selected', getBoundingClientRect: () => ({ left: 18, top: 330, right: 372, bottom: 450 }) }
    const list = { clientLeft: 1, clientTop: 1, clientWidth: 358, clientHeight: 280, scrollTop: 220, scrollHeight: 600,
      getBoundingClientRect: () => ({ left: 16, top: 200 }), querySelectorAll: () => [row] }
    expect(readRequestListState({ querySelector: () => list })).toEqual({ selectedId: 'selected', scrollTop: 220, scrollHeight: 600,
      clientHeight: 280, clientBounds: { left: 17, top: 201, right: 375, bottom: 481 },
      selectedBounds: { left: 18, top: 330, right: 372, bottom: 450 } })
    row.getBoundingClientRect = () => ({ left: 18, top: 480, right: 372, bottom: 600 })
    expect(readRequestListState({ querySelector: () => list }).selectedBounds.bottom).toBe(600)
  })
  it('does not manufacture a selection when the list is missing, empty or ambiguous', () => {
    expect(() => readRequestListState({ querySelector: () => null })).toThrow('Missing request')
    for (const rows of [[], [{}, {}]]) expect(() => readRequestListState({ querySelector: () => ({ querySelectorAll: () => rows }) })).toThrow('exactly one')
  })
})
