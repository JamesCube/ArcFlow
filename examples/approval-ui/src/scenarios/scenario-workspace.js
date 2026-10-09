import { reactive, shallowRef } from 'vue'
import { newSubmissionKey, isRejectedSubmissionVersion } from '../submission-intent.js'
import { cloneDefinition, validateDefinition, validatePublicationResponse, pendingParticipants, participants, approvalNodes } from '../process.js'
import { TEMPLATE_ID, InvalidScenarioPayload, invalid, same } from './expense-document.js'
import { validateScenarioCatalog } from './scenario-template.js'
import { getScenarioHandler, scenarioHandlers } from './scenario-registry.js'
// Each registered scenario owns its state and pending intent. Async continuations
// close over that scope, while a single session generation invalidates every scope.
export function createScenarioWorkspace(api, keyFactory = newSubmissionKey, initialTemplateId = TEMPLATE_ID) {
  getScenarioHandler(initialTemplateId)
  let navigation = 0, generation = 0, loginBusy = false
  // Replacing actor-owned scopes must invalidate every derived reader even when
  // activeId remains the default scenario across logout and the next login.
  // A plain closure map leaves computed detail/summary readers on old scopes.
  const scopes = shallowRef({})
  const state = reactive({ me: null, people: [], catalog: [], activeId: initialTemplateId, catalogOpen: true })
  const session = { state, generation: () => generation, navigation: () => navigation, logout }
  function initialize() {
    scopes.value = Object.fromEntries(Object.keys(scenarioHandlers).map(id => [id, createScope(api, keyFactory, id, session)]))
  }
  Object.defineProperty(state, 'scopes', { get: () => Object.fromEntries(Object.entries(scopes.value).map(([id, scope]) => [id, scope.state])) })
  Object.defineProperty(state, 'activeScenarioId', { enumerable: true, get: () => state.activeId })
  initialize()
  const active = () => scopes.value[state.activeId]
  for (const key of Object.keys(active().state).filter(key => !['me', 'people', 'catalog', 'tab'].includes(key))) {
    Object.defineProperty(state, key, { enumerable: true, configurable: true,
      get: () => key === 'busy' ? loginBusy || active().state.busy : active().state[key],
      set: value => { active().state[key] = value },
    })
  }
  Object.defineProperty(state, 'tab', { enumerable: true, configurable: true,
    get: () => state.catalogOpen ? 'catalog' : active().state.tab,
    set: value => { navigation++; state.catalogOpen = value === 'catalog'; if (value !== 'catalog') active().state.tab = value },
  })
  function logout() {
    generation++; api.logout(); loginBusy = false
    state.me = null; state.people = []; state.catalog = []; state.activeId = initialTemplateId; state.catalogOpen = true
    initialize()
  }
  async function login(username, password) {
    if (loginBusy || state.busy) return
    logout(); const current = ++generation; loginBusy = true; state.busy = true; api.login(username, password)
    try {
      const base = `/scenarios/${initialTemplateId}`
      const [me, people, catalog, process, items] = await Promise.all([api.request('/me'), api.request('/people'), api.request('/scenarios'), api.request(`${base}/process`), api.request(`${base}/requests`)])
      if (current !== generation) return
      if (!['alice', 'bob', 'carol'].includes(me?.id) || !Array.isArray(people) || people.some(person => !['alice', 'bob', 'carol'].includes(person?.id)) || new Set(people.map(person => person.id)).size !== 3) invalid()
      validateScenarioCatalog(catalog); active().hydrate(process, items)
      state.me = me; state.people = people; state.catalog = catalog
    } catch (cause) { if (current === generation) { logout(); state.error = { cause, operation: 'login' } } }
    finally { if (current === generation) { loginBusy = false; state.busy = false } }
  }
  async function activate(id) {
    getScenarioHandler(id)
    if (!state.me || typeof id !== 'string' || !state.catalog.some(template => template.id === id)) return
    navigation++; state.activeId = id; state.catalogOpen = false
    if (!active().state.process) await active().refresh()
  }
  async function selectScenario(id, tab = 'new') {
    getScenarioHandler(id)
    if (!state.me || !state.catalog.some(template => template.id === id)) return
    const loading = activate(id)
    state.tab = tab
    await loading
  }
  const workspace = { state, login, logout, activate, selectScenario, dispose: logout, scopeFor: id => scopes.value[id] }
  for (const method of ['refresh', 'publish', 'submit', 'decide', 'canDecide', 'dirty', 'stale', 'setForm', 'select', 'resetDraft', 'retainedNotesFor', 'dismissRetainedNote', 'submissionDefinition']) {
    workspace[method] = (...args) => active()[method](...args)
  }
  return workspace
}
function createScope(api, keyFactory, id, session) {
  let intent = null
  const handler = getScenarioHandler(id), base = `/scenarios/${id}`
  const fingerprint = business => { try { return JSON.stringify(handler.normalize(business)) } catch { return JSON.stringify(business) } }
  const definition = value => { if (validateDefinition(value, id).length || value.version > 2147483647) invalid(); return value }
  const state = reactive({ process: null, draft: null, baseline: '', items: [], form: handler.createDraft(keyFactory), attempted: false, busy: false, publishing: false, error: null, notice: '', tab: 'new', selectedId: null, comment: '', retainedNotes: {}, conflict: false, blockedDecisions: [], uncertainSubmission: false, rejectedVersion: false, loaded: false })
  Object.defineProperty(state, 'me', { get: () => session.state.me })
  const dirty = () => !!state.draft && JSON.stringify(state.draft) !== state.baseline
  const stale = () => state.conflict || state.draft?.version !== state.process?.version
  const resetDraft = () => { state.draft = cloneDefinition(state.process); state.baseline = JSON.stringify(state.draft); state.conflict = false }
  const setPublished = value => {
    definition(value)
    if (state.process && (value.version < state.process.version || (value.version === state.process.version && !same(value, state.process)))) invalid()
    const preserve = dirty(); state.process = value; if (!preserve) resetDraft()
  }
  function failure(cause, operation) {
    if (cause?.status === 401) { session.logout(); session.state.error = { cause, operation }; return }
    state.error = { cause, operation }
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
  function select(id) { if (state.selectedId !== id) { state.selectedId = id; state.comment = '' } }
  const noteKey = (id, stepId) => JSON.stringify([id, stepId])
  const retainedNotesFor = id => Object.values(state.retainedNotes).filter(note => note.requestId === id)
  const dismissRetainedNote = (id, stepId) => { delete state.retainedNotes[noteKey(id, stepId)] }
  async function refresh() {
    if (state.busy || !state.me) return
    const current = session.generation(), selectedStep = state.items.find(view => view.request.id === state.selectedId)?.request.currentStepId
    state.busy = true; state.error = null; state.notice = ''
    try {
      const [process, items] = await Promise.all([api.request(`${base}/process`), api.request(`${base}/requests`)])
      if (current !== session.generation()) return
      definition(process); handler.validateList(items)
      const confirmed = items.filter(remember).map(view => view.request.id); setPublished(process)
      state.blockedDecisions = state.blockedDecisions.filter(id => !confirmed.includes(id))
      if (selectedStep !== state.items.find(view => view.request.id === state.selectedId)?.request.currentStepId) state.comment = ''
      if (state.rejectedVersion) { intent = null; state.rejectedVersion = false; state.uncertainSubmission = false }
      state.loaded = true; state.notice = 'refreshed'
    } catch (cause) { if (current === session.generation()) failure(cause, 'refresh') }
    finally { if (current === session.generation()) state.busy = false }
  }
  async function publish() {
    if (state.busy || state.me?.id !== 'alice' || !dirty() || stale() || validateDefinition(state.draft, id).length) return
    const current = session.generation(), submitted = cloneDefinition(state.draft)
    submitted.name = submitted.name.trim(); submitted.nodes = submitted.nodes.map(node => ({ ...node, name: node.name.trim() }))
    state.busy = true; state.publishing = true; state.error = null; state.notice = ''
    try {
      const published = await api.request(`${base}/process`, { method: 'POST', body: JSON.stringify({ expectedVersion: submitted.version, definition: submitted }) })
      if (current !== session.generation()) return
      validatePublicationResponse(published, submitted, id); definition(published); state.process = published; resetDraft(); state.notice = 'published'
    } catch (cause) { if (current === session.generation()) { state.conflict = true; failure(cause, 'publish') } }
    finally { if (current === session.generation()) { state.busy = false; state.publishing = false } }
  }
  async function submit() {
    if (state.busy || !state.me || state.rejectedVersion) return
    state.attempted = true; state.error = null; state.notice = ''
    if (handler.errors(state.form).length) { state.error = { operation: 'validation' }; return }
    const pinned = intent?.definition || state.process
    if (validateDefinition(pinned, id).length || approvalNodes(pinned).some(node => participants(node).includes(state.me.id))) { state.error = { operation: 'selfAssigned' }; return }
    const current = session.generation(), navigation = session.navigation(); state.busy = true
    try {
      if (!intent) intent = { key: keyFactory(), actor: state.me.id, fingerprint: fingerprint(state.form), payload: { business: handler.normalize(state.form), processVersion: state.process.version }, definition: cloneDefinition(state.process) }
      const attempt = intent
      const view = await api.request(`${base}/documents`, { method: 'POST', headers: { 'Idempotency-Key': attempt.key }, body: handler.serialize(attempt.payload) })
      if (current !== session.generation()) return
      handler.validateView(view, attempt); remember(view)
      intent = null; state.uncertainSubmission = false; state.rejectedVersion = false; state.form = handler.createDraft(keyFactory); state.attempted = false
      if (navigation === session.navigation() && session.state.activeId === id) {
        session.state.catalogOpen = false; state.tab = 'mine'; select(view.request.id)
      }
      state.notice = 'submitted'
    } catch (cause) { if (current === session.generation()) { state.rejectedVersion = isRejectedSubmissionVersion(cause); state.uncertainSubmission = !state.rejectedVersion; failure(cause, 'submit') } }
    finally { if (current === session.generation()) state.busy = false }
  }
  function canDecide(view) { return !!view && !state.blockedDecisions.includes(view.request.id) && pendingParticipants(view.request).includes(state.me?.id) }
  async function decide(decision) {
    const original = state.items.find(view => view.request.id === state.selectedId)
    if (state.busy || !['APPROVE', 'REJECT'].includes(decision) || !canDecide(original) || state.comment.length > 2000) return
    const current = session.generation(), id = original.request.id, stepId = original.request.currentStepId, actor = state.me.id, typedComment = state.comment, submittedComment = state.comment.trim()
    state.busy = true; state.error = null; state.notice = ''
    try {
      const view = await api.request(`${base}/requests/${encodeURIComponent(id)}/decisions`, { method: 'POST', body: JSON.stringify({ stepId, decision, comment: submittedComment }) })
      if (current !== session.generation()) return
      handler.validateDecision(view, original, actor, stepId, decision, submittedComment); remember(view)
      dismissRetainedNote(id, stepId)
      if (state.selectedId === id) state.comment = ''
      state.notice = 'decided'
    } catch (cause) {
      if (current !== session.generation()) return
      state.blockedDecisions = [...new Set([...state.blockedDecisions, id])]
      if (typedComment) state.retainedNotes[noteKey(id, stepId)] = { requestId: id, stepId, comment: typedComment }
      failure(cause, 'decision')
      // A different acknowledged comment is not this submitted decision. Keep
      // the typed note and require explicit audit refresh; do not silently
      // clear it via automatic recovery, including an idempotent old vote.
      if (current !== session.generation() || cause?.code === 'DECISION_COMMENT_MISMATCH') return
      try {
        const response = await api.request(`${base}/requests`)
        if (current !== session.generation()) return
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
      } catch (recoveryError) { if (current === session.generation() && recoveryError?.status === 401) failure(recoveryError, 'decision') }
    } finally { if (current === session.generation()) state.busy = false }
  }
  return { state, refresh, publish, submit, decide, canDecide, dirty, stale, setForm, select, resetDraft, retainedNotesFor, dismissRetainedNote, hydrate(process, items) { definition(process); handler.validateList(items); state.process = process; state.items = items; state.loaded = true; resetDraft() }, submissionDefinition: () => intent?.definition || state.process }
}
