<script setup>
import { computed, ref } from 'vue'
import { api } from './api'
import { MAX_APPROVALS, MAX_NAME_LENGTH, approvalNodes, cloneDefinition, validateDefinition, stepState, stepStateLabel } from './process'

const username = ref('alice'), password = ref(''), me = ref(null)
const people = ref([]), process = ref(null), draft = ref(null), draftBaseline = ref(''), requests = ref([])
const busy = ref(false), publishing = ref(false), error = ref(''), notice = ref(''), tab = ref('requests')
const publishConflict = ref(false)
const title = ref(''), reason = ref(''), days = ref(1)
const selectedId = ref(null), comment = ref('')
let generation = 0, nextStepId = 0
const displayName = value => value?.displayName || value?.name || value?.id || ''
const person = id => displayName(people.value.find(p => p.id === id)) || id || '—'
const selected = computed(() => requests.value.find(r => r.id === selectedId.value))
const pending = computed(() => requests.value.filter(r => r.status === 'PENDING' && r.approverId === me.value?.id))
const visible = computed(() => tab.value === 'inbox' ? pending.value : requests.value)
const approvers = computed(() => people.value.filter(p => ['bob', 'carol'].includes(p.id)))
const history = computed(() => selected.value?.history || [])
const canEdit = computed(() => me.value?.id === 'alice')
const draftDirty = computed(() => !!draft.value && JSON.stringify(draft.value) !== draftBaseline.value)
const draftErrors = computed(() => validateDefinition(draft.value))
const draftApprovals = computed(() => approvalNodes(draft.value))
const publishedApprovals = computed(() => approvalNodes(process.value))
const staleDraft = computed(() => publishConflict.value || draft.value?.version !== process.value?.version)
const selfAssigned = computed(() => publishedApprovals.value.some(node => node.assigneeId === me.value?.id))
const canDecide = computed(() => selected.value?.status === 'PENDING' && !!selected.value?.currentStepId && selected.value?.approverId === me.value?.id)
const currentNode = computed(() => selected.value?.definition?.nodes.find(node => node.id === selected.value.currentStepId))
const followingNode = computed(() => {
  const steps = approvalNodes(selected.value?.definition)
  const index = steps.findIndex(node => node.id === selected.value?.currentStepId)
  return index >= 0 ? steps[index + 1] : null
})
const date = value => value ? new Date(value).toLocaleString() : '—'
const historyLabel = entry => {
  if (['SUBMIT', 'SUBMITTED'].includes(entry.action)) return 'Request submitted'
  const name = selected.value?.definition?.nodes.find(node => node.id === entry.stepId)?.name || 'Approval step'
  return `${name} · ${['APPROVE', 'APPROVED'].includes(entry.action) ? 'approved' : 'rejected'}`
}
function requireValidDefinition(definition) {
  const errors = validateDefinition(definition)
  if (errors.length) throw new Error(`Invalid process template: ${errors.join(' ')}`)
  return definition
}
function loadDraft(definition) {
  draft.value = cloneDefinition(definition)
  draftBaseline.value = JSON.stringify(draft.value)
  publishConflict.value = false
}
function setPublished(definition) {
  const preserveDraft = canEdit.value && draftDirty.value
  process.value = definition
  if (!preserveDraft) loadDraft(definition)
}
async function login() {
  if (busy.value) return
  const current = ++generation
  busy.value = true; error.value = ''; notice.value = ''
  api.login(username.value, password.value); password.value = ''
  try {
    const [identity, list, blueprint, items] = await Promise.all([
      api.request('/me'), api.request('/people'), api.request('/process'), api.request('/requests'),
    ])
    if (generation !== current) return
    requireValidDefinition(blueprint)
    me.value = identity; people.value = list; process.value = blueprint; loadDraft(blueprint); requests.value = items
  } catch (e) { if (generation === current) { api.logout(); error.value = e.message } }
  finally { if (generation === current) busy.value = false }
}
function logout() {
  generation++; api.logout(); me.value = null; people.value = []; process.value = null; draft.value = null; draftBaseline.value = ''; requests.value = []
  selectedId.value = null; title.value = ''; reason.value = ''; days.value = 1; comment.value = ''; password.value = ''
  error.value = ''; notice.value = ''; busy.value = false; publishing.value = false; publishConflict.value = false; tab.value = 'requests'
}
async function refresh() {
  if (busy.value) return
  const current = generation; busy.value = true; error.value = ''; notice.value = ''
  try {
    const [items, blueprint] = await Promise.all([api.request('/requests'), api.request('/process')])
    if (current !== generation) return
    requireValidDefinition(blueprint)
    const previousStep = selected.value?.currentStepId
    requests.value = items; setPublished(blueprint)
    if (previousStep !== selected.value?.currentStepId) comment.value = ''
    notice.value = draftDirty.value
      ? 'Requests and published template refreshed. Your local draft is preserved.'
      : 'Requests and published template refreshed.'
  } catch (e) { if (current === generation) error.value = e.message }
  finally { if (current === generation) busy.value = false }
}
function addStep() {
  if (!canEdit.value || busy.value || draftApprovals.value.length >= MAX_APPROVALS || !draft.value) return
  let id
  do { id = `approval-${++nextStepId}` } while (draft.value.nodes.some(node => node.id === id))
  draft.value.nodes.splice(-1, 0, { id, type: 'approval', name: `Approval ${draftApprovals.value.length + 1}`, assigneeId: 'bob' })
}
function removeStep(id) {
  if (!canEdit.value || busy.value || draftApprovals.value.length <= 1) return
  draft.value.nodes = draft.value.nodes.filter(node => node.type !== 'approval' || node.id !== id)
}
function moveStep(id, direction) {
  if (!canEdit.value || busy.value || ![-1, 1].includes(direction)) return
  const index = draft.value.nodes.findIndex(node => node.id === id)
  const target = index + direction
  if (index < 1 || target < 1 || target >= draft.value.nodes.length - 1) return
  const [node] = draft.value.nodes.splice(index, 1)
  draft.value.nodes.splice(target, 0, node)
}
function resetDraft() {
  if (busy.value || !canEdit.value) return
  loadDraft(process.value); error.value = ''; notice.value = 'Local draft reset to the latest loaded published template.'
}
async function publish() {
  if (busy.value || !canEdit.value || !draftDirty.value || !draft.value) return
  error.value = ''; notice.value = ''
  if (draftErrors.value.length) { error.value = draftErrors.value.join(' '); return }
  if (staleDraft.value) { error.value = 'This draft is out of date. Refresh, then reset to the published template and reapply your changes.'; return }
  const current = generation
  const definition = cloneDefinition(draft.value)
  definition.name = definition.name.trim()
  definition.nodes = definition.nodes.map(node => node.type === 'approval' ? { ...node, name: node.name.trim() } : node)
  busy.value = true; publishing.value = true
  try {
    const published = await api.request('/process', { method: 'POST', body: JSON.stringify({ expectedVersion: definition.version, definition }) })
    if (current !== generation) return
    requireValidDefinition(published)
    process.value = published; loadDraft(published)
    notice.value = `Template v${published.version} published. New requests will use it; existing request snapshots are unchanged.`
  } catch (e) {
    if (current !== generation) return
    if (e.status === 409) {
      publishConflict.value = true
      error.value = `${e.message}. Your draft is preserved. Refresh to load the latest template, then reset and reapply your changes before publishing.`
    } else error.value = `${e.message}. Your draft is preserved. Refresh before retrying if the connection was interrupted.`
  } finally { if (current === generation) { busy.value = false; publishing.value = false } }
}
async function submit() {
  if (busy.value) return
  error.value = ''; notice.value = ''
  if (!title.value.trim() || !reason.value.trim() || !Number.isInteger(Number(days.value)) || Number(days.value) < 1 || Number(days.value) > 365) {
    error.value = 'Enter a title, a reason, and a whole number of days between 1 and 365.'; return
  }
  if (validateDefinition(process.value).length || selfAssigned.value) {
    error.value = selfAssigned.value ? 'You cannot submit a request when the published template assigns an approval step to you.' : 'Refresh to load a valid published template before submitting.'; return
  }
  const current = generation; busy.value = true
  try {
    const item = await api.request('/requests', { method: 'POST', body: JSON.stringify({ title: title.value.trim(), reason: reason.value.trim(), days: Number(days.value), processVersion: process.value.version }) })
    if (current !== generation) return
    requests.value = [item, ...requests.value]; selectedId.value = item.id; tab.value = 'requests'; comment.value = ''
    title.value = ''; reason.value = ''; days.value = 1
    notice.value = `Request submitted. ${person(item.approverId)} can now review the first step.`
  } catch (e) { if (current === generation) error.value = `${e.message}. Refresh requests before retrying if the connection was interrupted or the template changed.` }
  finally { if (current === generation) busy.value = false }
}
async function decide(decision) {
  if (busy.value || !canDecide.value) return
  const current = generation, requestId = selected.value.id, stepId = selected.value.currentStepId
  busy.value = true; error.value = ''; notice.value = ''
  try {
    const item = await api.request(`/requests/${encodeURIComponent(requestId)}/decisions`, { method: 'POST', body: JSON.stringify({ stepId, decision, comment: comment.value.trim() }) })
    if (current !== generation) return
    requests.value = requests.value.map(r => r.id === item.id ? item : r)
    if (selectedId.value === requestId) comment.value = ''
    notice.value = item.status === 'PENDING'
      ? `Step approved. The request is still pending; ${person(item.approverId)} reviews the next step.`
      : `Request ${item.status === 'APPROVED' ? 'approved' : 'rejected'}.`
  } catch (e) { if (current === generation) error.value = `${e.message}. Refresh to check the latest status before retrying.` }
  finally { if (current === generation) busy.value = false }
}
function select(item) { selectedId.value = item.id; comment.value = ''; error.value = '' }
</script>

