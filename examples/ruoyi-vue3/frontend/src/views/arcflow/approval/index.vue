<script setup name="ArcflowApproval">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import useUserStore from '@/store/modules/user'
import { createInboxBoxes, createMemberInbox } from './inbox'
import { getMe, getPeople, getProcess, getRequests, getInbox, publishProcess, submitRequest, submitDocument, decideRequest } from '@/api/arcflow/approval'
import { approvals, approvalMode, canVote, clone, modeLabel, modeRule, participantVotes, participants, pendingParticipants, setApprovalMode, stepState, validText, validateDefinition } from './process'
import { createSubmissionIntent, isRejectedSubmissionVersion } from './submission-intent'
import { validateSubmissionResponse, validateDecisionResponse } from './submission-response'
import { SUPPORTED_CURRENCIES, businessDocumentErrors, formatMoney, parseUnitPrice, procurementTotal, requestBusiness } from './business-document'
import { nativeMessages, translateProcess } from './locale'

const locale = ref('zh-CN'), t = computed(() => nativeMessages(locale.value))
const tr = value => translateProcess(value, locale.value)
const me = ref(null), people = ref([]), process = ref(null), draft = ref(null), baseline = ref('')
const requests = ref([]), selectedId = ref(null), selectedDetail = ref(null), tab = ref('mine'), busy = ref(false)
const errorKey = ref(''), noticeKey = ref(''), noticeVersion = ref(null), refreshRequired = ref(false), publishUncertain = ref(false)
const error = computed(() => t.value[errorKey.value] || tr(errorKey.value))
const notice = computed(() => noticeKey.value === 'publishedNotice' ? t.value.publishedNotice(noticeVersion.value) : t.value[noticeKey.value] || '')
const title = ref(''), reason = ref(''), days = ref(1), comment = ref('')
const businessType = ref('leave'), businessId = ref(''), item = ref(''), quantity = ref('1'), unitPrice = ref(''), currency = ref('CNY')
const submitTried = ref(false), errorsElement = ref(null)
const business = computed(() => ({ type: 'procurement', businessId: businessId.value, title: title.value, reason: reason.value, item: item.value, quantity: quantity.value, unitPrice: unitPrice.value, currency: currency.value }))
const fieldErrors = computed(() => {
  if (businessType.value === 'procurement') return businessDocumentErrors(business.value)
  if (businessType.value !== 'leave') return ['type']
  const fields = []
  if (!validText(title.value, 120)) fields.push('title')
  if (!reason.value.trim() || reason.value.length > 2000) fields.push('reason')
  if (!Number.isInteger(days.value) || days.value < 1 || days.value > 365) fields.push('days')
  return fields
})
const fieldError = field => submitTried.value && fieldErrors.value.includes(field) ? t.value.errors[field] : ''
const total = computed(() => procurementTotal(quantity.value, unitPrice.value, currency.value))
const money = (amount, code) => amount === null ? '—' : formatMoney(amount, code, locale.value)
const submissionIntent = createSubmissionIntent(), submissionAttempt = ref(null), submissionDefinition = ref(null)
let submissionVersionRejected = false
const submissionFields = () => businessType.value === 'procurement' ? { business: business.value } : { title: title.value, reason: reason.value, days: days.value }
function clearBusinessDraft() {
  title.value = ''; reason.value = ''; days.value = 1; businessType.value = 'leave'
  businessId.value = ''; item.value = ''; quantity.value = '1'; unitPrice.value = ''; currency.value = 'CNY'; submitTried.value = false
}
function clearSubmission() { submissionIntent.clear(); submissionAttempt.value = null; submissionDefinition.value = null; submissionVersionRejected = false }
watch([() => me.value?.id, businessType, businessId, title, reason, days, item, quantity, unitPrice, currency], () => {
  submissionIntent.invalidate(me.value?.id, submissionFields())
  if (!submissionIntent.current(me.value?.id, submissionFields())) clearSubmission()
}, { flush: 'sync' })
const submissionProcess = computed(() => submissionAttempt.value ? submissionDefinition.value : process.value)
const dirty = computed(() => draft.value && JSON.stringify(draft.value) !== baseline.value)
const draftSteps = computed(() => approvals(draft.value))
const draftError = computed(() => validateDefinition(draft.value, people.value))
const stale = computed(() => publishUncertain.value || draft.value?.version !== process.value?.version)
// Never reinterpret an invalid or unknown typed document as legacy leave.
function documentView(request) {
  if (!request) return { type: 'invalid', business: null }
  try {
    const value = requestBusiness(request)
    if (value) validateSubmissionResponse(request, request.applicantId, { business: value, processVersion: request.processVersion }, request.definition)
    return { type: value?.type || 'leave', business: value }
  }
  catch { return { type: 'invalid', business: null } }
}
const userStore = useUserStore()
const boxes = reactive(createInboxBoxes())
const selected = computed(() => selectedDetail.value?.id === selectedId.value ? selectedDetail.value : requests.value.find(item => item.id === selectedId.value))
const inboxBox = computed(() => tab.value === 'inbox' ? 'PENDING' : tab.value === 'handled' ? 'HANDLED' : null)
const activeInbox = computed(() => inboxBox.value ? boxes[inboxBox.value] : null)
// Echo controlled ElInput updates immediately without changing the active
// server-side filters until change/blur. Each inbox keeps its own draft.
const versionDrafts = reactive({ PENDING: '', HANDLED: '' })
const inboxVersionDraft = computed({
  get: () => inboxBox.value ? versionDrafts[inboxBox.value] : '',
  set: value => { if (inboxBox.value) versionDrafts[inboxBox.value] = value ?? '' }
})
function resetInboxDrafts() { versionDrafts.PENDING = ''; versionDrafts.HANDLED = '' }
const memberInbox = createMemberInbox({ boxes, loadPage: getInbox, canVote: (request, actor) => documentView(request).type !== 'invalid' && canVote(request, actor),
  onPage(items) {
    requests.value = memberInbox.remember(requests.value)
    const updated = items.find(item => item.id === selectedId.value)
    if (updated) { if (updated.currentStepId !== selected.value?.currentStepId) comment.value = ''; selectedDetail.value = updated }
  },
  onUnauthorized() { resetSession(); refreshRequired.value = true; errorKey.value = 'sessionExpired' }
})
const visible = computed(() => activeInbox.value ? activeInbox.value.items : tab.value === 'mine' ? requests.value.filter(item => item.applicantId === me.value?.id) : requests.value)
let viewGeneration = 0, refreshController = null, disposed = false
const session = () => userStore.token
function currentView(generation, token) { return !disposed && generation === viewGeneration && token === session() }
function resetSession() {
  viewGeneration++; refreshController?.abort(); refreshController = null; memberInbox.setIdentity(null); memberInbox.reset()
  me.value = null; requests.value = []; people.value = []; process.value = null; draft.value = null; baseline.value = ''
  selectedId.value = null; selectedDetail.value = null; comment.value = ''; busy.value = false; clearSubmission()
  clearBusinessDraft(); resetInboxDrafts()
  noticeKey.value = ''; errorKey.value = ''; noticeVersion.value = null; refreshRequired.value = false; publishUncertain.value = false
}
watch(session, () => {
  resetSession()
  if (session()) void refresh()
  else { refreshRequired.value = true; errorKey.value = 'signedOut' }
}, { flush: 'sync' })
watch(tab, () => {
  selectedId.value = null; selectedDetail.value = null; comment.value = ''
  if (inboxBox.value && !activeInbox.value.loaded && !activeInbox.value.loading) void memberInbox.load(inboxBox.value)
}, { flush: 'sync' })
function filterInbox(field, value) {
  if (!inboxBox.value) return
  selectedId.value = null; selectedDetail.value = null; comment.value = ''
  if (field === 'processVersion') versionDrafts[inboxBox.value] = value ?? ''
  void memberInbox.setFilters(inboxBox.value, { [field]: value ?? '' })
}
function refreshInbox() {
  if (inboxBox.value) { selectedId.value = null; selectedDetail.value = null; comment.value = ''; return memberInbox.load(inboxBox.value, { restart: true }) }
}
function loadMore() { if (inboxBox.value) return memberInbox.load(inboxBox.value) }
const selectedDocument = computed(() => documentView(selected.value))
const canDecide = computed(() => selectedDocument.value.type !== 'invalid' && canVote(selected.value, me.value?.id))
const selfAssigned = computed(() => approvals(submissionProcess.value).some(node => participants(node).includes(me.value?.id)))
const locked = computed(() => busy.value || refreshRequired.value || !me.value)
const person = id => people.value.find(value => String(value.id) === id)?.displayName || id || '—'
const date = value => value ? new Date(value).toLocaleString(locale.value === 'en' ? 'en-GB' : 'zh-CN') : '—'
const status = value => tr(({ PENDING: '审批中', APPROVED: '已通过', REJECTED: '已拒绝' })[value] || value)
const action = value => tr(({ SUBMIT: '提交', APPROVE: '通过', REJECT: '拒绝' })[value] || value)
const businessTotal = value => money(procurementTotal(value.quantity, value.unitPrice, value.currency), value.currency)
const businessPrice = value => money(parseUnitPrice(value.unitPrice, value.currency), value.currency)
function summary(request) {
  const view = documentView(request)
  return view.type === 'invalid' ? t.value.invalid : view.type === 'procurement' ? businessTotal(view.business) : `${view.business?.days ?? request.days} ${t.value.days}`
}
function resetDraft() {
  if (busy.value || !process.value) return
  draft.value = clone(process.value); baseline.value = JSON.stringify(draft.value); publishUncertain.value = false
}
async function refresh() {
  if (busy.value || disposed || !session()) return
  busy.value = true; errorKey.value = ''; noticeKey.value = ''
  const generation = ++viewGeneration, token = session(), controller = new AbortController()
  refreshController?.abort(); refreshController = controller; memberInbox.cancelAll()
  let preserve = dirty.value
  const requiredAtStart = refreshRequired.value
  const previousStep = selected.value?.currentStepId
  try {
    const identity = await getMe(controller.signal)
    if (!currentView(generation, token)) return
    if (!identity.data?.id) throw new Error('Missing authenticated identity')
    if (me.value && me.value.id !== identity.data.id) {
      requests.value = []; selectedId.value = null; selectedDetail.value = null; comment.value = ''
      draft.value = null; baseline.value = ''; preserve = false; clearSubmission(); resetInboxDrafts()
    }
    me.value = identity.data; memberInbox.setIdentity(identity.data.id)
    const [persons, blueprint, items] = await Promise.all([
      getPeople(controller.signal), getProcess(controller.signal), getRequests(controller.signal),
      memberInbox.load('PENDING', { restart: true }), memberInbox.load('HANDLED', { restart: true })
    ])
    if (!currentView(generation, token)) return
    if (!Array.isArray(items.data) || items.data.some(value => !value || typeof value !== 'object' || Array.isArray(value) || !Array.isArray(value.history))) throw new Error('Invalid request list')
    people.value = persons.data; process.value = blueprint.data; requests.value = memberInbox.remember(items.data)
    selectedDetail.value = requests.value.find(item => item.id === selectedId.value) || null
    if (submissionVersionRejected) clearSubmission()
    if (!preserve) { draft.value = clone(blueprint.data); baseline.value = JSON.stringify(draft.value) }
    if (previousStep !== selected.value?.currentStepId) comment.value = ''
    refreshRequired.value = requiredAtStart && !!(boxes.PENDING.error || boxes.HANDLED.error)
    noticeKey.value = boxes.PENDING.error || boxes.HANDLED.error ? 'partialLoad' : preserve ? 'preserved' : 'loaded'
  } catch (e) {
    if (!currentView(generation, token)) return
    if ([401, 403].includes(e?.response?.status ?? e?.code)) resetSession()
    controller.abort(); memberInbox.cancelAll(); refreshRequired.value = true
    errorKey.value = 'loadFailed'
  } finally { if (currentView(generation, token)) { busy.value = false; refreshController = null } }
}
function addStep() {
  if (locked.value || !me.value?.canPublish || draftSteps.value.length >= 8 || !draft.value) return
  let suffix = 1
  while (draft.value.nodes.some(node => node.id === `approval-${suffix}`)) suffix++
  draft.value.nodes.splice(-1, 0, { id: `approval-${suffix}`, type: 'approval', name: `${t.value.step} ${draftSteps.value.length + 1}`, assigneeId: people.value[0] ? String(people.value[0].id) : '' })
}
function changeMode(id, mode) {
  if (locked.value || !me.value?.canPublish) return
  draft.value = setApprovalMode(draft.value, id, mode)
}
function removeStep(id) {
  if (locked.value || !me.value?.canPublish || draftSteps.value.length <= 1) return
  draft.value.nodes = draft.value.nodes.filter(node => node.id !== id)
}
function moveStep(id, direction) {
  if (locked.value || !me.value?.canPublish) return
  const index = draft.value.nodes.findIndex(node => node.id === id), target = index + direction
  if (index < 1 || target < 1 || target >= draft.value.nodes.length - 1) return
  const [node] = draft.value.nodes.splice(index, 1); draft.value.nodes.splice(target, 0, node)
}
function mutationFailure(kind, failure) {
  if ([401, 403].includes(failure?.response?.status ?? failure?.code)) { resetSession(); refreshRequired.value = true; errorKey.value = 'sessionExpired'; return }
  // Native interceptors can discard AjaxResult codes. An error is not proof that
  // a write failed: retain the input, immutable intent, endpoint and secure key.
  refreshRequired.value = true
  if (kind === 'publish') publishUncertain.value = true
  errorKey.value = 'uncertain'
}
async function publish() {
  if (locked.value || !me.value?.canPublish || !dirty.value || stale.value) return
  if (draftError.value) { errorKey.value = draftError.value; return }
  busy.value = true; errorKey.value = ''; noticeKey.value = ''
  const generation = viewGeneration, token = session()
  const definition = clone(draft.value)
  definition.name = definition.name.trim()
  definition.nodes.forEach(node => { node.name = node.name.trim() })
  try {
    const response = await publishProcess({ expectedVersion: definition.version, definition })
    if (!currentView(generation, token)) return
    process.value = response.data; draft.value = clone(response.data); baseline.value = JSON.stringify(draft.value)
    noticeVersion.value = response.data.version; noticeKey.value = 'publishedNotice'
  } catch (e) { if (currentView(generation, token)) mutationFailure('publish', e) }
  finally { if (currentView(generation, token)) busy.value = false }
}
async function submit() {
  if (locked.value || !process.value || selfAssigned.value) return
  submitTried.value = true
  if (fieldErrors.value.length) { await nextTick(); errorsElement.value?.focus(); return }
  busy.value = true; errorKey.value = ''; noticeKey.value = ''
  const generation = viewGeneration, token = session()
  try {
    if (!submissionAttempt.value) submissionDefinition.value = clone(process.value)
    const attempt = submissionIntent.prepare(me.value.id, submissionFields(), process.value.version)
    submissionAttempt.value = attempt
    const transport = attempt.endpoint === '/documents' ? submitDocument : submitRequest
    const { data } = await transport(attempt.payload, attempt.key)
    if (!currentView(generation, token)) return
    validateSubmissionResponse(data, me.value.id, attempt.payload, submissionDefinition.value)
    clearSubmission()
    requests.value = [memberInbox.remember([data])[0], ...requests.value.filter(value => value.id !== data.id)]
    tab.value = 'mine'; selectedId.value = data.id; selectedDetail.value = data; title.value = ''; reason.value = ''; days.value = 1; comment.value = ''
    businessId.value = ''; item.value = ''; quantity.value = '1'; unitPrice.value = ''; submitTried.value = false
    noticeKey.value = data.status === 'PENDING' ? 'submitted' : data.status === 'APPROVED' ? 'approved' : 'rejected'
  } catch (e) { if (currentView(generation, token)) { submissionVersionRejected = isRejectedSubmissionVersion(e); mutationFailure('submit', e) } }
  finally { if (currentView(generation, token)) busy.value = false }
}
async function decide(decision) {
  if (locked.value || !canDecide.value || comment.value.length > 2000) return
  const original = selected.value, id = original.id, stepId = original.currentStepId
  const generation = viewGeneration, token = session()
  memberInbox.cancelAll()
  busy.value = true; errorKey.value = ''; noticeKey.value = ''
  try {
    const { data } = await decideRequest(id, { stepId, decision, comment: comment.value.trim() })
    if (!currentView(generation, token)) return
    validateDecisionResponse(data, original, me.value.id, stepId, decision)
    memberInbox.reconcile(data)
    if (selectedId.value === id) selectedDetail.value = data
    requests.value = requests.value.map(value => value.id === data.id ? data : value); comment.value = ''
    noticeKey.value = data.status !== 'PENDING' ? data.status === 'APPROVED' ? 'approved' : 'rejected' : data.currentStepId === stepId ? 'partialVote' : 'nextStep'
    await Promise.all(['PENDING', 'HANDLED'].map(box => memberInbox.load(box, { restart: true })))
  } catch (e) { if (currentView(generation, token)) mutationFailure('decide', e) }
  finally { if (currentView(generation, token)) busy.value = false }
}
function select(row) { selectedId.value = row?.id || null; selectedDetail.value = row || null; comment.value = '' }
onMounted(refresh)
onUnmounted(() => { disposed = true; viewGeneration++; refreshController?.abort(); memberInbox.dispose() })
</script>

