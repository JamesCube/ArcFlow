<script setup>
import { computed, ref, watch } from 'vue'
import { api } from './api'
import ProcessDesigner from './ProcessDesigner.vue'
import { appCopy, translate, validationText, apiFailure } from './locale'
import { approvalNodes, isApproval, participants, pendingParticipants, participantVotes, cloneDefinition, validateDefinition, stepState } from './process'

const locale = ref('en')
const t = computed(() => appCopy[locale.value] || appCopy.en)
const tr = (key, values) => translate(locale.value, key, values)
watch(locale, value => { document.documentElement.lang = value === 'zh' ? 'zh-CN' : 'en' }, { immediate: true })
const username = ref('alice'), password = ref(''), me = ref(null)
const people = ref([]), process = ref(null), draft = ref(null), draftBaseline = ref(''), requests = ref([])
const busy = ref(false), publishing = ref(false), error = ref(null), notice = ref(null), tab = ref('requests')
const publishConflict = ref(false)
const title = ref(''), reason = ref(''), days = ref(1)
const selectedId = ref(null), comment = ref('')
const errorText = computed(() => !error.value ? '' : error.value.kind === 'api' ? apiFailure(error.value.cause, error.value.operation, locale.value) : error.value.kind === 'validation' ? error.value.messages.map(message => validationText(message, locale.value)).join(' ') : tr(error.value.key, error.value.values))
const noticeText = computed(() => notice.value ? tr(notice.value.key, notice.value.values) : '')
const localError = key => { error.value = { key } }
const showFailure = (cause, operation) => { error.value = { kind: 'api', cause, operation } }
const showNotice = (key, values) => { notice.value = { key, values } }
let generation = 0
const displayName = value => value?.displayName || value?.name || value?.id || ''
const person = id => displayName(people.value.find(p => p.id === id)) || id || '—'
const selected = computed(() => requests.value.find(r => r.id === selectedId.value))
const pending = computed(() => requests.value.filter(r => pendingParticipants(r).includes(me.value?.id)))
const pendingCount = computed(() => requests.value.filter(item => item.status === 'PENDING').length)
const completedCount = computed(() => requests.value.filter(item => ['APPROVED', 'REJECTED'].includes(item.status)).length)
const visible = computed(() => tab.value === 'inbox' ? pending.value : requests.value)
const history = computed(() => selected.value?.history || [])
const canEdit = computed(() => me.value?.id === 'alice')
const draftDirty = computed(() => !!draft.value && JSON.stringify(draft.value) !== draftBaseline.value)
const draftErrors = computed(() => validateDefinition(draft.value))
const publishedApprovals = computed(() => approvalNodes(process.value))
const staleDraft = computed(() => publishConflict.value || draft.value?.version !== process.value?.version)
const selfAssigned = computed(() => publishedApprovals.value.some(node => participants(node).includes(me.value?.id)))
const canDecide = computed(() => pendingParticipants(selected.value).includes(me.value?.id))
const currentNode = computed(() => selected.value?.definition?.nodes.find(node => node.id === selected.value.currentStepId))
const followingNode = computed(() => {
  const steps = approvalNodes(selected.value?.definition)
  const index = steps.findIndex(node => node.id === selected.value?.currentStepId)
  return index >= 0 ? steps[index + 1] : null
})
const groupRule = node => node?.completionMode === 'ALL' ? t.value.allRule : t.value.anyRule
const stateLabel = state => tr(`state_${state}`)
const voteLabel = state => tr(`vote_${state}`)
const statusLabel = status => tr(`status_${status}`)
const duration = count => `${count} ${count === 1 ? t.value.day : t.value.dayPlural}`
const nodeSummary = node => node?.type === 'parallelApproval' ? `${node.completionMode} · ${participants(node).map(person).join(' + ')}` : person(node?.assigneeId)
const pendingNames = item => pendingParticipants(item).map(person).join(', ') || '—'
const date = value => value ? new Date(value).toLocaleString(locale.value === 'zh' ? 'zh-CN' : 'en-US') : '—'
const historyLabel = entry => {
  if (['SUBMIT', 'SUBMITTED'].includes(entry.action)) return t.value.submittedActivity
  const name = selected.value?.definition?.nodes.find(node => node.id === entry.stepId)?.name || t.value.approvalStep
  const node = selected.value?.definition?.nodes.find(node => node.id === entry.stepId)
  return `${name} · ${node?.type === 'parallelApproval' ? t.value.vote : ''}${['APPROVE', 'APPROVED'].includes(entry.action) ? t.value.approvedActivity : t.value.rejectedActivity}`
}
function requireValidDefinition(definition) {
  const errors = validateDefinition(definition)
  if (errors.length) throw Object.assign(new Error('Invalid process template'), { validationErrors: errors })
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
  busy.value = true; error.value = null; notice.value = null
  api.login(username.value, password.value); password.value = ''
  try {
    const [identity, list, blueprint, items] = await Promise.all([
      api.request('/me'), api.request('/people'), api.request('/process'), api.request('/requests'),
    ])
    if (generation !== current) return
    requireValidDefinition(blueprint)
    me.value = identity; people.value = list; process.value = blueprint; loadDraft(blueprint); requests.value = items
  } catch (e) { if (generation === current) { api.logout(); showFailure(e, 'login') } }
  finally { if (generation === current) busy.value = false }
}
function logout() {
  generation++; api.logout(); me.value = null; people.value = []; process.value = null; draft.value = null; draftBaseline.value = ''; requests.value = []
  selectedId.value = null; title.value = ''; reason.value = ''; days.value = 1; comment.value = ''; password.value = ''
  error.value = null; notice.value = null; busy.value = false; publishing.value = false; publishConflict.value = false; tab.value = 'requests'
}
async function refresh() {
  if (busy.value) return
  const current = generation; busy.value = true; error.value = null; notice.value = null
  try {
    const [items, blueprint] = await Promise.all([api.request('/requests'), api.request('/process')])
    if (current !== generation) return
    requireValidDefinition(blueprint)
    const previousStep = selected.value?.currentStepId
    requests.value = items; setPublished(blueprint)
    if (previousStep !== selected.value?.currentStepId) comment.value = ''
    showNotice(draftDirty.value ? 'refreshedDraft' : 'refreshed')
  } catch (e) { if (current === generation) showFailure(e, 'refresh') }
  finally { if (current === generation) busy.value = false }
}
function resetDraft() {
  if (busy.value || !canEdit.value) return
  loadDraft(process.value); error.value = null; showNotice('resetDone')
}
async function publish() {
  if (busy.value || !canEdit.value || !draftDirty.value || !draft.value) return
  error.value = null; notice.value = null
  if (draftErrors.value.length) { error.value = { kind: 'validation', messages: [...draftErrors.value] }; return }
  if (staleDraft.value) { localError('staleDraft'); return }
  const current = generation
  const definition = cloneDefinition(draft.value)
  definition.name = definition.name.trim()
  definition.nodes = definition.nodes.map(node => isApproval(node) ? { ...node, name: node.name.trim() } : node)
  busy.value = true; publishing.value = true
  try {
    const published = await api.request('/process', { method: 'POST', body: JSON.stringify({ expectedVersion: definition.version, definition }) })
    if (current !== generation) return
    requireValidDefinition(published)
    process.value = published; loadDraft(published)
    showNotice('published', { version: published.version })
  } catch (e) {
    if (current !== generation) return
    if (e.status === 409) {
      publishConflict.value = true
      showFailure(e, 'publish')
    } else showFailure(e, 'publish')
  } finally { if (current === generation) { busy.value = false; publishing.value = false } }
}
async function submit() {
  if (busy.value) return
  error.value = null; notice.value = null
  if (!title.value.trim() || !reason.value.trim() || !Number.isInteger(Number(days.value)) || Number(days.value) < 1 || Number(days.value) > 365) {
    localError('invalidFields'); return
  }
  if (validateDefinition(process.value).length || selfAssigned.value) {
    localError(selfAssigned.value ? 'selfAssignedError' : 'validTemplateNeeded'); return
  }
  const current = generation; busy.value = true
  try {
    const item = await api.request('/requests', { method: 'POST', body: JSON.stringify({ title: title.value.trim(), reason: reason.value.trim(), days: Number(days.value), processVersion: process.value.version }) })
    if (current !== generation) return
    requests.value = [item, ...requests.value]; selectedId.value = item.id; tab.value = 'requests'; comment.value = ''
    title.value = ''; reason.value = ''; days.value = 1
    showNotice('submitted', { names: pendingNames(item) })
  } catch (e) { if (current === generation) showFailure(e, 'submit') }
  finally { if (current === generation) busy.value = false }
}
async function decide(decision) {
  if (busy.value || !canDecide.value) return
  const current = generation, requestId = selected.value.id, stepId = selected.value.currentStepId
  busy.value = true; error.value = null; notice.value = null
  try {
    const item = await api.request(`/requests/${encodeURIComponent(requestId)}/decisions`, { method: 'POST', body: JSON.stringify({ stepId, decision, comment: comment.value.trim() }) })
    if (current !== generation) return
    requests.value = requests.value.map(r => r.id === item.id ? item : r)
    if (selectedId.value === requestId) comment.value = ''
    showNotice(item.status === 'PENDING'
      ? item.currentStepId === stepId ? 'voteRecorded' : 'stepApproved'
      : item.status === 'APPROVED' ? 'requestApproved' : 'requestRejected', { names: pendingNames(item) })
  } catch (e) { if (current === generation) showFailure(e, 'decision') }
  finally { if (current === generation) busy.value = false }
}
function navigate(next) {
  if (next !== tab.value) notice.value = null
  tab.value = next
}
function select(item) { selectedId.value = item.id; comment.value = ''; error.value = null }
</script>

