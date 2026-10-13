import { afterEach, describe, expect, it } from 'vitest'
import { mount, enableAutoUnmount } from '@vue/test-utils'
import { readFileSync } from 'node:fs'
import GraphSequence from './GraphSequence.vue'
import { graphSequence } from './model.js'
import { definition, directory } from './fixtures.test-support.js'

const stylesheet = readFileSync('src/graph/graph.css', 'utf8')
const polish = stylesheet.slice(stylesheet.indexOf('/* Keep the short refresh action'))
const compact = /@container graphunit \(max-width: 200px\) \{([\s\S]+?)\n\}/.exec(polish)?.[1]
const styles = []
enableAutoUnmount(afterEach)
afterEach(() => { styles.splice(0).forEach(style => style.remove()); document.body.innerHTML = '' })
function style(css) { const element = document.createElement('style'); element.textContent = css; document.head.append(element); styles.push(element) }

describe('narrow graph typography CSS contracts', () => {
  it.each([['en', 'Refresh'], ['zh', '刷新']])('keeps the %s refresh action on one line without squeezing the heading', (locale, label) => {
    style(polish.slice(0, polish.indexOf('@container')))
    document.body.innerHTML = `<section class="gf-workspace"><header class="gf-workspace-heading"><div><h2>${locale === 'zh' ? '报价折扣审批图' : 'Quote discount graph'}</h2></div><button class="secondary">↻ ${label}</button></header></section>`
    const heading = document.querySelector('.gf-workspace-heading > div'), button = document.querySelector('button')
    expect(getComputedStyle(button).whiteSpace).toBe('nowrap')
    expect(getComputedStyle(button).flexShrink).toBe('0')
    expect(getComputedStyle(button).minWidth).toBe('max-content')
    expect(getComputedStyle(heading).minWidth).toBe('0px')
    expect(button.textContent).toBe(`↻ ${label}`)
  })
  it.each(['en', 'zh'])('preserves the full bilingual node title with compact ornament spacing in %s', locale => {
    // jsdom cannot evaluate container geometry. Check the scoped declarations
    // here; the real 320px browser matrix verifies wrapping and no overflow.
    expect(compact).toBeTruthy()
    style(polish.slice(0, polish.indexOf('@container')) + compact)
    const graph = definition(); graph.nodes.find(node => node.id === 'first').name = '商业复核 / Commercial review'
    const wrapper = mount(GraphSequence, { attachTo: document.body, props: { items: graphSequence(graph), locale, people: directory } })
    const node = wrapper.get('[data-testid="graph-node-first"]'), title = node.get('.gf-node-copy > strong')
    expect(title.text()).toBe('商业复核 / Commercial review')
    expect(getComputedStyle(title.element).wordBreak).toBe('normal')
    expect(getComputedStyle(title.element).overflowWrap).toBe('break-word')
    expect(getComputedStyle(title.element).hyphens).toBe('none')
    expect(getComputedStyle(node.element).paddingLeft).toBe('10px')
    expect(getComputedStyle(node.element).gap).toBe('8px')
    expect(getComputedStyle(node.get('.gf-node-symbol').element).flexBasis).toBe('24px')
  })
  it('scopes the compact treatment to the owning narrow track and retains bounded node width', () => {
    expect(polish).toContain('@container graphunit (max-width: 200px)')
    expect(stylesheet).toContain('.gf-unit{container:graphunit / inline-size}')
    expect(stylesheet).toContain('.gf-node{min-width:0;max-width:100%;flex-shrink:0}')
    expect(compact).not.toMatch(/min-width|white-space|overflow/)
    expect(compact).not.toMatch(/\.gf-node\s*\{[^}]*height:/)
  })
})
