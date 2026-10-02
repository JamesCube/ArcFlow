<script setup>
import { computed, ref } from 'vue'
import { api } from './api'
const username = ref('alice'), password = ref(''), me = ref(null)
const people = ref([]), process = ref(null), requests = ref([])
const busy = ref(false), error = ref(''), notice = ref(''), tab = ref('requests')
const title = ref(''), reason = ref(''), days = ref(1), approverId = ref('bob')
const selectedId = ref(null), comment = ref('')
let generation = 0
const person = id => people.value.find(p => p.id === id)?.displayName || id
const selected = computed(() => requests.value.find(r => r.id === selectedId.value))
const pending = computed(() => requests.value.filter(r => r.status === 'PENDING' && r.approverId === me.value?.id))
const visible = computed(() => tab.value === 'inbox' ? pending.value : requests.value)
const approvers = computed(() => people.value.filter(p => ['bob', 'carol'].includes(p.id) && p.id !== me.value?.id))
const history = computed(() => selected.value?.history || [])
const actionLabel = action => ({ SUBMIT: 'Request submitted', SUBMITTED: 'Request submitted', APPROVED: 'Approved', REJECTED: 'Rejected', APPROVE: 'Approved', REJECT: 'Rejected' })[action] || action
const canDecide = computed(() => selected.value?.status === 'PENDING' && selected.value?.approverId === me.value?.id)
const date = value => value ? new Date(value).toLocaleString() : '—'
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
    me.value = identity; people.value = list; process.value = blueprint; requests.value = items
    approverId.value = list.find(p => ['bob', 'carol'].includes(p.id) && p.id !== identity.id)?.id || ''
  } catch (e) { if (generation === current) { api.logout(); error.value = e.message } }
  finally { if (generation === current) busy.value = false }
}
function logout() {
  generation++; api.logout(); me.value = null; people.value = []; process.value = null; requests.value = []
  selectedId.value = null; title.value = ''; reason.value = ''; days.value = 1; comment.value = ''; password.value = ''
  error.value = ''; notice.value = ''; busy.value = false; tab.value = 'requests'
}
async function refresh() {
  if (busy.value) return
  const current = generation; busy.value = true; error.value = ''
  try { const items = await api.request('/requests'); if (current === generation) requests.value = items }
  catch (e) { if (current === generation) error.value = e.message }
  finally { if (current === generation) busy.value = false }
}
async function submit() {
  if (busy.value) return
  const current = generation; busy.value = true; error.value = ''; notice.value = ''
  try {
    const item = await api.request('/requests', { method: 'POST', body: JSON.stringify({ title: title.value.trim(), reason: reason.value.trim(), days: Number(days.value), approverId: approverId.value }) })
    if (current !== generation) return
    requests.value = [item, ...requests.value]; selectedId.value = item.id; tab.value = 'requests'
    title.value = ''; reason.value = ''; days.value = 1; notice.value = 'Request submitted. Your approver can now review it.'
  } catch (e) { if (current === generation) error.value = `${e.message}. Refresh requests before retrying if the connection was interrupted.` }
  finally { if (current === generation) busy.value = false }
}
async function decide(decision) {
  if (busy.value || !canDecide.value) return
  const current = generation; busy.value = true; error.value = ''; notice.value = ''
  try {
    const item = await api.request(`/requests/${encodeURIComponent(selected.value.id)}/decisions`, { method: 'POST', body: JSON.stringify({ decision, comment: comment.value.trim() }) })
    if (current !== generation) return
    requests.value = requests.value.map(r => r.id === item.id ? item : r); comment.value = ''; notice.value = `Request ${decision === 'APPROVE' ? 'approved' : 'rejected'}.`
  } catch (e) { if (current === generation) error.value = `${e.message}. Refresh to check the latest status.` }
  finally { if (current === generation) busy.value = false }
}
function select(item) { selectedId.value = item.id; comment.value = ''; error.value = '' }
</script>