<template>
  <div class="app-container arcflow-approval" :lang="locale">
    <div class="page-header">
      <div><h2>{{ t.heading }}</h2><p>{{ t.currentUser }}{{ me?.displayName || t.loading }} · {{ t.published }} v{{ process?.version || '—' }}</p></div>
      <div class="header-actions">
        <label for="arcflow-language" class="sr-only">{{ t.language }}</label>
        <select id="arcflow-language" v-model="locale" data-testid="language-select" class="native-select language-select"><option value="zh-CN">简体中文</option><option value="en">English</option></select>
        <el-button v-hasPermi="['arcflow:request:read']" :loading="busy" @click="refresh">{{ t.refresh }}</el-button>
      </div>
    </div>
    <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon class="message" />
    <el-alert v-if="notice" :title="notice" type="success" :closable="false" show-icon class="message" />
    <el-tabs v-model="tab">
      <el-tab-pane :label="t.mine" name="mine" />
      <el-tab-pane :label="t.inbox" name="inbox" />
      <el-tab-pane :label="t.handled" name="handled" />
      <el-tab-pane :label="t.all" name="all" />
      <el-tab-pane :label="t.designer" name="process" />
    </el-tabs>
    <template v-if="tab === 'process'">
      <el-alert :title="t.processInfo" type="info" :closable="false" class="message" />
      <el-alert v-if="stale" :title="t.stale" type="warning" :closable="false" class="message" />
      <el-card v-if="draft" shadow="never">
        <el-form label-width="110px" :disabled="locked || !me?.canPublish">
          <el-form-item :label="t.processName"><el-input v-model="draft.name" maxlength="120" show-word-limit /></el-form-item>
          <div class="fixed-node">{{ t.start }}</div>
          <div v-for="(node, index) in draftSteps" :key="node.id" class="approval-node">
            <strong>{{ t.step }} {{ index + 1 }}</strong>
            <el-input v-model="node.name" maxlength="120" :aria-label="`${t.step} ${index + 1} ${t.nodeName}`" :placeholder="t.nodePlaceholder" />
            <el-select :model-value="approvalMode(node)" @update:model-value="changeMode(node.id, $event)" :aria-label="`${t.step} ${index + 1} ${t.mode}`">
              <el-option :label="t.SINGLE" value="SINGLE" /><el-option :label="t.ALL" value="ALL" /><el-option :label="t.ANY" value="ANY" />
            </el-select>
            <el-select v-if="node.type === 'approval'" v-model="node.assigneeId" filterable :placeholder="t.chooseReviewer" :aria-label="`${t.step} ${index + 1} ${t.reviewer}`">
              <el-option v-for="user in people" :key="user.id" :label="`${user.displayName} (${user.id})`" :value="String(user.id)" />
            </el-select>
            <el-select v-else v-model="node.assigneeIds" multiple filterable :multiple-limit="16" :placeholder="t.chooseMembers" :aria-label="`${t.step} ${index + 1} ${t.members}`">
              <el-option v-for="user in people" :key="user.id" :label="`${user.displayName} (${user.id})`" :value="String(user.id)" />
            </el-select>
            <p class="group-rule">{{ tr(modeRule(node)) }}</p>
            <div class="node-actions" v-hasPermi="['arcflow:process:publish']">
              <el-button :disabled="index === 0" @click="moveStep(node.id, -1)" :aria-label="`${t.up}${t.step} ${index + 1}`">{{ t.up }}</el-button>
              <el-button :disabled="index === draftSteps.length - 1" @click="moveStep(node.id, 1)" :aria-label="`${t.down}${t.step} ${index + 1}`">{{ t.down }}</el-button>
              <el-button type="danger" plain :disabled="draftSteps.length <= 1" @click="removeStep(node.id)">{{ t.remove }}</el-button>
            </div>
          </div>
          <div class="fixed-node">{{ t.end }}</div>
          <el-form-item v-hasPermi="['arcflow:process:publish']">
            <el-button :disabled="draftSteps.length >= 8" @click="addStep">{{ t.addStep }}</el-button>
            <el-button type="primary" :loading="busy" :disabled="!dirty || !!draftError || stale" @click="publish">{{ t.publish }}</el-button>
          </el-form-item>
        </el-form>
        <p v-if="draftError" class="validation" role="alert">{{ tr(draftError) }}</p>
        <el-button v-if="me?.canPublish" v-hasPermi="['arcflow:process:publish']" :disabled="busy || refreshRequired" @click="resetDraft">{{ t.discard }}</el-button>
        <p v-if="!me?.canPublish">{{ t.readOnly }}</p>
      </el-card>
    </template>
    <el-row v-else :gutter="20">
      <el-col :xs="24" :lg="14">
        <el-card v-if="tab === 'mine'" v-hasPermi="['arcflow:request:submit']" shadow="never" class="message author-card">
          <template #header>{{ t.formHeading }}</template>
          <el-alert v-if="selfAssigned" :title="t.selfAssigned" type="warning" :closable="false" class="message" />
          <el-alert v-if="submissionAttempt" :title="t.retry" type="warning" :closable="false" class="message" />
          <p v-if="submitTried && fieldErrors.length" ref="errorsElement" data-testid="submission-errors" class="validation error-summary" role="alert" tabindex="-1">{{ t.reviewErrors }} {{ fieldErrors.map(field => t.errors[field]).join(' ') }}</p>
          <el-form label-width="110px" :disabled="locked || selfAssigned" @submit.prevent="submit">
            <fieldset :disabled="locked || selfAssigned" class="document-fields">
              <el-form-item :label="t.type" for="arcflow-type" required :error="fieldError('type')">
                <select id="arcflow-type" v-model="businessType" data-testid="business-type" class="native-select"><option value="leave">{{ t.leave }}</option><option value="procurement">{{ t.procurement }}</option></select>
              </el-form-item>
              <el-form-item v-if="businessType === 'procurement'" :label="t.businessId" for="arcflow-business-id" required :error="fieldError('businessId')">
                <div class="field-stack"><div class="el-input__wrapper"><input id="arcflow-business-id" v-model="businessId" data-testid="business-id" class="el-input__inner" maxlength="128" autocomplete="off" aria-describedby="business-id-help" :aria-invalid="!!fieldError('businessId')" /></div><p id="business-id-help" class="field-help">{{ t.businessIdHelp }}</p></div>
              </el-form-item>
              <el-form-item :label="t.title" required :error="fieldError('title')"><el-input v-model="title" maxlength="120" show-word-limit :aria-invalid="!!fieldError('title')" /></el-form-item>
              <el-form-item v-if="businessType === 'leave'" :label="t.days" required :error="fieldError('days')"><el-input-number v-model="days" :min="1" :max="365" :precision="0" /></el-form-item>
              <template v-if="businessType === 'procurement'">
                <el-form-item :label="t.item" for="arcflow-item" required :error="fieldError('item')"><div class="field-stack"><div class="el-input__wrapper"><input id="arcflow-item" v-model="item" data-testid="item" class="el-input__inner" maxlength="240" autocomplete="off" aria-describedby="item-help" :aria-invalid="!!fieldError('item')" /></div><p id="item-help" class="field-help">{{ t.itemHelp }}</p></div></el-form-item>
                <el-form-item :label="t.quantity" for="arcflow-quantity" required :error="fieldError('quantity')"><div class="field-stack"><div class="el-input__wrapper"><input id="arcflow-quantity" v-model="quantity" data-testid="quantity" class="el-input__inner" inputmode="numeric" autocomplete="off" aria-describedby="quantity-help" :aria-invalid="!!fieldError('quantity')" /></div><p id="quantity-help" class="field-help">{{ t.quantityHelp }}</p></div></el-form-item>
                <el-form-item :label="t.unitPrice" for="arcflow-unit-price" required :error="fieldError('unitPrice')"><div class="field-stack"><div class="el-input__wrapper"><input id="arcflow-unit-price" v-model="unitPrice" data-testid="unit-price" class="el-input__inner" inputmode="decimal" autocomplete="off" aria-describedby="price-help" :aria-invalid="!!fieldError('unitPrice')" /></div><p id="price-help" class="field-help">{{ t.priceHelp }}</p></div></el-form-item>
                <el-form-item :label="t.currency" for="arcflow-currency" required :error="fieldError('currency')"><select id="arcflow-currency" v-model="currency" data-testid="currency" class="native-select"><option v-for="code in SUPPORTED_CURRENCIES" :key="code" :value="code">{{ code }}</option></select></el-form-item>
              </template>
              <el-form-item :label="t.reason" required :error="fieldError('reason')"><el-input v-model="reason" type="textarea" :rows="3" maxlength="2000" show-word-limit :aria-invalid="!!fieldError('reason')" /></el-form-item>
              <div v-if="businessType === 'procurement'" class="total-summary"><span>{{ t.total }}</span><output data-testid="exact-total" aria-live="polite">{{ money(total, currency) }}</output><p>{{ t.totalHelp }}</p></div>
              <p class="field-help synthetic-notice">{{ t.synthetic }}</p>
              <el-form-item><el-button data-testid="submit-document" type="primary" native-type="submit" :loading="busy" :disabled="!process">{{ t.submit }} · v{{ submissionProcess?.version || '—' }}</el-button></el-form-item>
            </fieldset>
          </el-form>
        </el-card>
        <section v-if="activeInbox" class="inbox-controls" :aria-label="t.inboxFilters">
          <p>{{ inboxBox === 'PENDING' ? t.pendingHint : t.handledHint }}{{ t.overlapHint }}</p>
          <div class="inbox-filters">
            <el-select :model-value="activeInbox.status" @update:model-value="filterInbox('status', $event)" :aria-label="t.filterStatus" :disabled="busy">
              <el-option :label="t.allStatuses" value="" />
              <el-option :label="status('PENDING')" value="PENDING" />
              <el-option :label="status('APPROVED')" value="APPROVED" />
              <el-option :label="status('REJECTED')" value="REJECTED" />
            </el-select>
            <el-input v-model="inboxVersionDraft" @change="filterInbox('processVersion', $event)" :placeholder="t.allVersions" :aria-label="t.filterVersion" inputmode="numeric" :disabled="busy" clearable />
            <el-button :disabled="busy" @click="refreshInbox">{{ t.refreshInbox }}</el-button>
          </div>
          <p class="inbox-count" aria-live="polite">{{ t.loadedCount(activeInbox.items.length) }}</p>
          <el-alert v-if="activeInbox.error" :title="tr(activeInbox.error)" type="error" :closable="false" show-icon class="message" />
        </section>
        <el-table :data="visible" v-loading="busy || activeInbox?.loading" row-key="id" highlight-current-row @row-click="select" :empty-text="activeInbox?.error ? t.inboxFailed : activeInbox?.loading ? t.inboxLoading : activeInbox ? t.inboxEmpty : t.noRequests">
          <el-table-column prop="title" :label="t.title" min-width="150" show-overflow-tooltip />
          <el-table-column :label="t.type" min-width="100"><template #default="{ row }"><el-tag type="info">{{ t[documentView(row).type] }}</el-tag></template></el-table-column>
          <el-table-column :label="`${t.days} / ${t.total}`" min-width="135"><template #default="{ row }">{{ summary(row) }}</template></el-table-column>
          <el-table-column :label="t.applicant" min-width="100"><template #default="{ row }">{{ person(row.applicantId) }}</template></el-table-column>
          <el-table-column :label="t.status" width="100"><template #default="{ row }"><el-tag :type="row.status === 'REJECTED' ? 'danger' : row.status === 'APPROVED' ? 'success' : 'warning'">{{ status(row.status) }}</el-tag></template></el-table-column>
          <el-table-column :label="t.actions" width="85" fixed="right"><template #default="{ row }"><el-button link type="primary" @click.stop="select(row)">{{ t.details }}</el-button></template></el-table-column>
        </el-table>
        <div v-if="activeInbox" class="inbox-pagination">
          <el-button v-if="activeInbox.nextCursor || activeInbox.error" :loading="activeInbox.loading" :disabled="busy || activeInbox.loading" @click="loadMore">{{ activeInbox.error ? t.retryPage : t.loadMore }}</el-button>
          <span v-else-if="activeInbox.loaded && !activeInbox.loading">{{ t.inboxExhausted }}</span>
        </div>
      </el-col>
      <el-col :xs="24" :lg="10">
        <el-card v-if="selected" shadow="never" class="detail">
          <template #header><span class="prewrap">{{ selected.title }}</span></template>
          <section data-testid="business-detail" :aria-label="t.document">
            <h3>{{ t.document }}</h3><p class="field-help">{{ t.immutable }}</p>
            <el-alert v-if="selectedDocument.type === 'invalid'" :title="t.invalidBusiness" type="error" :closable="false" />
            <el-descriptions v-else :column="1" border>
              <el-descriptions-item :label="t.type">{{ t[selectedDocument.type] }}</el-descriptions-item>
              <el-descriptions-item v-if="selectedDocument.business" :label="t.businessId"><span data-testid="detail-business-id">{{ selectedDocument.business.businessId }}</span></el-descriptions-item>
              <template v-if="selectedDocument.type === 'procurement'">
                <el-descriptions-item :label="t.item"><span class="prewrap">{{ selectedDocument.business.item }}</span></el-descriptions-item>
                <el-descriptions-item :label="t.quantity">{{ selectedDocument.business.quantity }}</el-descriptions-item>
                <el-descriptions-item :label="t.unitPrice">{{ businessPrice(selectedDocument.business) }}</el-descriptions-item>
                <el-descriptions-item :label="t.currency">{{ selectedDocument.business.currency }}</el-descriptions-item>
                <el-descriptions-item :label="t.total"><strong data-testid="detail-total">{{ businessTotal(selectedDocument.business) }}</strong></el-descriptions-item>
              </template>
              <el-descriptions-item v-else :label="t.days">{{ selectedDocument.business?.days ?? selected.days }}</el-descriptions-item>
              <el-descriptions-item :label="t.reason"><span class="prewrap">{{ selected.reason }}</span></el-descriptions-item>
            </el-descriptions>
          </section>
          <template v-if="selectedDocument.type !== 'invalid'">
          <h3>{{ t.snapshot }}</h3>
          <el-descriptions :column="1" border>
            <el-descriptions-item :label="t.applicant">{{ person(selected.applicantId) }}</el-descriptions-item>
            <el-descriptions-item :label="t.status">{{ status(selected.status) }}</el-descriptions-item>
            <el-descriptions-item :label="t.approvers">{{ pendingParticipants(selected).map(person).join(', ') || '—' }}</el-descriptions-item>
            <el-descriptions-item :label="t.snapshot">{{ selected.definition?.name }} · v{{ selected.processVersion }}</el-descriptions-item>
          </el-descriptions>
          <h3>{{ t.snapshotHeading }}</h3>
          <ol class="snapshot">
            <li v-for="node in selected.definition?.nodes || []" :key="node.id">
              <strong>{{ node.name }}</strong> · {{ tr(stepState(selected, node)) }}
              <template v-if="participants(node).length"><span> · {{ tr(modeLabel(node)) }}</span><p class="snapshot-rule">{{ tr(modeRule(node)) }}</p><ul class="participant-votes"><li v-for="vote in participantVotes(selected, node)" :key="vote.actorId">{{ person(vote.actorId) }} · {{ tr(vote.state) }}<span v-if="vote.comment" class="prewrap"> · {{ vote.comment }}</span></li></ul></template>
            </li>
          </ol>
          <div v-if="canDecide" v-hasPermi="['arcflow:request:decide']" class="decision">
            <el-input v-model="comment" type="textarea" :rows="2" maxlength="2000" show-word-limit :disabled="locked" :placeholder="t.commentPlaceholder" :aria-label="t.comment" />
            <div class="decision-actions"><el-button type="success" :loading="busy" :disabled="locked" @click="decide('APPROVE')">{{ t.approve }}</el-button><el-button type="danger" :disabled="locked" @click="decide('REJECT')">{{ t.reject }}</el-button></div>
          </div>
          <h3>{{ t.history }}</h3>
          <el-timeline><el-timeline-item v-for="(entry, index) in selected.history || []" :key="`${entry.at}-${index}`" :timestamp="date(entry.at)">{{ person(entry.actorId) }} · {{ action(entry.action) }}<span v-if="entry.stepId"> · {{ selected.definition?.nodes.find(node => node.id === entry.stepId)?.name || entry.stepId }}</span><p v-if="entry.comment" class="prewrap">{{ entry.comment }}</p></el-timeline-item></el-timeline>
          </template>
        </el-card>
        <el-empty v-else :description="t.selectRequest" />
      </el-col>
    </el-row>
  </div>
