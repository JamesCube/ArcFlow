// The screenshot witness comes from the rendered DOM. API state is used only
// as the independently supplied expectation, never as the captured witness.
export function readRenderedGraphState(root) {
  const required = (element, name) => {
    const value = element.getAttribute(name)
    if (value === null || value === '') throw new Error(`Missing rendered graph attribute: ${name}`)
    return value
  }
  const integer = (element, name) => {
    const value = required(element, name)
    if (!/^(0|[1-9]\d*)$/.test(value) || !Number.isSafeInteger(Number(value))) {
      throw new Error(`Invalid rendered graph integer: ${name}`)
    }
    return Number(value)
  }
  const activeCountText = root.querySelector('[data-testid="graph-active-count"]')?.textContent?.trim()
  if (!/^(0|[1-9]\d*)$/.test(activeCountText || '')) throw new Error('Missing rendered active task count')
  const tasks = Array.from(root.querySelectorAll('.gf-task'), element => {
    const voteCount = integer(element, 'data-vote-count')
    if (element.querySelectorAll('.gf-votes > li').length !== voteCount) {
      throw new Error('Rendered task vote count differs from visible vote rows')
    }
    return {
      id: required(element, 'data-task-id'),
      status: required(element, 'data-task-status'),
      voteCount,
    }
  })
  const forks = Array.from(root.querySelectorAll('.gf-join-status'), element => {
    const fired = required(element, 'data-fork-fired')
    if (!['true', 'false'].includes(fired)) throw new Error('Invalid rendered fork fired flag')
    return {
      id: required(element, 'data-fork-id'),
      fired: fired === 'true',
      arrivedBranchIds: JSON.parse(required(element, 'data-arrived-branch-ids')),
      expectedBranchIds: JSON.parse(required(element, 'data-expected-branch-ids')),
    }
  })
  return {
    id: required(root, 'data-request-id'),
    status: required(root, 'data-request-status'),
    commandRevision: integer(root, 'data-command-revision'),
    definitionVersion: integer(root, 'data-definition-version'),
    activeTaskCount: Number(activeCountText),
    tasks,
    forks,
  }
}

