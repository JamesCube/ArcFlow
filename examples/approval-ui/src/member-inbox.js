import { reactive } from 'vue'
import { pendingParticipants } from './process.js'
import { InvalidApprovalPayloadError } from './business-document.js'

export const INBOX_LIMIT = 25
const boxes = ['PENDING', 'HANDLED']
const empty = () => ({ ids: [], nextCursor: null, loaded: false, loading: false, error: null, status: '', processVersion: '' })
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value
const same = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right))
const aborted = () => Object.assign(new Error('Request cancelled'), { name: 'AbortError' })

// One actor-scoped cache keeps overlapping live pages and legacy details coherent.
// A saved decision only appends history, so an older read must never replace it.
export function createMemberInbox(request) {
  const state = reactive({ PENDING: empty(), HANDLED: empty(), entities: {} })
  let actor = null, epoch = 0
  const controllers = new Map(), revisions = new Map()
  function cancel(box) {
    controllers.get(box)?.abort(); controllers.delete(box)
    revisions.set(box, (revisions.get(box) || 0) + 1)
    state[box].loading = false
  }
  function reset(box) {
    cancel(box)
    Object.assign(state[box], empty(), { status: state[box].status, processVersion: state[box].processVersion })
  }
  function setActor(id) {
    epoch++; actor = id || null
    boxes.forEach(box => { cancel(box); Object.assign(state[box], empty()) })
    state.entities = {}
  }
  function checkSnapshot(item) {
    if (!item || typeof item.id !== 'string' || !Array.isArray(item.history)) throw new InvalidApprovalPayloadError()
    const previous = state.entities[item.id]
    if (!previous) return
    const immutable = ['id', 'title', 'reason', 'days', 'applicantId', 'createdAt', 'processId', 'processVersion', 'definition', 'business']
    const length = Math.min(previous.history.length, item.history.length)
    if (immutable.some(key => !same(previous[key], item[key])) ||
      !same(previous.history.slice(0, length), item.history.slice(0, length))) throw new InvalidApprovalPayloadError()
  }
  function remember(item) {
    checkSnapshot(item)
    if (!item || typeof item.id !== 'string' || !Array.isArray(item.history)) throw new Error('Invalid inbox request')
    const previous = state.entities[item.id]
    if (!previous || item.history.length >= previous.history.length) state.entities[item.id] = item
    return state.entities[item.id]
  }
  function matches(item, box) {
    const filters = state[box]
    return !!item && (!filters.status || item.status === filters.status)
      && (!filters.processVersion || item.processVersion === Number(filters.processVersion))
      && (box === 'PENDING' ? pendingParticipants(item).includes(actor)
        : item.history.some(event => event.actorId === actor && ['APPROVE', 'REJECT'].includes(event.action)))
  }
  function items(box) { return state[box].ids.map(id => state.entities[id]).filter(item => matches(item, box)) }
  async function load(box, more = false) {
    const page = state[box]
    if (!actor || page.loading || (more && (!page.loaded || !page.nextCursor))) return
    const token = epoch, revision = revisions.get(box) || 0
    const controller = new AbortController(); controllers.set(box, controller)
    const cursor = more ? page.nextCursor : null
    const query = new URLSearchParams({ box, limit: String(INBOX_LIMIT) })
    if (page.status) query.set('status', page.status)
    if (page.processVersion) query.set('processVersion', page.processVersion)
    if (cursor) query.set('cursor', cursor)
    page.loading = true; page.error = null
    try {
      const result = await request(`/requests/inbox?${query}`, { signal: controller.signal })
      if (token !== epoch || revision !== (revisions.get(box) || 0) || controller.signal.aborted) throw aborted()
      if (!result || !Array.isArray(result.items) || result.items.length > INBOX_LIMIT
        || !(result.nextCursor === null || (typeof result.nextCursor === 'string' && result.nextCursor.length > 0))
        || (result.nextCursor && (result.items.length === 0 || result.nextCursor === cursor))
        || new Set(result.items.map(item => item?.id)).size !== result.items.length) throw new Error('Invalid inbox page')
      // Validate the entire page before changing the shared cache.
      if (result.items.some(item => !item || typeof item.id !== 'string' || !Array.isArray(item.history) || !matches(item, box))) throw new Error('Invalid inbox request')
      result.items.forEach(checkSnapshot)
      result.items.forEach(remember)
      page.ids = [...new Set([...(more ? page.ids : []), ...result.items.map(item => item.id)])]
      page.nextCursor = result.nextCursor; page.loaded = true
    } catch (error) {
      if (token === epoch && revision === (revisions.get(box) || 0) && !controller.signal.aborted && error.name !== 'AbortError') page.error = error
    } finally {
      if (token === epoch && revision === (revisions.get(box) || 0) && controllers.get(box) === controller) {
        page.loading = false; controllers.delete(box)
      }
    }
  }
  function setFilters(box, { status = '', processVersion = '' }) {
    const version = String(processVersion).trim()
    if (!['', 'PENDING', 'APPROVED', 'REJECTED'].includes(status) || (version && (!/^[1-9]\d*$/.test(version) || !Number.isSafeInteger(Number(version)) || Number(version) > 2147483647))) return false
    reset(box); Object.assign(state[box], { status, processVersion: version })
    void load(box); return true
  }
  function invalidate() { boxes.forEach(reset) }
  async function refresh() { invalidate(); await Promise.all(boxes.map(box => load(box))) }
  return { state, items, checkSnapshot, remember, setActor, setFilters, load, invalidate, refresh, dispose: () => setActor(null) }
}