<template>
  <main v-if="!me" class="login-shell" :lang="locale === 'zh' ? 'zh-CN' : 'en'">
    <section class="login-story">
      <div class="wordmark"><span class="logo">a</span> arcflow</div>
      <p class="eyebrow">{{ t.storyEyebrow }}</p><h1>{{ t.storyTitle }}<br>{{ t.storyTitleSecond }}</h1>
      <p>{{ t.storyDescription }}</p>
      <div class="story-path"><span>{{ t.request }}</span><b>→</b><span>{{ t.reviews }}</span><b>→</b><span>{{ t.outcome }}</span></div>
      <small>{{ t.storyFootnote }}</small>
    </section>
    <section class="login-panel">
      <label class="workspace-locale login-locale"><span>{{ t.languageShort }}</span><select v-model="locale" data-testid="workspace-language" :aria-label="t.language"><option value="en">English</option><option value="zh">简体中文</option></select></label>
      <form @submit.prevent="login" class="login-form">
        <p class="eyebrow">{{ t.welcome }}</p><h2>{{ t.choosePerspective }}</h2>
        <p class="muted">{{ t.signInDescription }}</p>
        <label>{{ t.demoAccount }}<select v-model="username" :disabled="busy"><option value="alice">{{ t.aliceAccount }}</option><option value="bob">{{ t.bobAccount }}</option><option value="carol">{{ t.carolAccount }}</option></select></label>
        <label>{{ t.password }}<input v-model="password" name="password" type="password" autocomplete="off" required :disabled="busy"></label>
        <p v-if="errorText" role="alert" class="error">{{ errorText }}</p>
        <button class="primary full" :disabled="busy">{{ busy ? t.signingIn : t.enterWorkspace }}</button>
        <p class="footnote">{{ t.credentialsNote }}</p>
      </form>
    </section>
  </main>
  <div v-else class="workspace" :lang="locale === 'zh' ? 'zh-CN' : 'en'">
    <aside class="sidebar">
      <div class="wordmark"><span class="logo">a</span> arcflow</div><p class="sidebar-label">{{ t.workspaceLabel }}</p>
      <nav :aria-label="t.navigation">
        <button data-testid="requests-tab" :class="{active: tab === 'requests'}" :aria-current="tab === 'requests' ? 'page' : undefined" @click="navigate('requests')"><span class="nav-symbol" aria-hidden="true">▤</span><span>{{ t.requests }}</span></button>
        <button data-testid="inbox-tab" :class="{active: tab === 'inbox'}" :aria-current="tab === 'inbox' ? 'page' : undefined" @click="navigate('inbox')"><span class="nav-symbol" aria-hidden="true">◷</span><span>{{ t.needsMyReview }}</span><b>{{ pending.length }}</b></button>
        <button data-testid="process-tab" :class="{active: tab === 'process'}" :aria-current="tab === 'process' ? 'page' : undefined" @click="navigate('process')"><span class="nav-symbol" aria-hidden="true">◇</span><span>{{ t.processDesigner }}</span></button>
      </nav>
      <div class="sidebar-bottom"><span class="avatar">{{ displayName(me).charAt(0) }}</span><div><strong>{{ displayName(me) }}</strong><small>{{ me.id }}</small></div><button class="logout" data-testid="sign-out" @click="logout" :aria-label="t.signOut" :title="t.signOut">↪</button></div>
    </aside>
    <section class="main-area">
      <header class="topbar"><span class="breadcrumb">{{ t.workspace }} <span class="slash">/</span> {{ t.leaveApprovals }}</span><div class="topbar-actions"><span class="prototype">{{ t.prototype }}</span><label class="workspace-locale"><span>{{ t.languageShort }}</span><select v-model="locale" data-testid="workspace-language" :aria-label="t.language"><option value="en">English</option><option value="zh">简体中文</option></select></label></div></header>
      <div class="content">
        <div class="page-heading"><div><p class="eyebrow">{{ t.keepMoving }}</p>
          <h1>{{ tab === 'process' ? t.processDesigner : tab === 'inbox' ? t.needsReview : t.leaveApprovals }}</h1>
          <p class="muted">{{ tab === 'process' ? t.designerDescription : t.requestsDescription }}</p>
        </div><button class="secondary" data-testid="refresh" :disabled="busy" @click="refresh">{{ busy ? t.working : t.refresh }}</button></div>
        <p v-if="errorText" class="error" role="alert">{{ errorText }}</p><p v-if="noticeText" class="notice" role="status">{{ noticeText }}</p>

        <ProcessDesigner v-if="draft" v-show="tab === 'process'" v-model="draft" :published="process" :people="people" :editable="canEdit" :busy="busy" :publishing="publishing" :dirty="draftDirty" :stale="staleDraft" :initial-locale="locale" :show-language="false" @update:locale="locale = $event" @publish="publish" @reset="resetDraft" />

        <section v-if="tab !== 'process'" class="workspace-summary" :aria-label="t.summary">
          <div class="summary-stat"><span>{{ t.visibleRequests }}</span><strong>{{ requests.length }}</strong></div>
          <div class="summary-stat"><span>{{ t.pendingRequests }}</span><strong>{{ pendingCount }}</strong></div>
          <div class="summary-stat"><span>{{ t.completedRequests }}</span><strong>{{ completedCount }}</strong></div>
          <div class="summary-stat"><span>{{ t.publishedVersion }}</span><strong>v{{ process?.version }}</strong><small>{{ tr('reviewSteps', { count: publishedApprovals.length }) }}</small></div>
        </section>
        <div v-if="tab !== 'process'" class="columns">
          <section class="request-column">
            <form v-if="tab === 'requests'" class="card new-request" @submit.prevent="submit">
              <div class="card-heading"><div><p class="eyebrow">{{ t.startHere }}</p><h2>{{ t.newRequest }}</h2></div><span class="small-icon" aria-hidden="true">↗</span></div>
              <div class="submission-template" data-testid="submission-template"><strong>{{ process?.name }} · v{{ process?.version }}</strong><p>{{ publishedApprovals.map(node => `${node.name} (${nodeSummary(node)})`).join(' → ') }}</p><small>{{ t.savedTemplate }}<template v-if="draftDirty"> {{ t.draftNotUsed }}</template></small></div>
              <p v-if="selfAssigned" class="warning">{{ t.selfAssignedWarning }}</p>
              <div class="request-form-fields"><label class="request-title-field">{{ t.title }}<input v-model="title" data-testid="request-title" maxlength="120" :placeholder="t.titlePlaceholder" required :disabled="busy"></label>
              <label class="request-days-field">{{ t.days }}<input v-model="days" data-testid="request-days" type="number" min="1" max="365" step="1" required :disabled="busy"></label></div>
              <label>{{ t.reason }}<textarea v-model="reason" data-testid="request-reason" maxlength="2000" rows="3" :placeholder="t.reasonPlaceholder" required :disabled="busy"></textarea></label>
              <div class="form-footer"><span>{{ tr('sentAs', { name: displayName(me) }) }}</span><button class="primary" data-testid="submit-request" :disabled="busy || selfAssigned || !process">{{ busy ? t.working : t.submit }}</button></div>
            </form>
            <section class="card request-list"><div class="card-heading"><h2>{{ tab === 'inbox' ? t.pendingDecisions : t.yourVisibleRequests }}</h2><span class="count">{{ visible.length }}</span></div>
              <p v-if="!visible.length" class="empty">{{ tab === 'inbox' ? t.caughtUp : t.noRequests }}</p>
              <button v-for="item in visible" :key="item.id" class="request-item" :class="{selected: selectedId === item.id}" :aria-pressed="selectedId === item.id" @click="select(item)"><span class="request-glyph" aria-hidden="true">▤</span><span class="request-summary"><strong>{{ item.title }}</strong><small>{{ person(item.applicantId) }} · {{ duration(item.days) }}<template v-if="item.status === 'PENDING'"> · {{ tr('awaiting', { names: pendingNames(item) }) }}</template></small></span><span class="status" :class="item.status.toLowerCase()">{{ statusLabel(item.status) }}</span></button>
            </section>
          </section>
          <aside class="detail card">
            <template v-if="selected">
              <div class="card-heading"><p class="eyebrow">{{ t.requestDetails }}</p><span class="status" :class="selected.status.toLowerCase()">{{ statusLabel(selected.status) }}</span></div>
              <h2>{{ selected.title }}</h2><p class="detail-reason">{{ selected.reason }}</p>
              <dl><div><dt>{{ t.applicant }}</dt><dd>{{ person(selected.applicantId) }}</dd></div><div><dt>{{ selected.status === 'PENDING' ? t.awaitingVotes : t.lastVoter }}</dt><dd>{{ selected.status === 'PENDING' ? pendingNames(selected) : person(selected.approverId) }}</dd></div><div><dt>{{ t.duration }}</dt><dd>{{ duration(selected.days) }}</dd></div><div><dt>{{ t.savedProcess }}</dt><dd>{{ selected.processId }} · v{{ selected.processVersion }}</dd></div></dl>
              <section class="instance-snapshot" data-testid="instance-snapshot">
                <h3>{{ t.savedSequence }}</h3><p class="footnote">{{ selected.definition?.name }} · v{{ selected.definition?.version }} · {{ t.readOnlySnapshot }}</p>
                <ol class="snapshot-steps"><li v-for="node in selected.definition?.nodes" :key="node.id" :class="stepState(selected, node)" :data-step-id="node.id"><span class="snapshot-dot" aria-hidden="true"></span><div><strong>{{ node.name }}</strong><small v-if="isApproval(node)">{{ nodeSummary(node) }}</small>
                  <div v-if="node.type === 'parallelApproval'" class="participant-votes" :aria-label="tr('participantVotes', { name: node.name })"><div v-for="vote in participantVotes(selected, node)" :key="vote.actorId" class="participant-vote" :data-participant="vote.actorId"><span>{{ person(vote.actorId) }} · {{ voteLabel(vote.state) }}</span><small v-if="vote.at">{{ date(vote.at) }}</small><p v-if="vote.comment">{{ vote.comment }}</p></div></div></div><span class="step-state">{{ stateLabel(stepState(selected, node)) }}</span></li></ol>
                <p v-if="selected.status === 'PENDING'" class="next-step"><strong>{{ t.now }}</strong> {{ currentNode?.name }} · {{ pendingNames(selected) }}<br><template v-if="followingNode"><strong>{{ t.next }}</strong> {{ followingNode.name }} · {{ nodeSummary(followingNode) }}</template><template v-else>{{ t.finalStep }}</template></p>
              </section>
              <p v-if="currentNode?.type === 'parallelApproval'" class="group-rule current-rule">{{ groupRule(currentNode) }}</p>
              <h3 class="history-heading">{{ t.activity }}</h3><ol class="timeline"><li v-for="(entry, index) in history" :key="index"><strong>{{ historyLabel(entry) }}</strong><p>{{ person(entry.actorId) }}</p><small>{{ date(entry.at) }}</small><p v-if="entry.comment" class="decision-comment">{{ entry.comment }}</p></li><li v-if="selected.status === 'PENDING'" class="waiting"><strong>{{ t.awaitingReview }} · {{ currentNode?.name }}</strong><p>{{ pendingNames(selected) }}</p></li></ol>
              <form v-if="canDecide" @submit.prevent="decide('APPROVE')" class="decision-form"><p class="decision-context">{{ t.reviewing }} <strong>{{ currentNode?.name }}</strong></p><label>{{ t.decisionComment }} <span class="muted">{{ t.optional }}</span><textarea v-model="comment" data-testid="decision-comment" maxlength="2000" rows="3" :disabled="busy"></textarea></label><div class="decision-actions"><button type="button" class="danger" data-testid="reject-decision" :disabled="busy" @click="decide('REJECT')">{{ currentNode?.type === 'parallelApproval' ? t.rejectVote : t.rejectRequest }}</button><button class="primary" data-testid="approve-decision" :disabled="busy">{{ currentNode?.type === 'parallelApproval' ? t.approveVote : followingNode ? t.approveStep : t.approveRequest }}</button></div></form>
              <p v-else-if="selected.status === 'PENDING'" class="footnote">{{ t.whoCanDecide }}</p>
              <details class="snapshot-json"><summary>{{ t.inspectSnapshot }}</summary><pre>{{ JSON.stringify(selected.definition, null, 2) }}</pre></details><small class="request-id">{{ selected.id }}</small>
            </template>
            <div v-else class="detail-empty"><span aria-hidden="true">◷</span><h2>{{ t.fullPicture }}</h2><p>{{ t.selectRequest }}</p></div>
          </aside>
        </div>
        <footer class="page-footer">{{ t.footer }} <span>{{ t.footerNote }}</span></footer>
      </div>
    </section>
  </div>
</template>