const invalid = message => { throw new Error(`Invalid rendered graph state: ${message}`) }
const integer = value => Number.isSafeInteger(value) && value >= 0
const stableIds = values => {
  if (!Array.isArray(values) || values.some(value => typeof value !== 'string' || !value) || new Set(values).size !== values.length) invalid('branch IDs')
  return [...values].sort()
}
const byId = (left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0

export function normalizeRenderedGraphState(value) {
  if (!value || typeof value.id !== 'string' || !value.id || !['PENDING', 'APPROVED', 'REJECTED'].includes(value.status) || !integer(value.commandRevision) || !integer(value.definitionVersion) || value.definitionVersion < 1 || !integer(value.activeTaskCount) || !Array.isArray(value.tasks) || !Array.isArray(value.forks)) invalid('root')
  const tasks = value.tasks.map(task => {
    if (!task || typeof task.id !== 'string' || !task.id || !['ACTIVE', 'COMPLETED', 'REJECTED', 'CANCELLED'].includes(task.status) || !integer(task.voteCount)) invalid('task')
    return { id: task.id, status: task.status, voteCount: task.voteCount }
  }).sort(byId)
  const forks = value.forks.map(fork => {
    if (!fork || typeof fork.id !== 'string' || !fork.id || typeof fork.fired !== 'boolean') invalid('fork')
    return { id: fork.id, fired: fork.fired, arrivedBranchIds: stableIds(fork.arrivedBranchIds), expectedBranchIds: stableIds(fork.expectedBranchIds) }
  }).sort(byId)
  if (new Set(tasks.map(task => task.id)).size !== tasks.length || new Set(forks.map(fork => fork.id)).size !== forks.length) invalid('duplicate identity')
  if (tasks.filter(task => task.status === 'ACTIVE').length !== value.activeTaskCount) invalid('active task count')
  return { id: value.id, status: value.status, commandRevision: value.commandRevision, definitionVersion: value.definitionVersion, activeTaskCount: value.activeTaskCount, tasks, forks }
}

export function expectedRenderedGraphState(instance) {
  return normalizeRenderedGraphState({
    id: instance.id,
    status: instance.status,
    commandRevision: instance.commandRevision,
    definitionVersion: instance.definition.version,
    activeTaskCount: instance.tasks.filter(task => task.status === 'ACTIVE').length,
    tasks: instance.tasks.map(task => ({ id: task.id, status: task.status, voteCount: task.votes.length })),
    forks: instance.forks.map(fork => ({ id: fork.id, fired: fork.fired, arrivedBranchIds: fork.arrivedBranchIds, expectedBranchIds: fork.expectedBranchIds })),
  })
}

export function assertRenderedGraphState(rendered, instance) {
  const observed = normalizeRenderedGraphState(rendered)
  const expected = expectedRenderedGraphState(instance)
  if (JSON.stringify(observed) !== JSON.stringify(expected)) {
    throw new Error('Rendered graph state does not match the expected durable request snapshot')
  }
  return observed
}

export function renderedStatusLabel(status, locale) {
  const labels = {
    en: { PENDING: 'Pending', APPROVED: 'Approved', REJECTED: 'Rejected', ACTIVE: 'Awaiting review', COMPLETED: 'Completed', CANCELLED: 'Cancelled' },
    zh: { PENDING: '审批中', APPROVED: '已通过', REJECTED: '已驳回', ACTIVE: '待审批', COMPLETED: '已完成', CANCELLED: '已取消' },
  }
  const label = labels[locale]?.[status]
  if (!label) throw new Error('Unsupported graph status or capture locale')
  return label
}

// Full-page capture does not make horizontally clipped graph nodes visible.
// Record the portion actually inside each scroll container's viewport.
export function readGraphCanvasState(root = document) {
  return Array.from(root.querySelectorAll('.gf-canvas')).flatMap(canvas => {
    const bounds = canvas.getBoundingClientRect()
    if (bounds.width <= 0 || bounds.height <= 0) return []
    const left = bounds.left + canvas.clientLeft, top = bounds.top + canvas.clientTop
    const right = left + canvas.clientWidth, bottom = top + canvas.clientHeight
    const nodes = Array.from(canvas.querySelectorAll('.gf-node[data-testid]')).map(node => ({
      id: (node.getAttribute('data-testid') || '').replace(/^graph-node-/, ''), rect: node.getBoundingClientRect(),
    }))
    const allNodeIds = nodes.map(node => node.id).sort()
    const visibleNodeIds = nodes.filter(({rect}) => rect.width > 0 && rect.height > 0 && rect.right > left && rect.left < right && rect.bottom > top && rect.top < bottom).map(node => node.id).sort()
    const fullyVisibleNodeIds = nodes.filter(({rect}) => rect.width > 0 && rect.height > 0 && rect.left >= left - .5 && rect.right <= right + .5 && rect.top >= top - .5 && rect.bottom <= bottom + .5).map(node => node.id).sort()
    const nodeHorizontalClipping = nodes.filter(({rect}) => rect.left < left - .5 || rect.right > right + .5).map(node => node.id).sort()
    return [{
      scrollLeft: canvas.scrollLeft,
      scrollTop: canvas.scrollTop,
      clientWidth: canvas.clientWidth,
      scrollWidth: canvas.scrollWidth,
      clientHeight: canvas.clientHeight,
      scrollHeight: canvas.scrollHeight,
      minimumNodeWidth: nodes.length ? Math.min(...nodes.map(node => node.rect.width)) : 0,
      visibleNodeIds, allNodeIds, fullyVisibleNodeIds, nodeHorizontalClipping, clientBounds: {left, top, right, bottom},
    }]
  })
}

// Reads the editable condition controls, not the supplied published snapshot.
export function readDesignerProperties(root) {
  const panel = root.querySelector('[data-testid="graph-properties"]')
  const value = selector => {
    const control = root.querySelector(`[data-testid="${selector}"]`)
    if (!control) throw new Error(`Missing visible designer control: ${selector}`)
    return control.value
  }
  const selectedKind = panel?.getAttribute('data-selected-kind'), selectedId = panel?.getAttribute('data-selected-id')
  if (selectedKind !== 'edge' || !selectedId) throw new Error('Expected an identified conditional branch inspector')
  const predicates = Array.from(panel.querySelectorAll('.gf-predicate'), (fieldset, index) => {
    const threshold = value(`graph-threshold-${index}`)
    if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(threshold)) throw new Error('Invalid visible threshold')
    return { field: fieldset.getAttribute('data-field'), operator: value(`graph-operator-${index}`), currency: value(`graph-condition-currency-${index}`), threshold: Number(threshold) }
  })
  if (!predicates.length) throw new Error('Expected visible branch conditions')
  return {
    definitionId: root.getAttribute('data-definition-id'), definitionVersion: Number(root.getAttribute('data-definition-version')),
    definitionName: value('graph-process-name'), selectedKind, selectedId,
    edge: { id: selectedId, label: value('graph-branch-name'), defaultBranch: panel.getAttribute('data-default-branch') === 'true', condition: { mode: value('graph-condition-mode'), predicates } },
  }
}

export function assertDesignerProperties(observed, definition, edgeId) {
  const edge = definition.edges.find(edge => edge.id === edgeId)
  const expected = { definitionId: definition.id, definitionVersion: definition.version, definitionName: definition.name, selectedKind: 'edge', selectedId: edgeId, edge: { id: edge.id, label: edge.label, defaultBranch: edge.defaultBranch, condition: edge.condition } }
  if (JSON.stringify(observed) !== JSON.stringify(expected)) throw new Error('Rendered designer properties differ from the published branch')
  return observed
}
