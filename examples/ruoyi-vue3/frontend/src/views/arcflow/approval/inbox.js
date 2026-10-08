// Independent, bounded pages. The authenticated actor is never sent in a query.
export const INBOX_LIMIT = 25
export const INBOX_BOXES = ['PENDING', 'HANDLED']
export const createInboxBoxes = () => Object.fromEntries(INBOX_BOXES.map(box => [box, {
  items: [], nextCursor: null, loaded: false, loading: false, error: '', status: '', processVersion: ''
}]))
export const hasHandled = (item, actor) => !!actor && Array.isArray(item?.history) && item.history.some(event => event?.actorId === actor && ['APPROVE', 'REJECT'].includes(event.action))
export const matchesFilters = (item, state) => (!state.status || item.status === state.status) &&
  (!state.processVersion || item.processVersion === Number(state.processVersion))
export function inboxQuery(box, state, cursor = null) {
  if (!INBOX_BOXES.includes(box) || !['', 'PENDING', 'APPROVED', 'REJECTED'].includes(state.status)) throw new Error('请选择有效的申请状态。')
  const query = { box, limit: INBOX_LIMIT }
  if (state.status) query.status = state.status
  if (state.processVersion !== '' && state.processVersion != null) {
    const version = String(state.processVersion)
    if (!/^[1-9]\d*$/.test(version) || !Number.isSafeInteger(Number(version)) || Number(version) > 2147483647) throw new Error('流程版本须为正整数。')
    query.processVersion = Number(version)
  }
  if (cursor !== null) query.cursor = cursor
  return query
}
function pageData(response) {
  const page = response?.data
  if (!page || !Array.isArray(page.items) || page.items.length > INBOX_LIMIT ||
      !(page.nextCursor === null || typeof page.nextCursor === 'string' && page.nextCursor.length > 0) ||
      page.items.some(item => !item || typeof item.id !== 'string' || !item.id || !['PENDING', 'APPROVED', 'REJECTED'].includes(item.status) || !Array.isArray(item.history) || !item.definition || !Array.isArray(item.definition.nodes)) ||
      new Set(page.items.map(item => item.id)).size !== page.items.length || (!page.items.length && page.nextCursor !== null)) {
    throw new Error('Invalid inbox response')
  }
  return page
}
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value
const same = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right))
const immutableFields = ['id', 'applicantId', 'createdAt', 'processId', 'processVersion', 'definition', 'business', 'title', 'reason', 'days']
const lifecycleFields = ['status', 'currentStepId', 'approverId', 'decision', 'comment', 'updatedAt']
function assertCompatible(saved, incoming) {
  if (immutableFields.some(key => Object.prototype.hasOwnProperty.call(saved, key) !== Object.prototype.hasOwnProperty.call(incoming, key) || !same(saved[key], incoming[key])) ||
      !same(saved.history.slice(0, Math.min(saved.history.length, incoming.history.length)), incoming.history.slice(0, Math.min(saved.history.length, incoming.history.length))) ||
      saved.history.length === incoming.history.length && lifecycleFields.some(key => !same(saved[key], incoming[key]))) {
    throw new Error('Inbox response rewrote an immutable snapshot or audit history')
  }
}
export function createMemberInbox({ boxes = createInboxBoxes(), loadPage, canVote, onPage = () => {}, onUnauthorized = () => {} }) {
  let actor = null, epoch = 0, disposed = false
  const snapshots = new Map()
  const requests = Object.fromEntries(INBOX_BOXES.map(box => [box, { generation: 0, controller: null }]))
  function cancel(box) {
    const request = requests[box]
    request.generation++; request.controller?.abort(); request.controller = null
    boxes[box].loading = false
  }
  function cancelAll() { INBOX_BOXES.forEach(cancel) }
  function reset() {
    epoch++; cancelAll(); snapshots.clear()
    const empty = createInboxBoxes()
    INBOX_BOXES.forEach(box => Object.assign(boxes[box], empty[box]))
  }
  function setIdentity(value) {
    if (actor !== value) { reset(); actor = value || null }
  }
  function belongs(item, box) {
    return matchesFilters(item, boxes[box]) && (box === 'PENDING' ? canVote(item, actor) : hasHandled(item, actor))
  }
  function remember(items) {
    if (!Array.isArray(items)) throw new Error('Invalid request list')
    // Validate a whole page before publishing any cache change. A corrupt row
    // must not poison either box or undo a previously confirmed business record.
    const staged = new Map(snapshots)
    const resolved = items.map(item => {
      if (!item || typeof item.id !== 'string' || !Array.isArray(item.history)) throw new Error('Invalid request snapshot')
      const saved = staged.get(item.id)
      if (saved) assertCompatible(saved, item)
      // Every mutation appends one actual vote. A slower response with a shorter
      // immutable history cannot replace a newer snapshot in either box.
      if (saved && saved.history.length > item.history.length) return saved
      staged.set(item.id, item)
      return item
    })
    staged.forEach((item, id) => snapshots.set(id, item))
    for (const box of INBOX_BOXES) boxes[box].items = boxes[box].items.map(item => snapshots.get(item.id) || item).filter(item => belongs(item, box))
    return resolved
  }
  async function load(box, { restart = false } = {}) {
    if (disposed || !actor || !INBOX_BOXES.includes(box)) return false
    const state = boxes[box], request = requests[box]
    if (restart) {
      cancel(box)
      Object.assign(state, { items: [], nextCursor: null, loaded: false, error: '' })
    } else if (state.loading || state.loaded && state.nextCursor === null) return false
    let query
    try { query = inboxQuery(box, state, state.loaded ? state.nextCursor : null) }
    catch (error) { state.error = error.message; return false }
    const generation = ++request.generation, session = epoch, actorAtStart = actor
    const controller = new AbortController()
    request.controller = controller; state.loading = true; state.error = ''
    const current = () => !disposed && epoch === session && actor === actorAtStart && request.generation === generation && !controller.signal.aborted
    try {
      const page = pageData(await loadPage(query, controller.signal))
      if (!current()) return false
      // A live list can repeat an ID across pages after a server retry. Keep one
      // row, retain server creation order, and use the latest returned snapshot.
      if (page.nextCursor !== null && page.nextCursor === query.cursor) throw new Error('Cursor did not advance')
      const accepted = remember(page.items)
      const merged = new Map(state.items.map(item => [item.id, item]))
      accepted.filter(item => belongs(item, box)).forEach(item => merged.set(item.id, item))
      state.items = [...merged.values()]; state.nextCursor = page.nextCursor; state.loaded = true
      onPage(accepted, box)
      return true
    } catch (error) {
      if (!current()) return false
      const code = error?.response?.status ?? error?.code
      if (code === 401 || code === 403) { reset(); actor = null; onUnauthorized(); return false }
      state.error = code === 400
        ? '分页或筛选已失效，请刷新本列表，从第一页重新加载。'
        : '列表加载失败。可重试本页，或刷新本列表；已加载的申请会保留。'
      return false
    } finally {
      if (current()) { state.loading = false; request.controller = null }
    }
  }
  function setFilters(box, filters) {
    Object.assign(boxes[box], filters)
    return load(box, { restart: true })
  }
  function reconcile(item) {
    cancelAll()
    item = remember([item])[0]
    for (const box of INBOX_BOXES) {
      const state = boxes[box]
      state.items = state.items.flatMap(existing => existing.id === item.id ? (belongs(item, box) ? [item] : []) : [existing])
      // A decision can introduce an older handled item before an old cursor.
      // Refresh both first pages rather than guessing a position or a total.
      state.nextCursor = null; state.loaded = false
    }
  }
  function dispose() { disposed = true; reset(); actor = null }
  return { boxes, load, setFilters, setIdentity, reset, cancelAll, reconcile, remember, dispose }
}