</template>

<style scoped>
.page-header { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.page-header h2 { margin-top: 0; }
.page-header p, .field-help { color: var(--el-text-color-regular, #606266); }
.header-actions { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
.native-select { min-height: 34px; width: 100%; padding: 5px 10px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: var(--el-border-radius-base, 4px); background: var(--el-fill-color-blank, #fff); color: var(--el-text-color-regular, #606266); font: inherit; }
.language-select { width: 120px; }
.native-select:focus-visible, .el-input__wrapper:focus-within { outline: 2px solid var(--el-color-primary, #409eff); outline-offset: 2px; }
.document-fields { border: 0; padding: 0; margin: 0; min-width: 0; }
.document-fields:disabled .native-select, .document-fields:disabled .el-input__wrapper { background: var(--el-disabled-bg-color, #f5f7fa); cursor: not-allowed; }
.field-stack { width: 100%; min-width: 0; }
.field-stack .el-input__wrapper { display: flex; width: 100%; padding: 1px 11px; box-shadow: 0 0 0 1px var(--el-border-color, #dcdfe6) inset; border-radius: 4px; }
.field-stack .el-input__inner { width: 100%; height: 32px; min-width: 0; }
.field-help { font-size: 12px; line-height: 1.5; margin: 7px 0 0; overflow-wrap: anywhere; }
.synthetic-notice { margin-bottom: 18px; }
.total-summary { border: 1px solid var(--el-border-color-lighter, #ebeef5); background: var(--el-fill-color-light, #f5f7fa); padding: 14px 16px; border-radius: 4px; margin: 12px 0; }
.total-summary output { display: block; font-size: 24px; font-weight: 600; color: var(--el-text-color-primary, #303133); margin-top: 5px; overflow-wrap: anywhere; }
.total-summary p { color: var(--el-text-color-regular, #606266); font-size: 12px; margin-bottom: 0; }
.message { margin-bottom: 16px; }
.inbox-controls p, .inbox-pagination { color: var(--el-text-color-regular, #606266); line-height: 1.6; }
.inbox-filters { display: flex; flex-wrap: wrap; gap: 10px; }
.inbox-filters .el-select, .inbox-filters .el-input { width: 180px; max-width: 100%; }
.inbox-count { font-size: 13px; }
.inbox-pagination { margin: 16px 0; }
.approval-node { display: grid; grid-template-columns: 80px minmax(100px, 1fr) minmax(160px, 1fr) minmax(180px, 1fr); align-items: center; gap: 12px; padding: 16px; margin: 12px 0; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 6px; }
.group-rule { grid-column: 2 / -1; margin: 0; color: var(--el-text-color-regular, #606266); }
.snapshot-rule { margin: 6px 0; color: var(--el-text-color-regular, #606266); }
.participant-votes { padding-left: 20px; }
.approval-node .node-actions { grid-column: 2 / -1; }
.fixed-node { text-align: center; padding: 12px; background: var(--el-fill-color-light, #f5f7fa); border-radius: 6px; margin-bottom: 16px; }
.node-actions { display: flex; flex-wrap: wrap; gap: 6px; }
.node-actions .el-button { margin-left: 0; }
.validation { color: var(--el-color-danger, #c45656); }
.author-card :deep(.el-form-item__error) { position: static; width: 100%; padding-top: 5px; line-height: 1.5; }
.error-summary { line-height: 1.6; padding: 12px; border: 1px solid currentColor; border-radius: 4px; }
.snapshot { padding-left: 22px; }
.snapshot li { padding: 8px 0; overflow-wrap: anywhere; }
.prewrap { white-space: pre-wrap; overflow-wrap: anywhere; }
.detail :deep(.el-descriptions__body) { overflow-wrap: anywhere; }
.detail :deep(.el-descriptions__label) { width: 110px; }
.decision-actions { margin-top: 16px; display: flex; flex-wrap: wrap; gap: 8px; }
.decision-actions .el-button { margin-left: 0; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
@media (max-width: 1200px) { .approval-node { grid-template-columns: 1fr; } .group-rule, .approval-node .node-actions { grid-column: auto; } .detail { margin-top: 20px; } }
@media (max-width: 600px) {
  .arcflow-approval { padding: 12px; }
  .page-header { flex-direction: column; align-items: stretch; margin-bottom: 16px; }
  .page-header h2 { font-size: 20px; }
  .header-actions { justify-content: space-between; }
  .author-card :deep(.el-card__body), .detail :deep(.el-card__body) { padding: 14px; }
  .author-card :deep(.el-form-item) { display: block; margin-bottom: 24px; }
  .author-card :deep(.el-form-item__label) { display: block; text-align: left; width: auto !important; height: auto; padding-bottom: 6px; line-height: 1.4; }
  .author-card :deep(.el-form-item__content) { margin-left: 0 !important; }
  .detail :deep(.el-descriptions__label) { width: 90px; }
}
</style>
