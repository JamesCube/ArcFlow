import { reactive } from 'vue'
import { newSubmissionKey, isRejectedSubmissionVersion } from '../submission-intent.js'
import { cloneDefinition, validateDefinition, validatePublicationResponse, pendingParticipants, participants, approvalNodes } from '../process.js'
import { TEMPLATE_ID, InvalidScenarioPayload, invalid, same } from './expense-document.js'
import { getScenarioHandler, scenarioHandlers } from './scenario-registry.js'
import { validateScenarioCatalog } from './scenario-template.js'
const fresh = (handler, keyFactory) => ({ process: null, draft: null, baseline: '', items: [], form: handler.createDraft(keyFactory), attempted: false, busy: false, publishing: false, error: null, notice: '', tab: 'catalog', selectedId: null, comment: '', retainedNotes: {}, conflict: false, blockedDecisions: [], uncertainSubmission: false, rejectedVersion: false, loaded: false })
function createScenarioScope(api, keyFactory, id, session, logout) {
  const handler = getScenarioHandler(id), base = `/scenarios/${id}`
  const fingerprint = business => { try { return JSON.stringify(handler.normalize(business)) } catch { return JSON.stringify(business) } }
  const definition = value => { if (validateDefinition(value, id).length || value.version > 2147483647) invalid(); return value }
  let intent = null
  const state = reactive(fresh(handler, keyFactory))
  const generation = () => session.generation
  const dirty = () => !!state.draft && JSON.stringify(state.draft) !== state.baseline
  const stale = () => state.conflict || state.draft?.version !== state.process?.version
  const resetDraft = () => { state.draft = cloneDefinition(state.process); state.baseline = JSON.stringify(state.draft); state.conflict = false }
  const setPublished = value => {
    definition(value)
    if (state.process && (value.version < state.process.version || (value.version === state.process.version && !same(value, state.process)))) invalid()
    const preserve = dirty(); state.process = value; if (!preserve) resetDraft()
  }
  function clear() { intent = null; Object.assign(state, fresh(handler, keyFactory)) }
  function failure(cause, operation) {
    if (cause?.status === 401) { logout(); session.authError = { cause, operation } }
    else state.error = { cause, operation }
  }
  function remember(view) {
    const existing = state.items.find(item => item.request.id === view.request.id)
    if (existing) {
      const before = existing.request.history, after = view.request.history
      if (!same(view.request.business, existing.request.business) || !same(view.request.definition, existing.request.definition) || view.request.createdAt !== existing.request.createdAt || view.request.applicantId !== existing.request.applicantId) invalid()
      if (after.length < before.length) { if (!same(before.slice(0, after.length), after)) invalid(); return false }
      if (!same(after.slice(0, before.length), before)) invalid()
    }
    state.items = [view, ...state.items.filter(item => item.request.id !== view.request.id)]; return true
  }
  function setForm(value) {
    if (state.busy) return
    if (intent && intent.fingerprint !== fingerprint(value)) { intent = null; state.uncertainSubmission = false; state.rejectedVersion = false }
    state.form = value
  }
  function select(id) { state.selectedId = id; state.comment = '' }
  const noteKey = (id, stepId) => JSON.stringify([id, stepId])
  const retainedNotesFor = id => Object.values(state.retainedNotes).filter(note => note.requestId === id)
  const dismissRetainedNote = (id, stepId) => { delete state.retainedNotes[noteKey(id, stepId)] }
  function load(process, items) {
    definition(process); handler.validateList(items)
    state.process = process; state.items = items; state.loaded = true; resetDraft()
  }
  async function refresh() {
    if (state.busy || !session.me) return
    const current = generation(), selectedStep = state.items.find(view => view.request.id === state.selectedId)?.request.currentStepId
    state.busy = true; state.error = null; state.notice = ''
    try {
      const [process, items] = await Promise.all([api.request(`${base}/process`), api.request(`${base}/requests`)])
      if (current !== generation()) return
      definition(process); handler.validateList(items)
      const confirmed = items.filter(remember).map(view => view.request.id); setPublished(process)
      state.blockedDecisions = state.blockedDecisions.filter(id => !confirmed.includes(id))
      if (selectedStep !== state.items.find(view => view.request.id === state.selectedId)?.request.currentStepId) state.comment = ''
      if (state.rejectedVersion) { intent = null; state.rejectedVersion = false; state.uncertainSubmission = false }
      state.loaded = true; state.notice = 'refreshed'
    } catch (cause) { if (current === generation()) failure(cause, 'refresh') }
    finally { if (current === generation()) state.busy = false }
  }
  async function publish() {
    if (state.busy || session.me?.id !== 'alice' || !dirty() || stale() || validateDefinition(state.draft, id).length) return
    const current = generation(), submitted = cloneDefinition(state.draft)
    submitted.name = submitted.name.trim(); submitted.nodes = submitted.nodes.map(node => ({ ...node, name: node.name.trim() }))
    state.busy = true; state.publishing = true; state.error = null; state.notice = ''
    try {
      const published = await api.request(`${base}/process`, { method: 'POST', body: JSON.stringify({ expectedVersion: submitted.version, definition: submitted }) })
      if (current !== generation()) return
      validatePublicationResponse(published, submitted, id); definition(published); state.process = published; resetDraft(); state.notice = 'published'
    } catch (cause) { if (current === generation()) { state.conflict = true; failure(cause, 'publish') } }
    finally { if (current === generation()) { state.busy = false; state.publishing = false } }
  }
  async function submit() {
    if (state.busy || !session.me || state.rejectedVersion) return
    state.attempted = true; state.error = null; state.notice = ''
    if (handler.errors(state.form).length) { state.error = { operation: 'validation' }; return }
    const pinned = intent?.definition || state.process
    if (validateDefinition(pinned, id).length || approvalNodes(pinned).some(node => participants(node).includes(session.me.id))) { state.error = { operation: 'selfAssigned' }; return }
    const current = generation(); state.busy = true
    try {
      if (!intent) intent = { key: keyFactory(), actor: session.me.id, fingerprint: fingerprint(state.form), payload: { business: handler.normalize(state.form), processVersion: state.process.version }, definition: cloneDefinition(state.process) }
      const attempt = intent
      const view = await api.request(`${base}/documents`, { method: 'POST', headers: { 'Idempotency-Key': attempt.key }, body: handler.serialize(attempt.payload) })
      if (current !== generation()) return
      handler.validateView(view, attempt); remember(view)
      intent = null; state.uncertainSubmission = false; state.rejectedVersion = false; state.form = handler.createDraft(keyFactory); state.attempted = false
      state.tab = 'mine'; select(view.request.id); state.notice = 'submitted'
    } catch (cause) { if (current === generation()) { state.rejectedVersion = isRejectedSubmissionVersion(cause); state.uncertainSubmission = !state.rejectedVersion; failure(cause, 'submit') } }
    finally { if (current === generation()) state.busy = false }
  }
  function canDecide(view) { return !!view && !state.blockedDecisions.includes(view.request.id) && pendingParticipants(view.request).includes(session.me?.id) }
  async function decide(decision) {
    const original = state.items.find(view => view.request.id === state.selectedId)
    if (state.busy || !['APPROVE', 'REJECT'].includes(decision) || !canDecide(original) || state.comment.length > 2000) return
    const current = generation(), id = original.request.id, stepId = original.request.currentStepId, actor = session.me.id, typedComment = state.comment, submittedComment = state.comment.trim()
    state.busy = true; state.error = null; state.notice = ''
    try {
      const view = await api.request(`${base}/requests/${encodeURIComponent(id)}/decisions`, { method: 'POST', body: JSON.stringify({ stepId, decision, comment: submittedComment }) })
      if (current !== generation()) return
      handler.validateDecision(view, original, actor, stepId, decision, submittedComment); remember(view)
      dismissRetainedNote(id, stepId)
      if (state.selectedId === id) state.comment = ''
      state.notice = 'decided'
    } catch (cause) {
      if (current !== generation()) return
      state.blockedDecisions = [...new Set([...state.blockedDecisions, id])]
      if (typedComment) state.retainedNotes[noteKey(id, stepId)] = { requestId: id, stepId, comment: typedComment }
      failure(cause, 'decision')
      // A different acknowledged comment is not this submitted decision. Keep
      // the typed note and require explicit audit refresh; do not silently
      // clear it via automatic recovery, including an idempotent old vote.
      if (current !== generation() || cause?.code === 'DECISION_COMMENT_MISMATCH') return
      try {
        const response = await api.request(`${base}/requests`)
        if (current !== generation()) return
        const items = handler.validateList(response), confirmed = items.filter(remember).map(view => view.request.id)
        if (confirmed.includes(id)) {
          const recovered = state.items.find(view => view.request.id === id).request
          const savedVote = recovered.history.find(event => event.actorId === actor && event.stepId === stepId && ['APPROVE', 'REJECT'].includes(event.action))
          const matches = savedVote?.action === decision && savedVote.comment === submittedComment
          const advanced = recovered.currentStepId !== stepId || recovered.status !== 'PENDING'
          if ((savedVote && !matches) || (!savedVote && advanced)) {
            // Another tab or an ANY participant may have changed the stage. Its
            // activity is valid, but it does not acknowledge this typed note.
            failure(Object.assign(new InvalidScenarioPayload(), { code: 'DECISION_RECOVERY_MISMATCH' }), 'decision')
            if (state.selectedId === id) state.comment = ''
          } else {
            state.blockedDecisions = state.blockedDecisions.filter(value => value !== id)
            if (matches) {
              dismissRetainedNote(id, stepId)
              if (state.selectedId === id) state.comment = ''
            }
          }
        }
      } catch (recoveryError) { if (current === generation() && recoveryError?.status === 401) failure(recoveryError, 'decision') }
    } finally { if (current === generation()) state.busy = false }
  }
  return { state, load, clear, refresh, publish, submit, decide, canDecide, dirty, stale, setForm, select, resetDraft, retainedNotesFor, dismissRetainedNote, submissionDefinition: () => intent?.definition || state.process }
}


