<script setup>
import { computed, nextTick, reactive, ref, watch, onUnmounted } from 'vue'
import { api } from './api'
import { createMemberInbox } from './member-inbox'
import { createSubmissionForms, isRejectedSubmissionVersion } from './submission-intent'
import { validateSubmissionResponse, validateDecisionResponse } from './submission-response'
import { SUPPORTED_CURRENCIES, InvalidApprovalPayloadError, businessDocumentErrors, procurementTotal, formatMoney, requestBusiness } from './business-document'
import ProcessDesigner from './ProcessDesigner.vue'
import UiIcon from './UiIcon.vue'
import { appCopy, translate, validationText, apiFailure } from './locale'
import { approvalNodes, isApproval, participants, pendingParticipants, participantVotes, cloneDefinition, validateDefinition, validatePublicationResponse, stepState } from './process'

const locale = ref('en')
const t = computed(() => appCopy[locale.value] || appCopy.en)
const tr = (key, values) => translate(locale.value, key, values)
watch(locale, value => { document.documentElement.lang = value === 'zh' ? 'zh-CN' : 'en' }, { immediate: true })
const username = ref('alice'), password = ref(''), me = ref(null)
const people = ref([]), process = ref(null), draft = ref(null), draftBaseline = ref(''), requests = ref([])
const busy = ref(false), publishing = ref(false), error = ref(null), notice = ref(null), tab = ref('requests')
const publishConflict = ref(false)
const requestType = ref('leave'), submissionForms = reactive(createSubmissionForms())
const activeForm = computed(() => submissionForms[requestType.value] || submissionForms.leave)
const formValue = (field, type) => computed({
  get: () => (type ? submissionForms[type] : activeForm.value).fields[field],
  set: value => { (type ? submissionForms[type] : activeForm.value).fields[field] = value },
})
const title = formValue('title'), reason = formValue('reason'), days = formValue('days', 'leave')
const businessId = formValue('businessId', 'procurement'), itemName = formValue('item', 'procurement')
const quantity = formValue('quantity', 'procurement'), unitPrice = formValue('unitPrice', 'procurement'), currency = formValue('currency', 'procurement')
const formAttempted = ref(false), requestFormElement = ref(null)
const procurement = () => ({ type: 'procurement', businessId: businessId.value, title: title.value, reason: reason.value, item: itemName.value, quantity: quantity.value, unitPrice: unitPrice.value, currency: currency.value })
const formErrors = computed(() => requestType.value === 'procurement' ? businessDocumentErrors(procurement()) : [])
const fieldInvalid = key => formAttempted.value && formErrors.value.includes(key)
const total = computed(() => procurementTotal(quantity.value, unitPrice.value, currency.value))
const money = (amount, code) => formatMoney(amount, code, locale.value)
const submissionAttempt = computed({ get: () => activeForm.value.attempt, set: value => { activeForm.value.attempt = value } })
const submissionDefinition = computed({ get: () => activeForm.value.definition, set: value => { activeForm.value.definition = value } })
const submissionFields = () => requestType.value === 'procurement' ? { business: procurement() } : ({ title: title.value, reason: reason.value, days: days.value })
function clearSubmission(form = activeForm.value) { form.intent.clear(); form.attempt = null; form.definition = null; form.versionRejected = false }
function clearAllSubmissions() { Object.values(submissionForms).forEach(clearSubmission) }
function resetCurrentForm() { activeForm.value.fields = createSubmissionForms()[requestType.value].fields }
watch(() => me.value?.id, clearAllSubmissions, { flush: 'sync' })
watch([title, reason, days, requestType, businessId, itemName, quantity, unitPrice, currency], () => {
  activeForm.value.intent.invalidate(me.value?.id, submissionFields())
  if (!activeForm.value.intent.current(me.value?.id, submissionFields())) clearSubmission()
}, { flush: 'sync' })
const submissionProcess = computed(() => submissionAttempt.value ? submissionDefinition.value : process.value)
const selectedId = ref(null), comment = ref(''), unconfirmedDecisionIds = ref(new Set())
const inbox = createMemberInbox((path, options) => api.request(path, options))
const inboxBox = computed(() => tab.value === 'handled' ? 'HANDLED' : 'PENDING')
const isInbox = computed(() => ['inbox', 'handled'].includes(tab.value))
const inboxPage = computed(() => inbox.state[inboxBox.value])
const statusFilter = ref(''), versionFilter = ref('')
onUnmounted(() => { generation++; inbox.dispose(); api.logout() })
const errorText = computed(() => !error.value ? '' : error.value.kind === 'api' ? apiFailure(error.value.cause, error.value.operation, locale.value) : error.value.kind === 'validation' ? error.value.messages.map(message => validationText(message, locale.value)).join(' ') : tr(error.value.key, error.value.values))
const noticeText = computed(() => notice.value ? tr(notice.value.key, notice.value.values) : '')
const localError = key => { error.value = { key } }
const showFailure = (cause, operation) => { if (cause?.status === 401 && me.value) logout(); error.value = { kind: 'api', cause, operation } }
const showNotice = (key, values) => { notice.value = { key, values } }
let generation = 0
const displayName = value => value?.displayName || value?.name || value?.id || ''
const person = id => displayName(people.value.find(p => p.id === id)) || id || '—'
const businessView = item => {
  try {
    const business = requestBusiness(item)
    if (business) validateSubmissionResponse(item, item.applicantId, { business, processVersion: item.processVersion }, item.definition)
    return business
  } catch { return { type: 'invalid' } }
}
const businessSummary = item => {
  const business = businessView(item)
  return business?.type === 'invalid' ? t.value.invalidBusinessSnapshot : business?.type === 'procurement'
    ? `${t.value.procurementType} · ${money(procurementTotal(business.quantity, business.unitPrice, business.currency), business.currency)}`
    : `${t.value.leaveType} · ${duration(item.days)}`
}
const selectedBusiness = computed(() => selected.value ? businessView(selected.value) : null)
const safePendingParticipants = item => businessView(item)?.type === 'invalid' ? [] : pendingParticipants(item)
const latestRequests = computed(() => requests.value.map(item => inbox.state.entities[item.id] || item))
const selected = computed(() => inbox.state.entities[selectedId.value] || latestRequests.value.find(r => r.id === selectedId.value))
watch(() => selected.value?.currentStepId, () => { comment.value = '' })
watch(() => [inbox.state.PENDING.error, inbox.state.HANDLED.error], failures => {
  const expired = failures.find(failure => failure?.status === 401)
  if (expired && me.value) showFailure(expired, 'inbox')
  if (failures.some(failure => failure instanceof InvalidApprovalPayloadError))
    for (const item of Object.values(inbox.state.entities)) if (Object.prototype.hasOwnProperty.call(item, 'business')) unconfirmedDecisionIds.value.add(item.id)
})
const pendingCount = computed(() => latestRequests.value.filter(item => item.status === 'PENDING').length)
const completedCount = computed(() => latestRequests.value.filter(item => ['APPROVED', 'REJECTED'].includes(item.status)).length)
const visible = computed(() => isInbox.value ? inbox.items(inboxBox.value) : latestRequests.value)
const history = computed(() => selectedBusiness.value?.type === 'invalid' ? [] : selected.value?.history || [])
const canEdit = computed(() => me.value?.id === 'alice')
const draftDirty = computed(() => !!draft.value && JSON.stringify(draft.value) !== draftBaseline.value)
const draftErrors = computed(() => validateDefinition(draft.value))
const publishedApprovals = computed(() => approvalNodes(process.value))
const staleDraft = computed(() => publishConflict.value || draft.value?.version !== process.value?.version)
const submissionApprovals = computed(() => approvalNodes(submissionProcess.value))
const selfAssigned = computed(() => submissionApprovals.value.some(node => participants(node).includes(me.value?.id)))
const canDecide = computed(() => selectedBusiness.value?.type !== 'invalid' && !unconfirmedDecisionIds.value.has(selected.value?.id) && pendingParticipants(selected.value).includes(me.value?.id))
const currentNode = computed(() => selectedBusiness.value?.type === 'invalid' ? null : selected.value?.definition?.nodes.find(node => node.id === selected.value.currentStepId))
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
const pendingNames = item => safePendingParticipants(item).map(person).join(', ') || '—'
const date = value => value ? new Date(value).toLocaleString(locale.value === 'zh' ? 'zh-CN' : 'en-US') : '—'
const historyLabel = entry => {
  if (['SUBMIT', 'SUBMITTED'].includes(entry.action)) return t.value.submittedActivity
  const name = selected.value?.definition?.nodes.find(node => node.id === entry.stepId)?.name || t.value.approvalStep
  const node = selected.value?.definition?.nodes.find(node => node.id === entry.stepId)
  return `${name} · ${node?.type === 'parallelApproval' ? t.value.vote : ''}${['APPROVE', 'APPROVED'].includes(entry.action) ? t.value.approvedActivity : t.value.rejectedActivity}`
}
function requireRequestList(items) {
  if (!Array.isArray(items) || items.some(item => !item || typeof item !== 'object' || Array.isArray(item) || typeof item.id !== 'string' || !['PENDING', 'APPROVED', 'REJECTED'].includes(item.status))) throw new InvalidApprovalPayloadError()
  items.forEach(inbox.checkSnapshot)
  return items
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
    requireRequestList(items)
    inbox.setActor(identity.id); items.forEach(inbox.remember)
    me.value = identity; people.value = list; process.value = blueprint; loadDraft(blueprint); requests.value = items
  } catch (e) { if (generation === current) { api.logout(); showFailure(e, 'login') } }
  finally { if (generation === current) busy.value = false }
}
function logout() {
  clearAllSubmissions()
  generation++; inbox.dispose(); api.logout(); me.value = null; people.value = []; process.value = null; draft.value = null; draftBaseline.value = ''; requests.value = []
  selectedId.value = null; unconfirmedDecisionIds.value = new Set(); Object.assign(submissionForms, createSubmissionForms()); requestType.value = 'leave'; formAttempted.value = false; comment.value = ''; password.value = ''
  error.value = null; notice.value = null; busy.value = false; publishing.value = false; publishConflict.value = false; tab.value = 'requests'
}
async function refresh() {
  if (busy.value) return
  const current = generation; busy.value = true; error.value = null; notice.value = null
  const reloadInbox = isInbox.value || inbox.state.PENDING.loaded || inbox.state.HANDLED.loaded
  inbox.invalidate()
  try {
    const [items, blueprint] = await Promise.all([api.request('/requests'), api.request('/process')])
    if (current !== generation) return
    requireValidDefinition(blueprint)
    requireRequestList(items)
    const previousStep = selected.value?.currentStepId
    items.forEach(inbox.remember); requests.value = items; setPublished(blueprint)
    unconfirmedDecisionIds.value = new Set([...unconfirmedDecisionIds.value].filter(id => !items.some(item => item.id === id && businessView(item)?.type !== 'invalid')))
    if (selectedId.value && !items.some(item => item.id === selectedId.value)) selectedId.value = null
    if (reloadInbox) await inbox.refresh()
    if (current !== generation) return
    // Refresh is an explicit recovery step only after the server proved no
    // submission was created. Uncertain writes retain their original intent.
    Object.values(submissionForms).filter(form => form.versionRejected).forEach(clearSubmission)
    if (previousStep !== selected.value?.currentStepId) comment.value = ''
    showNotice(draftDirty.value ? 'refreshedDraft' : 'refreshed')
  } catch (e) { if (current === generation) {
    if (e instanceof InvalidApprovalPayloadError) for (const item of Object.values(inbox.state.entities)) if (Object.prototype.hasOwnProperty.call(item, 'business')) unconfirmedDecisionIds.value.add(item.id)
    showFailure(e, 'refresh')
  } }
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
    validatePublicationResponse(published, definition)
    process.value = published; loadDraft(published)
    showNotice('published', { version: published.version })
  } catch (e) {
    if (current !== generation) return
    if (e.status === 409 || e.name === 'InvalidPublicationResponseError') {
      publishConflict.value = true
      showFailure(e, 'publish')
    } else showFailure(e, 'publish')
  } finally { if (current === generation) { busy.value = false; publishing.value = false } }
}
async function submit() {
  if (busy.value) return
  error.value = null; notice.value = null
  formAttempted.value = true
  if (requestType.value === 'procurement') {
    if (formErrors.value.length) {
      localError('invalidProcurement')
      await nextTick(); requestFormElement.value?.querySelector('[aria-invalid="true"]')?.focus()
      return
    }
  } else if (!title.value.trim() || title.value.length > 120 || !reason.value.trim() || reason.value.length > 2000 || !Number.isInteger(Number(days.value)) || Number(days.value) < 1 || Number(days.value) > 365) {
    localError('invalidFields'); return
  }
  if (validateDefinition(submissionProcess.value).length || selfAssigned.value) {
    localError(selfAssigned.value ? 'selfAssignedError' : 'validTemplateNeeded'); return
  }
  const current = generation; busy.value = true
  try {
    if (!submissionAttempt.value) submissionDefinition.value = cloneDefinition(process.value)
    const attempt = activeForm.value.intent.prepare(me.value.id, submissionFields(), process.value.version)
    submissionAttempt.value = attempt
    const item = await api.request(attempt.endpoint, { method: 'POST', headers: { 'Idempotency-Key': attempt.key }, body: JSON.stringify(attempt.payload) })
    if (current !== generation) return
    validateSubmissionResponse(item, me.value.id, attempt.payload, submissionDefinition.value)
    clearSubmission()
    inbox.remember(item)
    requests.value = [item, ...requests.value.filter(existing => existing.id !== item.id)]; selectedId.value = item.id; tab.value = 'requests'; comment.value = ''
    resetCurrentForm(); formAttempted.value = false
    showNotice(item.status === 'PENDING' ? 'submitted' : item.status === 'APPROVED' ? 'requestApproved' : 'requestRejected', { names: pendingNames(item) })
  } catch (e) {
    if (current === generation) {
      activeForm.value.versionRejected = isRejectedSubmissionVersion(e)
      showFailure(e, 'submit')
    }
  }
  finally { if (current === generation) busy.value = false }
}
async function decide(decision) {
  if (busy.value || !canDecide.value) return
  const current = generation, original = selected.value, requestId = selected.value.id, stepId = selected.value.currentStepId, submittedComment = comment.value.trim()
  busy.value = true; error.value = null; notice.value = null
  inbox.invalidate()
  try {
    const item = await api.request(`/requests/${encodeURIComponent(requestId)}/decisions`, { method: 'POST', body: JSON.stringify({ stepId, decision, comment: submittedComment }) })
    if (current !== generation) return
    if (Object.prototype.hasOwnProperty.call(original, 'business')) {
      try {
        validateDecisionResponse(item, original, me.value.id, stepId, decision)
      } catch (cause) { unconfirmedDecisionIds.value.add(requestId); throw cause }
    }
    if (item?.id !== requestId || !item.history?.some(event => event.actorId === me.value.id && event.stepId === stepId && event.action === decision)) throw new Error('Invalid decision response')
    inbox.remember(item); unconfirmedDecisionIds.value.delete(requestId)
    requests.value = requests.value.map(r => r.id === item.id ? item : r)
    if (selectedId.value === requestId) comment.value = ''
    showNotice(item.status === 'PENDING'
      ? item.currentStepId === stepId ? 'voteRecorded' : 'stepApproved'
      : item.status === 'APPROVED' ? 'requestApproved' : 'requestRejected', { names: pendingNames(item) })
  } catch (e) {
    if (current === generation) {
      unconfirmedDecisionIds.value.add(requestId); showFailure(e, 'decision')
      // A losing ANY participant may belong to neither inbox after another vote.
      // Recover through the broader historical list, and keep actions locked if
      // that read also fails. A failed POST is never evidence that nothing changed.
      if (current === generation) try {
        const items = await api.request('/requests')
        if (current === generation) {
          requireRequestList(items)
          items.forEach(inbox.remember); requests.value = items
          items.forEach(item => { if (!Object.prototype.hasOwnProperty.call(item, 'business')) unconfirmedDecisionIds.value.delete(item.id) })
          if (selectedId.value === requestId && !items.some(item => item.id === requestId)) selectedId.value = null
        }
      } catch { /* The decision error remains visible until an explicit refresh. */ }
    }
  }
  finally {
    if (current === generation) { await inbox.refresh(); if (current === generation) busy.value = false }
  }
}
function navigate(next) {
  if (next !== tab.value) notice.value = null
  tab.value = next
  if (isInbox.value) {
    statusFilter.value = inboxPage.value.status; versionFilter.value = inboxPage.value.processVersion
    if (!inboxPage.value.loaded && !inboxPage.value.loading) void inbox.load(inboxBox.value)
  }
}
function applyFilters() {
  if (!inbox.setFilters(inboxBox.value, { status: statusFilter.value, processVersion: versionFilter.value })) { localError('invalidInboxFilters'); return }
  selectedId.value = null; comment.value = ''; error.value = null
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
        <button data-testid="requests-tab" :class="{active: tab === 'requests'}" :aria-current="tab === 'requests' ? 'page' : undefined" @click="navigate('requests')"><UiIcon name="requests" /><span>{{ t.requests }}</span></button>
        <button data-testid="inbox-tab" :class="{active: tab === 'inbox'}" :aria-current="tab === 'inbox' ? 'page' : undefined" @click="navigate('inbox')"><UiIcon name="review" /><span>{{ t.needsMyReview }}</span></button>
        <button data-testid="handled-tab" :class="{active: tab === 'handled'}" :aria-current="tab === 'handled' ? 'page' : undefined" @click="navigate('handled')"><UiIcon name="review" /><span>{{ t.myDecisions }}</span></button>
        <button data-testid="process-tab" :class="{active: tab === 'process'}" :aria-current="tab === 'process' ? 'page' : undefined" @click="navigate('process')"><UiIcon name="process" /><span>{{ t.processDesigner }}</span></button>
      </nav>
      <div class="sidebar-bottom"><span class="avatar">{{ displayName(me).charAt(0) }}</span><div><strong>{{ displayName(me) }}</strong><small>{{ me.id }}</small></div><button class="logout" data-testid="sign-out" @click="logout" :aria-label="t.signOut" :title="t.signOut"><UiIcon name="logout" /></button></div>
    </aside>
    <section class="main-area">
      <header class="topbar"><span class="breadcrumb">{{ t.workspace }} <span class="slash">/</span> <strong>{{ tab === 'process' ? t.processDesigner : tab === 'handled' ? t.myDecisions : tab === 'inbox' ? t.needsReview : t.businessApprovals }}</strong></span><div class="topbar-actions"><span class="prototype">{{ t.prototype }}</span><label class="workspace-locale"><span>{{ t.languageShort }}</span><select v-model="locale" data-testid="workspace-language" :aria-label="t.language"><option value="en">English</option><option value="zh">简体中文</option></select></label></div></header>
      <div class="content">
        <div class="page-heading"><div>
          <h1>{{ tab === 'process' ? t.processDesigner : tab === 'handled' ? t.myDecisions : tab === 'inbox' ? t.needsReview : t.businessApprovals }}</h1>
          <p class="muted">{{ tab === 'process' ? t.designerDescription : isInbox ? t.inboxDescription : t.requestsDescription }}</p>
        </div><button class="secondary" data-testid="refresh" :disabled="busy" @click="refresh">{{ busy ? t.working : t.refresh }}</button></div>
        <p v-if="errorText" class="error" role="alert">{{ errorText }}</p><p v-if="noticeText" class="notice" role="status">{{ noticeText }}</p>

        <ProcessDesigner v-if="draft" v-show="tab === 'process'" v-model="draft" :published="process" :people="people" :editable="canEdit" :busy="busy" :publishing="publishing" :dirty="draftDirty" :stale="staleDraft" :initial-locale="locale" :show-language="false" @update:locale="locale = $event" @publish="publish" @reset="resetDraft" />

        <section v-if="tab === 'requests'" class="workspace-summary" :aria-label="t.summary">
          <div class="summary-stat"><span>{{ t.visibleRequests }}</span><strong>{{ requests.length }}</strong></div>
          <div class="summary-stat"><span>{{ t.pendingRequests }}</span><strong>{{ pendingCount }}</strong></div>
          <div class="summary-stat"><span>{{ t.completedRequests }}</span><strong>{{ completedCount }}</strong></div>
          <div class="summary-stat"><span>{{ t.publishedVersion }}</span><strong>v{{ process?.version }}</strong><small>{{ tr('reviewSteps', { count: publishedApprovals.length }) }}</small></div>
        </section>
        <div v-if="tab !== 'process'" class="columns">
          <section class="request-column">
            <form v-if="tab === 'requests'" ref="requestFormElement" class="card new-request" novalidate @submit.prevent="submit">
              <div class="card-heading"><div><p class="eyebrow">{{ t.startHere }}</p><h2>{{ requestType === 'procurement' ? t.newProcurement : t.newRequest }}</h2></div><span class="small-icon"><UiIcon name="arrow" /></span></div>
              <label class="request-type-selector">{{ t.requestType }}<select v-model="requestType" data-testid="request-type" :disabled="busy" @change="formAttempted = false"><option value="leave">{{ t.leaveType }}</option><option value="procurement">{{ t.procurementType }}</option></select></label>
              <div class="submission-template" data-testid="submission-template"><strong>{{ submissionProcess?.name }} · v{{ submissionProcess?.version }}</strong><p>{{ submissionApprovals.map(node => `${node.name} (${nodeSummary(node)})`).join(' → ') }}</p><small>{{ t.savedTemplate }}<template v-if="draftDirty"> {{ t.draftNotUsed }}</template></small></div>
              <p v-if="selfAssigned" class="warning">{{ t.selfAssignedWarning }}</p>
              <div class="request-form-fields" :class="{ 'procurement-title-row': requestType === 'procurement' }"><label class="request-title-field">{{ t.title }}<input v-model="title" data-testid="request-title" maxlength="120" :placeholder="requestType === 'procurement' ? t.procurementTitlePlaceholder : t.titlePlaceholder" required :disabled="busy" :aria-invalid="fieldInvalid('title') || undefined" :aria-describedby="fieldInvalid('title') ? 'title-error' : undefined"><small v-if="fieldInvalid('title')" id="title-error" class="field-error">{{ t.businessError_title }}</small></label>
              <label v-if="requestType === 'leave'" class="request-days-field">{{ t.days }}<input v-model="days" data-testid="request-days" type="number" min="1" max="365" step="1" required :disabled="busy"></label></div>
              <template v-if="requestType === 'procurement'">
                <label>{{ t.businessId }}<input v-model="businessId" data-testid="request-business-id" maxlength="128" :placeholder="t.businessIdPlaceholder" required :disabled="busy" :aria-invalid="fieldInvalid('businessId') || undefined" aria-describedby="business-id-help"><small id="business-id-help" :class="fieldInvalid('businessId') ? 'field-error' : 'field-help'">{{ t.businessError_businessId }}</small></label>
                <label>{{ t.item }}<input v-model="itemName" data-testid="request-item" maxlength="240" :placeholder="t.itemPlaceholder" required :disabled="busy" :aria-invalid="fieldInvalid('item') || undefined" :aria-describedby="fieldInvalid('item') ? 'item-error' : undefined"><small v-if="fieldInvalid('item')" id="item-error" class="field-error">{{ t.businessError_item }}</small></label>
                <div class="procurement-price-fields">
                  <label>{{ t.quantity }}<input v-model="quantity" data-testid="request-quantity" type="text" inputmode="numeric" maxlength="6" required :disabled="busy" :aria-invalid="fieldInvalid('quantity') || undefined" aria-describedby="quantity-help"><small id="quantity-help" :class="fieldInvalid('quantity') ? 'field-error' : 'field-help'">{{ t.businessError_quantity }}</small></label>
                  <label>{{ t.unitPrice }}<input v-model="unitPrice" data-testid="request-unit-price" type="text" inputmode="decimal" maxlength="14" placeholder="0.00" required :disabled="busy" :aria-invalid="fieldInvalid('unitPrice') || undefined" aria-describedby="unit-price-help"></label>
                  <label>{{ t.currency }}<select v-model="currency" data-testid="request-currency" :disabled="busy" :aria-invalid="fieldInvalid('currency') || undefined"><option v-for="code in SUPPORTED_CURRENCIES" :key="code" :value="code">{{ code }}</option></select></label>
                </div>
                <p id="unit-price-help" class="price-help" :class="fieldInvalid('unitPrice') ? 'field-error' : 'field-help'">{{ currency === 'JPY' ? t.jpyPriceHelp : t.businessError_unitPrice }}</p>
                <div class="procurement-total"><span>{{ t.calculatedTotal }}<small>{{ t.totalHelp }}</small></span><output data-testid="procurement-total" aria-live="polite">{{ total === null ? '—' : money(total, currency) }}</output></div>
              </template>
              <label>{{ requestType === 'procurement' ? t.businessReason : t.reason }}<textarea v-model="reason" data-testid="request-reason" maxlength="2000" rows="3" :placeholder="t.reasonPlaceholder" required :disabled="busy" :aria-invalid="fieldInvalid('reason') || undefined" :aria-describedby="fieldInvalid('reason') ? 'reason-error' : undefined"></textarea><small v-if="fieldInvalid('reason')" id="reason-error" class="field-error">{{ t.businessError_reason }}</small></label>
              <div class="form-footer"><span>{{ tr('sentAs', { name: displayName(me) }) }}</span><button class="primary" data-testid="submit-request" :disabled="busy || selfAssigned || !process">{{ busy ? t.working : t.submit }}</button></div>
            </form>
            <section class="card request-list"><div class="card-heading"><h2>{{ tab === 'handled' ? t.myDecisions : tab === 'inbox' ? t.pendingDecisions : t.yourVisibleRequests }}</h2><span class="count">{{ isInbox ? tr('loadedItems', { count: visible.length }) : visible.length }}</span></div>
              <template v-if="isInbox">
                <form class="inbox-filters" data-testid="inbox-filters" @submit.prevent="applyFilters">
                  <label>{{ t.currentStatus }}<select v-model="statusFilter" data-testid="inbox-status" :disabled="busy"><option value="">{{ t.allStatuses }}</option><option value="PENDING">{{ t.status_PENDING }}</option><option value="APPROVED">{{ t.status_APPROVED }}</option><option value="REJECTED">{{ t.status_REJECTED }}</option></select></label>
                  <label>{{ t.processVersionFilter }}<input v-model="versionFilter" data-testid="inbox-version" type="number" min="1" step="1" :placeholder="t.allVersions" :disabled="busy"></label>
                  <button class="secondary" :disabled="busy">{{ t.applyFilters }}</button>
                </form>
                <p class="footnote">{{ tab === 'handled' ? t.handledDescription : t.pendingDescription }}</p>
                <p class="footnote">{{ t.liveInboxNote }}</p>
                <p v-if="inboxPage.error" class="error" role="alert">{{ apiFailure(inboxPage.error, 'inbox', locale) }} <button class="secondary" data-testid="inbox-retry" :disabled="busy || inboxPage.loading" @click="inbox.load(inboxBox, inboxPage.loaded)">{{ t.retryInbox }}</button></p>
                <p v-if="inboxPage.loading" role="status">{{ t.loadingInbox }}</p>
              </template>
              <p v-if="!visible.length && (!isInbox || (inboxPage.loaded && !inboxPage.loading && !inboxPage.error))" class="empty">{{ isInbox ? t.noMatchingInbox : t.noRequests }}</p>
              <button v-for="item in visible" :key="item.id" class="request-item" :class="{selected: selectedId === item.id}" :aria-pressed="selectedId === item.id" @click="select(item)"><span class="request-glyph"><UiIcon name="requests" /></span><span class="request-summary"><strong>{{ item.title }}</strong><small>{{ person(item.applicantId) }} · {{ businessSummary(item) }}<template v-if="item.status === 'PENDING'"> · {{ tr('awaiting', { names: pendingNames(item) }) }}</template></small></span><span class="status" :class="item.status.toLowerCase()">{{ statusLabel(item.status) }}</span></button>
              <button v-if="isInbox && inboxPage.nextCursor" class="secondary inbox-more" data-testid="inbox-more" :disabled="busy || inboxPage.loading" @click="inbox.load(inboxBox, true)">{{ inboxPage.loading ? t.loadingInbox : t.loadMore }}</button>
              <p v-else-if="isInbox && inboxPage.loaded && visible.length && !inboxPage.loading && !inboxPage.error" class="footnote">{{ t.endOfInbox }}</p>
            </section>
          </section>
          <aside class="detail card">
            <template v-if="selected">
              <div class="card-heading"><p class="eyebrow">{{ t.requestDetails }}</p><span class="status" :class="selected.status.toLowerCase()">{{ statusLabel(selected.status) }}</span></div>
              <h2>{{ selected.title }}</h2><p class="detail-reason">{{ selected.reason }}</p>
              <dl><div><dt>{{ t.applicant }}</dt><dd>{{ person(selected.applicantId) }}</dd></div><div><dt>{{ selected.status === 'PENDING' ? t.awaitingVotes : t.lastVoter }}</dt><dd>{{ selected.status === 'PENDING' ? pendingNames(selected) : person(selected.approverId) }}</dd></div><div v-if="!selectedBusiness || selectedBusiness.type === 'leave'"><dt>{{ t.duration }}</dt><dd>{{ duration(selected.days) }}</dd></div><div><dt>{{ t.savedProcess }}</dt><dd>{{ selected.processId }} · v{{ selected.processVersion }}</dd></div></dl>
              <section class="business-details" data-testid="business-details">
                <div class="business-snapshot-heading"><h3>{{ selectedBusiness?.type === 'procurement' ? t.procurementType : selectedBusiness?.type === 'invalid' ? t.businessSnapshot : t.leaveType }}</h3><span class="snapshot-label">{{ t.immutableBusiness }}</span></div>
                <p v-if="selectedBusiness?.type === 'invalid'" role="alert" class="error">{{ t.invalidBusinessSnapshot }}</p>
                <dl v-else-if="selectedBusiness" class="business-facts">
                  <div class="business-reference"><dt>{{ t.businessId }}</dt><dd>{{ selectedBusiness.businessId }}</dd></div>
                  <template v-if="selectedBusiness.type === 'procurement'">
                    <div class="business-item"><dt>{{ t.item }}</dt><dd>{{ selectedBusiness.item }}</dd></div>
                    <div><dt>{{ t.quantity }}</dt><dd>{{ selectedBusiness.quantity }}</dd></div><div><dt>{{ t.unitPrice }}</dt><dd>{{ money(selectedBusiness.unitPrice, selectedBusiness.currency) }}</dd></div>
                    <div><dt>{{ t.currency }}</dt><dd>{{ selectedBusiness.currency }}</dd></div><div class="business-total"><dt>{{ t.calculatedTotal }}</dt><dd>{{ money(procurementTotal(selectedBusiness.quantity, selectedBusiness.unitPrice, selectedBusiness.currency), selectedBusiness.currency) }}</dd></div>
                  </template>
                  <div v-else><dt>{{ t.duration }}</dt><dd>{{ duration(selectedBusiness.days) }}</dd></div>
                </dl>
                <p v-else class="footnote legacy-business">{{ t.legacyLeave }}</p>
                <p v-if="selectedBusiness?.type === 'procurement'" class="footnote">{{ t.totalHelp }}</p>
              </section>
              <p v-if="currentNode?.type === 'parallelApproval'" class="group-rule current-rule">{{ groupRule(currentNode) }}</p>
              <form v-if="canDecide" @submit.prevent="decide('APPROVE')" class="decision-form"><p class="decision-context">{{ t.reviewing }} <strong>{{ currentNode?.name }}</strong></p><label>{{ t.decisionComment }} <span class="muted">{{ t.optional }}</span><textarea v-model="comment" data-testid="decision-comment" maxlength="2000" rows="3" :disabled="busy"></textarea></label><div class="decision-actions"><button type="button" class="danger" data-testid="reject-decision" :disabled="busy" @click="decide('REJECT')">{{ currentNode?.type === 'parallelApproval' ? t.rejectVote : t.rejectRequest }}</button><button class="primary" data-testid="approve-decision" :disabled="busy">{{ currentNode?.type === 'parallelApproval' ? t.approveVote : followingNode ? t.approveStep : t.approveRequest }}</button></div></form>
              <p v-else-if="unconfirmedDecisionIds.has(selected.id)" class="warning">{{ selectedBusiness ? t.invalidDecisionSnapshot : t.decisionNeedsRefresh }}</p><p v-else-if="selected.status === 'PENDING' && selectedBusiness?.type !== 'invalid'" class="footnote">{{ t.whoCanDecide }}</p>
              <section v-if="selectedBusiness?.type !== 'invalid'" class="instance-snapshot" data-testid="instance-snapshot">
                <h3>{{ t.savedSequence }}</h3><p class="footnote">{{ selected.definition?.name }} · v{{ selected.definition?.version }} · {{ t.readOnlySnapshot }}</p>
                <ol class="snapshot-steps"><li v-for="node in selected.definition?.nodes" :key="node.id" :class="stepState(selected, node)" :data-step-id="node.id"><span class="snapshot-dot" aria-hidden="true"></span><div><strong>{{ node.name }}</strong><small v-if="isApproval(node)">{{ nodeSummary(node) }}</small>
                  <div v-if="node.type === 'parallelApproval'" class="participant-votes" :aria-label="tr('participantVotes', { name: node.name })"><div v-for="vote in participantVotes(selected, node)" :key="vote.actorId" class="participant-vote" :data-participant="vote.actorId"><span>{{ person(vote.actorId) }} · {{ voteLabel(vote.state) }}</span><small v-if="vote.at">{{ date(vote.at) }}</small><p v-if="vote.comment">{{ vote.comment }}</p></div></div></div><span class="step-state">{{ stateLabel(stepState(selected, node)) }}</span></li></ol>
                <p v-if="selected.status === 'PENDING'" class="next-step"><strong>{{ t.now }}</strong> {{ currentNode?.name }} · {{ pendingNames(selected) }}<br><template v-if="followingNode"><strong>{{ t.next }}</strong> {{ followingNode.name }} · {{ nodeSummary(followingNode) }}</template><template v-else>{{ t.finalStep }}</template></p>
              </section>
              <h3 class="history-heading">{{ t.activity }}</h3><ol class="timeline"><li v-for="(entry, index) in history" :key="index"><strong>{{ historyLabel(entry) }}</strong><p>{{ person(entry.actorId) }}</p><small>{{ date(entry.at) }}</small><p v-if="entry.comment" class="decision-comment">{{ entry.comment }}</p></li><li v-if="selected.status === 'PENDING'" class="waiting"><strong>{{ t.awaitingReview }} · {{ currentNode?.name }}</strong><p>{{ pendingNames(selected) }}</p></li></ol>
              <details class="snapshot-json"><summary>{{ t.inspectSnapshot }}</summary><pre>{{ JSON.stringify(selected.definition, null, 2) }}</pre></details><small class="request-id">{{ selected.id }}</small>
            </template>
            <div v-else class="detail-empty"><span><UiIcon name="review" /></span><h2>{{ t.fullPicture }}</h2><p>{{ t.selectRequest }}</p></div>
          </aside>
        </div>
        <footer class="page-footer">{{ t.footer }} <span>{{ t.footerNote }}</span></footer>
      </div>
    </section>
  </div>
</template>