<template>
  <main v-if="!me" class="login-shell">
    <section class="login-story"><div class="wordmark"><span class="logo">a</span> arcflow</div><p class="eyebrow">A SMALL WORKFLOW, END TO END</p><h1>Less chasing.<br>More clarity.</h1><p>One leave request. One designated approver. A clear record of what happened.</p><div class="story-path"><span>Request</span><b>→</b><span>Review</span><b>→</b><span>Decision</span></div><small>Approval prototype · sequential workflow</small></section>
    <section class="login-panel"><form @submit.prevent="login" class="login-form"><p class="eyebrow">WELCOME TO THE DEMO</p><h2>Choose your perspective</h2><p class="muted">Sign in with a demo account and its server-configured password.</p><label>Demo account<select v-model="username" :disabled="busy"><option value="alice">Alice · applicant</option><option value="bob">Bob · approver</option><option value="carol">Carol · approver</option></select></label><label>Password<input v-model="password" name="password" type="password" autocomplete="off" required :disabled="busy"></label><p v-if="error" role="alert" class="error">{{ error }}</p><button class="primary full" :disabled="busy">{{ busy ? 'Signing in…' : 'Enter workspace →' }}</button><p class="footnote">Credentials stay in this tab’s memory. This demonstration is localhost-only; use synthetic data.</p></form></section>
  </main>
  <div v-else class="workspace">
    <aside class="sidebar"><div class="wordmark"><span class="logo">a</span> arcflow</div><p class="sidebar-label">WORKSPACE</p><nav aria-label="Main navigation"><button :class="{active: tab === 'requests'}" @click="tab = 'requests'">▤ <span>Requests</span></button><button :class="{active: tab === 'inbox'}" @click="tab = 'inbox'">◷ <span>Needs my review</span><b>{{ pending.length }}</b></button><button :class="{active: tab === 'process'}" @click="tab = 'process'">◇ <span>Process blueprint</span></button></nav><div class="sidebar-bottom"><span class="avatar">{{ me.displayName?.charAt(0) }}</span><div><strong>{{ me.displayName }}</strong><small>{{ me.id }}</small></div><button class="logout" @click="logout" aria-label="Sign out">↪</button></div></aside>
    <section class="main-area"><header class="topbar"><span>Workspace <span class="slash">/</span> Leave approvals</span><span class="prototype">PROTOTYPE</span></header><div class="content"><div class="page-heading"><div><p class="eyebrow">KEEP WORK MOVING</p><h1>{{ tab === 'process' ? 'Process blueprint' : tab === 'inbox' ? 'Needs your review' : 'Leave approvals' }}</h1><p class="muted">{{ tab === 'process' ? 'A versioned, sequential template with a single approval step.' : 'Every request has an owner, an approver, and a visible outcome.' }}</p></div><button class="secondary" :disabled="busy" @click="refresh">{{ busy ? 'Working…' : '↻ Refresh' }}</button></div><p v-if="error" class="error" role="alert">{{ error }}</p><p v-if="notice" class="notice" role="status">{{ notice }}</p>
    <section v-if="tab === 'process'" class="blueprint card"><div class="card-heading"><div><h2>{{ process?.name }}</h2><p class="muted">Template v{{ process?.version }} · schema v{{ process?.schemaVersion }}</p></div><span class="pill">Read-only template</span></div><div class="flow"><template v-for="(node, i) in process?.nodes" :key="node.id"><div v-if="i" class="connector">↓</div><article class="flow-node" :class="node.type"><span class="node-icon">{{ node.type === 'start' ? '↗' : node.type === 'approval' ? '✓' : '●' }}</span><div><small>{{ node.type.toUpperCase() }}</small><h3>{{ node.name }}</h3><p>{{ node.type === 'start' ? 'Applicant provides leave details' : node.type === 'approval' ? 'Designated reviewer approves or rejects' : 'Outcome recorded with history' }}</p></div></article></template></div><p class="blueprint-note">This prototype supports this fixed sequence. The process definition is versioned; visual layout is separate from execution semantics. Approver selection happens when submitting a request.</p><details><summary>Inspect process JSON</summary><pre>{{ JSON.stringify(process, null, 2) }}</pre></details></section>
    <div v-else class="columns"><section class="request-column"><form v-if="tab === 'requests'" class="card new-request" @submit.prevent="submit"><div class="card-heading"><div><p class="eyebrow">START HERE</p><h2>New leave request</h2></div><span class="small-icon">↗</span></div><label>Title<input v-model="title" maxlength="120" placeholder="e.g. Annual leave · October" required :disabled="busy"></label><div class="form-row"><label>Days<input v-model="days" type="number" min="1" max="365" step="1" required :disabled="busy"></label><label>Approver<select v-model="approverId" required :disabled="busy"><option v-for="p in approvers" :key="p.id" :value="p.id">{{ p.displayName }}</option></select></label></div><label>Reason<textarea v-model="reason" maxlength="2000" rows="3" placeholder="Add context for your approver…" required :disabled="busy"></textarea></label><div class="form-footer"><span>Sent as {{ me.displayName }}</span><button class="primary" :disabled="busy">{{ busy ? 'Working…' : 'Submit request' }}</button></div></form>
    <section class="card request-list"><div class="card-heading"><h2>{{ tab === 'inbox' ? 'Pending decisions' : 'Your visible requests' }}</h2><span class="count">{{ visible.length }}</span></div><p v-if="!visible.length" class="empty">{{ tab === 'inbox' ? 'You’re all caught up. No requests need your review.' : 'No requests yet. Start with the form above.' }}</p><button v-for="item in visible" :key="item.id" class="request-item" :class="{selected: selectedId === item.id}" @click="select(item)"><span class="request-glyph">▤</span><span class="request-summary"><strong>{{ item.title }}</strong><small>{{ person(item.applicantId) }} · {{ item.days }} {{ item.days === 1 ? 'day' : 'days' }}</small></span><span class="status" :class="item.status.toLowerCase()">{{ item.status.toLowerCase() }}</span></button></section></section>
    <aside class="detail card"><template v-if="selected"><div class="card-heading"><p class="eyebrow">REQUEST DETAILS</p><span class="status" :class="selected.status.toLowerCase()">{{ selected.status.toLowerCase() }}</span></div><h2>{{ selected.title }}</h2><p class="detail-reason">{{ selected.reason }}</p><dl><div><dt>Applicant</dt><dd>{{ person(selected.applicantId) }}</dd></div><div><dt>Approver</dt><dd>{{ person(selected.approverId) }}</dd></div><div><dt>Duration</dt><dd>{{ selected.days }} days</dd></div><div><dt>Process</dt><dd>{{ selected.processId }} · v{{ selected.processVersion }}</dd></div></dl><h3 class="history-heading">Activity</h3><ol class="timeline"><li v-for="(entry, index) in history" :key="index"><strong>{{ actionLabel(entry.action) }}</strong><p>{{ person(entry.actorId) }}</p><small>{{ date(entry.at) }}</small><p v-if="entry.comment" class="decision-comment">{{ entry.comment }}</p></li><li v-if="selected.status === 'PENDING'" class="waiting"><strong>Awaiting review</strong><p>{{ person(selected.approverId) }}</p></li></ol><form v-if="canDecide" @submit.prevent="decide('APPROVE')" class="decision-form"><label>Decision comment <span class="muted">(optional)</span><textarea v-model="comment" maxlength="2000" rows="3" :disabled="busy"></textarea></label><div class="decision-actions"><button type="button" class="danger" :disabled="busy" @click="decide('REJECT')">Reject</button><button class="primary" :disabled="busy">Approve request</button></div></form><p v-else-if="selected.status === 'PENDING'" class="footnote">Only the designated approver can record a decision.</p><small class="request-id">{{ selected.id }}</small></template><div v-else class="detail-empty"><span>◷</span><h2>The full picture</h2><p>Select a request to see its details,<br>decision, and activity.</p></div></aside></div><footer class="page-footer">Arcflow approval example <span>Local JSON snapshot · synthetic data only</span></footer></div></section>
  </div>
</template>