// One credential transport, with separately retained typed workspaces. Async
// work closes over its original scope, so a late response cannot update another
// scenario's form, notes, records or selected process. Logout invalidates all.
export function createScenarioWorkspace(api, keyFactory = newSubmissionKey) {
  const session = reactive({ me: null, people: [], catalog: [], generation: 0, authError: null, activeScenarioId: TEMPLATE_ID })
  const scopes = Object.fromEntries(Object.keys(scenarioHandlers).map(id => [id, createScenarioScope(api, keyFactory, id, session, logout)]))
  const state = reactive({})
  for (const key of ['me', 'people', 'catalog', 'activeScenarioId']) Object.defineProperty(state, key, { enumerable: true, get: () => session[key], set: value => { session[key] = value } })
  for (const key of Object.keys(scopes[TEMPLATE_ID].state)) Object.defineProperty(state, key, { enumerable: true, get: () => key === 'error' && session.authError ? session.authError : scopes[session.activeScenarioId].state[key], set: value => { if (key === 'error') session.authError = null; scopes[session.activeScenarioId].state[key] = value } })
  function logout() {
    session.generation++; api.logout()
    Object.values(scopes).forEach(scope => scope.clear())
    session.authError = null; session.me = null; session.people = []; session.catalog = []; session.activeScenarioId = TEMPLATE_ID
  }
  async function login(username, password) {
    if (state.busy) return
    logout()
    const current = ++session.generation, scope = scopes[TEMPLATE_ID], local = scope.state
    local.busy = true; api.login(username, password)
    try {
      const [me, people, catalog, process, items] = await Promise.all([api.request('/me'), api.request('/people'), api.request('/scenarios'), api.request(`/scenarios/${TEMPLATE_ID}/process`), api.request(`/scenarios/${TEMPLATE_ID}/requests`)])
      if (current !== session.generation) return
      if (!['alice', 'bob', 'carol'].includes(me?.id) || !Array.isArray(people) || people.some(person => !['alice', 'bob', 'carol'].includes(person?.id)) || new Set(people.map(person => person.id)).size !== 3) invalid()
      validateScenarioCatalog(catalog); scope.load(process, items)
      session.me = me; session.people = people; session.catalog = catalog
    } catch (cause) {
      if (current === session.generation) { api.logout(); if (cause?.status === 401) logout(); state.error = { cause, operation: 'login' } }
    } finally { if (current === session.generation) local.busy = false }
  }
  async function selectScenario(id, tab = 'new') {
    getScenarioHandler(id)
    if (!session.me || !session.catalog.some(template => template.id === id)) return
    session.activeScenarioId = id
    const scope = scopes[id]; scope.state.tab = tab
    if (!scope.state.loaded) await scope.refresh()
  }
  const methods = Object.fromEntries(['refresh', 'publish', 'submit', 'decide', 'canDecide', 'dirty', 'stale', 'setForm', 'select', 'resetDraft', 'retainedNotesFor', 'dismissRetainedNote', 'submissionDefinition'].map(name => [name, (...args) => scopes[session.activeScenarioId][name](...args)]))
  return { state, login, logout, selectScenario, ...methods, dispose: logout }
}