<template>
  <main v-if="!me" class="login-shell">
    <section class="login-story">
      <div class="wordmark"><span class="logo">a</span> arcflow</div>
      <p class="eyebrow">A SMALL WORKFLOW, END TO END</p><h1>Less chasing.<br>More clarity.</h1>
      <p>Build a clear approval sequence. Follow every request, one decision at a time.</p>
      <div class="story-path"><span>Request</span><b>→</b><span>Reviews</span><b>→</b><span>Outcome</span></div>
      <small>Approval prototype · sequential workflow</small>
    </section>
    <section class="login-panel"><form @submit.prevent="login" class="login-form">
      <p class="eyebrow">WELCOME TO THE DEMO</p><h2>Choose your perspective</h2>
      <p class="muted">Sign in with a demo account and its server-configured password.</p>
      <label>Demo account<select v-model="username" :disabled="busy"><option value="alice">Alice · process designer</option><option value="bob">Bob · approver</option><option value="carol">Carol · approver</option></select></label>
      <label>Password<input v-model="password" name="password" type="password" autocomplete="off" required :disabled="busy"></label>
      <p v-if="error" role="alert" class="error">{{ error }}</p>
      <button class="primary full" :disabled="busy">{{ busy ? 'Signing in…' : 'Enter workspace →' }}</button>
      <p class="footnote">Credentials stay in this tab’s memory. This demonstration is localhost-only; use synthetic data.</p>
    </form></section>
  </main>
  <div v-else class="workspace">
    <aside class="sidebar">
      <div class="wordmark"><span class="logo">a</span> arcflow</div><p class="sidebar-label">WORKSPACE</p>
      <nav aria-label="Main navigation">
        <button :class="{active: tab === 'requests'}" @click="tab = 'requests'">▤ <span>Requests</span></button>
        <button :class="{active: tab === 'inbox'}" @click="tab = 'inbox'">◷ <span>Needs my review</span><b>{{ pending.length }}</b></button>
        <button data-testid="process-tab" :class="{active: tab === 'process'}" @click="tab = 'process'">◇ <span>Process designer</span></button>
      </nav>
      <div class="sidebar-bottom"><span class="avatar">{{ displayName(me).charAt(0) }}</span><div><strong>{{ displayName(me) }}</strong><small>{{ me.id }}</small></div><button class="logout" @click="logout" aria-label="Sign out">↪</button></div>
    </aside>
    <section class="main-area">
      <header class="topbar"><span>Workspace <span class="slash">/</span> Leave approvals</span><span class="prototype">PROTOTYPE</span></header>
      <div class="content">
        <div class="page-heading"><div><p class="eyebrow">KEEP WORK MOVING</p>
          <h1>{{ tab === 'process' ? 'Process designer' : tab === 'inbox' ? 'Needs your review' : 'Leave approvals' }}</h1>
          <p class="muted">{{ tab === 'process' ? 'Arrange a sequence. Assign each review. Publish when ready.' : 'Every request follows its own saved approval sequence.' }}</p>
        </div><button class="secondary" data-testid="refresh" :disabled="busy" @click="refresh">{{ busy ? 'Working…' : '↻ Refresh' }}</button></div>
        <p v-if="error" class="error" role="alert">{{ error }}</p><p v-if="notice" class="notice" role="status">{{ notice }}</p>

        <section v-if="tab === 'process' && draft" class="blueprint card">
          <div class="card-heading"><div><h2>{{ canEdit ? 'Design your approval sequence' : process.name }}</h2><p class="muted">Published v{{ process.version }} · schema v{{ process.schemaVersion }}<template v-if="canEdit"> · Draft based on v{{ draft.version }}</template></p></div><span class="pill">{{ canEdit ? draftDirty ? 'Unpublished changes' : 'Published' : 'Read-only template' }}</span></div>
          <p v-if="!canEdit" class="blueprint-note">Only Alice can edit and publish the process. These are the steps new requests will follow.</p>
          <p v-else class="blueprint-note">Changes stay in this tab until you publish. Existing requests keep their saved sequence. Refresh preserves your unsaved draft.</p>
          <p v-if="canEdit && staleDraft" class="warning" data-testid="stale-draft">A newer version may have been published. Refresh to load it, then reset to the published template and reapply your changes. Your draft is preserved until you reset or sign out.</p>
          <label v-if="canEdit" class="process-name">Process name<input v-model="draft.name" data-testid="process-name" :maxlength="MAX_NAME_LENGTH" :disabled="busy"></label>
          <div class="flow" aria-label="Approval sequence">
            <template v-for="(node, i) in draft.nodes" :key="node.id">
              <div v-if="i" class="connector" aria-hidden="true">↓</div>
              <article class="flow-node" :class="node.type" :data-step-id="node.id">
                <span class="node-icon" aria-hidden="true">{{ node.type === 'start' ? '↗' : node.type === 'approval' ? i : '●' }}</span>
                <div class="node-content">
                  <small>{{ node.type === 'approval' ? `APPROVAL ${i}` : `${node.type.toUpperCase()} · FIXED` }}</small>
                  <template v-if="node.type === 'approval' && canEdit">
                    <label>Step name<input v-model="node.name" :aria-label="`Step ${i} name`" :maxlength="MAX_NAME_LENGTH" :disabled="busy"></label>
                    <label>Assigned approver<select v-model="node.assigneeId" :aria-label="`Step ${i} approver`" :disabled="busy"><option v-for="p in approvers" :key="p.id" :value="p.id">{{ displayName(p) }}</option></select></label>
                    <div class="step-controls">
                      <button type="button" class="secondary" :aria-label="`Move step ${i} up`" :disabled="busy || i === 1" @click="moveStep(node.id, -1)">↑ Up</button>
                      <button type="button" class="secondary" :aria-label="`Move step ${i} down`" :disabled="busy || i === draft.nodes.length - 2" @click="moveStep(node.id, 1)">↓ Down</button>
                      <button type="button" class="remove-step" :aria-label="`Remove step ${i}`" :disabled="busy || draftApprovals.length <= 1" @click="removeStep(node.id)">Remove</button>
                    </div>
                  </template>
                  <template v-else><h3>{{ node.name }}</h3><p>{{ node.type === 'start' ? 'Applicant provides leave details' : node.type === 'approval' ? `Assigned to ${person(node.assigneeId)}` : 'All approval steps complete' }}</p></template>
                </div>
              </article>
            </template>
          </div>
          <template v-if="canEdit">
            <div class="designer-add"><button type="button" class="secondary" data-testid="add-step" :disabled="busy || draftApprovals.length >= MAX_APPROVALS" @click="addStep">+ Add approval step</button><span>{{ draftApprovals.length }} of {{ MAX_APPROVALS }} steps · repeated approvers allowed</span></div>
            <ul v-if="draftErrors.length" class="validation-list" aria-label="Draft validation"><li v-for="message in draftErrors" :key="message">{{ message }}</li></ul>
            <div class="designer-footer"><p>Start and end stay fixed. Steps run from top to bottom; a rejection ends the request.</p><div><button type="button" class="secondary" data-testid="reset-draft" :disabled="busy || (!draftDirty && !staleDraft)" @click="resetDraft">Reset to published</button><button type="button" class="primary" data-testid="publish" :disabled="busy || !draftDirty || !!draftErrors.length || staleDraft" @click="publish">{{ publishing ? 'Publishing…' : 'Publish template' }}</button></div></div>
          </template>
          <details><summary>Inspect {{ canEdit ? 'local draft' : 'published process' }} JSON</summary><pre>{{ JSON.stringify(draft, null, 2) }}</pre></details>
        </section>

        <div v-else-if="tab !== 'process'" class="columns">
          <section class="request-column">
            <form v-if="tab === 'requests'" class="card new-request" @submit.prevent="submit">
              <div class="card-heading"><div><p class="eyebrow">START HERE</p><h2>New leave request</h2></div><span class="small-icon">↗</span></div>
              <div class="submission-template" data-testid="submission-template"><strong>{{ process?.name }} · v{{ process?.version }}</strong><p>{{ publishedApprovals.map(node => `${node.name} (${person(node.assigneeId)})`).join(' → ') }}</p><small>The published template is saved with your request.<template v-if="draftDirty"> Your unpublished draft is not used.</template></small></div>
              <p v-if="selfAssigned" class="warning">You cannot submit: this template includes an approval assigned to you. Ask Alice to publish a sequence without you before submitting.</p>
              <label>Title<input v-model="title" maxlength="120" placeholder="e.g. Annual leave · October" required :disabled="busy"></label>
              <label>Days<input v-model="days" type="number" min="1" max="365" step="1" required :disabled="busy"></label>
              <label>Reason<textarea v-model="reason" maxlength="2000" rows="3" placeholder="Add context for your approvers…" required :disabled="busy"></textarea></label>
              <div class="form-footer"><span>Sent as {{ displayName(me) }}</span><button class="primary" :disabled="busy || selfAssigned || !process">{{ busy ? 'Working…' : 'Submit request' }}</button></div>
            </form>
            <section class="card request-list"><div class="card-heading"><h2>{{ tab === 'inbox' ? 'Pending decisions' : 'Your visible requests' }}</h2><span class="count">{{ visible.length }}</span></div>
              <p v-if="!visible.length" class="empty">{{ tab === 'inbox' ? 'You’re all caught up. No requests need your review.' : 'No requests yet. Start with the form above.' }}</p>
              <button v-for="item in visible" :key="item.id" class="request-item" :class="{selected: selectedId === item.id}" @click="select(item)"><span class="request-glyph">▤</span><span class="request-summary"><strong>{{ item.title }}</strong><small>{{ person(item.applicantId) }} · {{ item.days }} {{ item.days === 1 ? 'day' : 'days' }}<template v-if="item.status === 'PENDING'"> · Awaiting {{ person(item.approverId) }}</template></small></span><span class="status" :class="item.status.toLowerCase()">{{ item.status.toLowerCase() }}</span></button>
            </section>
          </section>
          <aside class="detail card">
            <template v-if="selected">
              <div class="card-heading"><p class="eyebrow">REQUEST DETAILS</p><span class="status" :class="selected.status.toLowerCase()">{{ selected.status.toLowerCase() }}</span></div>
              <h2>{{ selected.title }}</h2><p class="detail-reason">{{ selected.reason }}</p>
              <dl><div><dt>Applicant</dt><dd>{{ person(selected.applicantId) }}</dd></div><div><dt>{{ selected.status === 'PENDING' ? 'Current approver' : 'Last approver' }}</dt><dd>{{ person(selected.approverId) }}</dd></div><div><dt>Duration</dt><dd>{{ selected.days }} days</dd></div><div><dt>Saved process</dt><dd>{{ selected.processId }} · v{{ selected.processVersion }}</dd></div></dl>
              <section class="instance-snapshot" data-testid="instance-snapshot">
                <h3>Saved approval sequence</h3><p class="footnote">{{ selected.definition?.name }} · v{{ selected.definition?.version }} · Read-only snapshot from submission</p>
                <ol class="snapshot-steps"><li v-for="node in selected.definition?.nodes" :key="node.id" :class="stepState(selected, node)" :data-step-id="node.id"><span class="snapshot-dot" aria-hidden="true"></span><div><strong>{{ node.name }}</strong><small v-if="node.type === 'approval'">{{ person(node.assigneeId) }}</small></div><span class="step-state">{{ stepStateLabel(stepState(selected, node)) }}</span></li></ol>
                <p v-if="selected.status === 'PENDING'" class="next-step"><strong>Now:</strong> {{ currentNode?.name }} · {{ person(selected.approverId) }}<br><template v-if="followingNode"><strong>Next:</strong> {{ followingNode.name }} · {{ person(followingNode.assigneeId) }}</template><template v-else>Final approval step</template></p>
              </section>
              <h3 class="history-heading">Activity</h3><ol class="timeline"><li v-for="(entry, index) in history" :key="index"><strong>{{ historyLabel(entry) }}</strong><p>{{ person(entry.actorId) }}</p><small>{{ date(entry.at) }}</small><p v-if="entry.comment" class="decision-comment">{{ entry.comment }}</p></li><li v-if="selected.status === 'PENDING'" class="waiting"><strong>Awaiting review · {{ currentNode?.name }}</strong><p>{{ person(selected.approverId) }}</p></li></ol>
              <form v-if="canDecide" @submit.prevent="decide('APPROVE')" class="decision-form"><p class="decision-context">Reviewing: <strong>{{ currentNode?.name }}</strong></p><label>Decision comment <span class="muted">(optional)</span><textarea v-model="comment" maxlength="2000" rows="3" :disabled="busy"></textarea></label><div class="decision-actions"><button type="button" class="danger" :disabled="busy" @click="decide('REJECT')">Reject request</button><button class="primary" :disabled="busy">{{ followingNode ? 'Approve step' : 'Approve request' }}</button></div></form>
              <p v-else-if="selected.status === 'PENDING'" class="footnote">Only the designated approver for the current step can record a decision.</p>
              <details class="snapshot-json"><summary>Inspect saved snapshot JSON</summary><pre>{{ JSON.stringify(selected.definition, null, 2) }}</pre></details><small class="request-id">{{ selected.id }}</small>
            </template>
            <div v-else class="detail-empty"><span>◷</span><h2>The full picture</h2><p>Select a request to see its details,<br>approval sequence, and activity.</p></div>
          </aside>
        </div>
        <footer class="page-footer">Arcflow approval example <span>Local JSON snapshot · synthetic data only</span></footer>
      </div>
    </section>
  </div>
</template>
