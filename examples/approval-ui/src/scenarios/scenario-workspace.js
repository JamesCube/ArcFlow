import { reactive } from 'vue'
import { newSubmissionKey, isRejectedSubmissionVersion } from '../submission-intent.js'
import { cloneDefinition, validateDefinition, validatePublicationResponse, pendingParticipants, participants, approvalNodes } from '../process.js'
import { TEMPLATE_ID, emptyExpense, expenseErrors, normalizeExpense, serializeExpensePayload, InvalidScenarioPayload, invalid, same } from './expense-document.js'
import { validateScenarioCatalog } from './scenario-template.js'
import { validateScenarioList, validateScenarioView, validateScenarioDecision } from './scenario-response.js'
const base = `/scenarios/${TEMPLATE_ID}`
const fingerprint = business => { try { return JSON.stringify(normalizeExpense(business)) } catch { return JSON.stringify(business) } }
const definition = value => { if (validateDefinition(value, TEMPLATE_ID).length || value.version > 2147483647) invalid(); return value }
export function createScenarioWorkspace(api, keyFactory = newSubmissionKey) {
  let generation = 0, intent = null
  const state = reactive({ me: null, people: [], catalog: [], process: null, draft: null, baseline: '', items: [], form: emptyExpense(keyFactory), attempted: false, busy: false, publishing: false, error: null, notice: '', tab: 'catalog', selectedId: null, comment: '', retainedNotes: {}, conflict: false, blockedDecisions: [], uncertainSubmission: false, rejectedVersion: false })
  const dirty = () => !!state.draft && JSON.stringify(state.draft) !== state.baseline
  const stale = () => state.conflict || state.draft?.version !== state.process?.version
  const resetDraft = () => { state.draft = cloneDefinition(state.process); state.baseline = JSON.stringify(state.draft); state.conflict = false }
  const setPublished = value => {
    definition(value)
    if (state.process && (value.version < state.process.version || (value.version === state.process.version && !same(value, state.process)))) invalid()
    const preserve = dirty(); state.process = value; if (!preserve) resetDraft()
  }
  function logout() {
    generation++; api.logout(); intent = null
    Object.assign(state, { me: null, people: [], catalog: [], process: null, draft: null, baseline: '', items: [], form: emptyExpense(keyFactory), attempted: false, busy: false, publishing: false, error: null, notice: '', tab: 'catalog', selectedId: null, comment: '', retainedNotes: {}, conflict: false, blockedDecisions: [], uncertainSubmission: false, rejectedVersion: false })
  }
  function failure(cause, operation) { if (cause?.status === 401) logout(); state.error = { cause, operation } }
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
  async function login(username, password) {
    if (state.busy) return
    // Identity changes always discard actor-scoped records and unresolved keys.
    logout()
    const current = ++generation; state.busy = true; state.error = null; api.login(username, password)
    try {
      const [me, people, catalog, process, items] = await Promise.all([api.request('/me'), api.request('/people'), api.request('/scenarios'), api.request(`${base}/process`), api.request(`${base}/requests`)])
      if (current !== generation) return
      if (!['alice', 'bob', 'carol'].includes(me?.id) || !Array.isArray(people) || people.some(person => !['alice', 'bob', 'carol'].includes(person?.id)) || new Set(people.map(person => person.id)).size !== 3) invalid()
      validateScenarioCatalog(catalog); definition(process); validateScenarioList(items)
      state.me = me; state.people = people; state.catalog = catalog; state.process = process; state.items = items; resetDraft()
    } catch (cause) { if (current === generation) { api.logout(); failure(cause, 'login') } }
    finally { if (current === generation) state.busy = false }
  }
  async function refresh() {
    if (state.busy || !state.me) return
    const current = generation, selectedStep = state.items.find(view => view.request.id === state.selectedId)?.request.currentStepId
    state.busy = true; state.error = null; state.notice = ''
    try {
      const [process, items] = await Promise.all([api.request(`${base}/process`), api.request(`${base}/requests`)])
      if (current !== generation) return
      definition(process); validateScenarioList(items)
      const confirmed = items.filter(remember).map(view => view.request.id); setPublished(process)
      state.blockedDecisions = state.blockedDecisions.filter(id => !confirmed.includes(id))
      if (selectedStep !== state.items.find(view => view.request.id === state.selectedId)?.request.currentStepId) state.comment = ''
      if (state.rejectedVersion) { intent = null; state.rejectedVersion = false; state.uncertainSubmission = false }
      state.notice = 'refreshed'
    } catch (cause) { if (current === generation) failure(cause, 'refresh') }
    finally { if (current === generation) state.busy = false }
  }
  async function publish() {
    if (state.busy || state.me?.id !== 'alice' || !dirty() || stale() || validateDefinition(state.draft, TEMPLATE_ID).length) return
    const current = generation, submitted = cloneDefinition(state.draft)
    submitted.name = submitted.name.trim(); submitted.nodes = submitted.nodes.map(node => ({ ...node, name: node.name.trim() }))
    state.busy = true; state.publishing = true; state.error = null; state.notice = ''
    try {
      const published = await api.request(`${base}/process`, { method: 'POST', body: JSON.stringify({ expectedVersion: submitted.version, definition: submitted }) })
      if (current !== generation) return
      validatePublicationResponse(published, submitted, TEMPLATE_ID); definition(published); state.process = published; resetDraft(); state.notice = 'published'
    } catch (cause) { if (current === generation) { state.conflict = true; failure(cause, 'publish') } }
    finally { if (current === generation) { state.busy = false; state.publishing = false } }
  }
  async function submit() {
    if (state.busy || !state.me || state.rejectedVersion) return
    state.attempted = true; state.error = null; state.notice = ''
    if (expenseErrors(state.form).length) { state.error = { operation: 'validation' }; return }
    const pinned = intent?.definition || state.process
    if (validateDefinition(pinned, TEMPLATE_ID).length || approvalNodes(pinned).some(node => participants(node).includes(state.me.id))) { state.error = { operation: 'selfAssigned' }; return }
    const current = generation; state.busy = true
    try {
      if (!intent) intent = { key: keyFactory(), actor: state.me.id, fingerprint: fingerprint(state.form), payload: { business: normalizeExpense(state.form), processVersion: state.process.version }, definition: cloneDefinition(state.process) }
      const attempt = intent
      const view = await api.request(`${base}/documents`, { method: 'POST', headers: { 'Idempotency-Key': attempt.key }, body: serializeExpensePayload(attempt.payload) })
      if (current !== generation) return
      validateScenarioView(view, attempt); remember(view)
      intent = null; state.uncertainSubmission = false; state.rejectedVersion = false; state.form = emptyExpense(keyFactory); state.attempted = false
      state.tab = 'mine'; select(view.request.id); state.notice = 'submitted'
    } catch (cause) { if (current === generation) { state.rejectedVersion = isRejectedSubmissionVersion(cause); state.uncertainSubmission = !state.rejectedVersion; failure(cause, 'submit') } }
    finally { if (current === generation) state.busy = false }
  }
  function canDecide(view) { return !!view && !state.blockedDecisions.includes(view.request.id) && pendingParticipants(view.request).includes(state.me?.id) }
  async function decide(decision) {
    const original = state.items.find(view => view.request.id === state.selectedId)
    if (state.busy || !['APPROVE', 'REJECT'].includes(decision) || !canDecide(original) || state.comment.length > 2000) return
    const current = generation, id = original.request.id, stepId = original.request.currentStepId, actor = state.me.id, typedComment = state.comment, submittedComment = state.comment.trim()
    state.busy = true; state.error = null; state.notice = ''
    try {
      const view = await api.request(`${base}/requests/${encodeURIComponent(id)}/decisions`, { method: 'POST', body: JSON.stringify({ stepId, decision, comment: submittedComment }) })
      if (current !== generation) return
      validateScenarioDecision(view, original, actor, stepId, decision, submittedComment); remember(view)
      dismissRetainedNote(id, stepId)
      if (state.selectedId === id) state.comment = ''
      state.notice = 'decided'
    } catch (cause) {
      if (current !== generation) return
      state.blockedDecisions = [...new Set([...state.blockedDecisions, id])]
      if (typedComment) state.retainedNotes[noteKey(id, stepId)] = { requestId: id, stepId, comment: typedComment }
      failure(cause, 'decision')
      // A different acknowledged comment is not this submitted decision. Keep
      // the typed note and require explicit audit refresh; do not silently
      // clear it via automatic recovery, including an idempotent old vote.
      if (current !== generation || cause?.code === 'DECISION_COMMENT_MISMATCH') return
      try {
        const response = await api.request(`${base}/requests`)
        if (current !== generation) return
        const items = validateScenarioList(response), confirmed = items.filter(remember).map(view => view.request.id)
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
      } catch (recoveryError) { if (current === generation && recoveryError?.status === 401) failure(recoveryError, 'decision') }
    } finally { if (current === generation) state.busy = false }
  }
  return { state, login, logout, refresh, publish, submit, decide, canDecide, dirty, stale, setForm, select, resetDraft, retainedNotesFor, dismissRetainedNote, dispose: logout, submissionDefinition: () => intent?.definition || state.process }
}
