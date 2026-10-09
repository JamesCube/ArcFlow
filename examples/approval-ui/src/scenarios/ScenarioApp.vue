<script setup>
import { computed, onUnmounted, ref, watch } from 'vue'
import ProcessDesigner from '../ProcessDesigner.vue'
import UiIcon from '../UiIcon.vue'
import { approvalNodes, participants, pendingParticipants } from '../process.js'
import { createScenarioApi } from './scenario-api.js'
import { createScenarioWorkspace } from './scenario-workspace.js'
import { formatExpenseMoney } from './expense-document.js'
import ScenarioForm from './ScenarioForm.vue'
import ComplexScenarioForm from './ComplexScenarioForm.vue'
import './complex-scenarios.css'
import ReceivingForm from './ReceivingForm.vue'
import './receiving.css'
import { getScenarioHandler } from './scenario-registry.js'
import ScenarioDetail from './ScenarioDetail.vue'
import RouteSteps from './RouteSteps.vue'
import { routingErrorText } from '../routing-copy.js'
const props = defineProps({ api: { type: Object, default: null } })
const workspace = createScenarioWorkspace(props.api || createScenarioApi()), s = workspace.state
const locale = ref('en'), username = ref('alice'), password = ref('')
const zh = computed(() => locale.value === 'zh')
watch(locale, value => { document.documentElement.lang = value === 'zh' ? 'zh-CN' : 'en' }, { immediate: true })
onUnmounted(() => workspace.dispose())
const handler = computed(() => getScenarioHandler(s.activeId))
const text = (en, cn) => zh.value ? cn : en
// Copy is compiled with the supported document kinds, never executable metadata.
const sceneCopy = type => ({
  paymentRequest: {
    newLabel: text('New payment request', '新建付款申请'), kicker: text('PAYMENT REQUEST', '付款申请'),
    title: text('Every invoice. A clear net request.', '逐票核对，净额清晰。'),
    introduction: text('Reconcile declared invoices, prior settlement, allocation and deductions before review.', '核对声明发票金额、已结金额、本次分配与扣减，再提交人工审批。'),
    submits: text('Submits the payment request', '提交付款申请'),
    snapshot: text('Invoice lines and the selected route are frozen together. Approval records a review result, never a payment.', '发票明细与选中的审批路径在提交时一并冻结。通过仅表示申请获批，不代表已付款。'),
    localNote: text('Synthetic references only. No real invoice or ERP balance validation, cross-request reservation, bank details, transfers or accounting writes.', '仅填写合成引用。不验证真实发票或 ERP 余额，不跨单占用，不录入银行信息，不转账，也不记账。'),
    submitted: text('Payment request saved. Its review process has started.', '付款申请已保存，审核流程已启动。'),
    placeholder: text('The full invoice-to-net picture.', '从发票到净额，一目了然。'),
    tag: text('Invoice reconciliation', '发票金额核对'), limits: text('Exact net amount · up to 20 invoices', '精确净额 · 最多 20 张发票'),
  },
  contractApproval: {
    newLabel: text('New contract review', '新建合同审批'), kicker: text('CONTRACT APPROVAL', '合同审批'),
    title: text('Clear terms. Accountable milestones.', '条款清晰，交付有据。'),
    introduction: text('Review the contract term, clause deviations and a fully allocated milestone schedule.', '核对合同期限、条款差异与完整的里程碑金额安排。'),
    submits: text('Submits the contract for review', '提交合同审批'),
    snapshot: text('The contract revision, milestones and process are frozen together. Later drafts never change a submitted review.', '合同修订、里程碑与流程一并冻结。后续草稿不会改动已提交的审批。'),
    localNote: text('Synthetic internal review only. No CRM source verification, legal advice, signing, customer delivery, receivables or payment.', '仅合成内部审批。不验证 CRM 来源，不提供法律意见，不签署、不发给客户、不建立应收，也不付款。'),
    submitted: text('Contract saved for internal review.', '合同申请已保存，内部审核流程已启动。'),
    placeholder: text('The agreement, in full context.', '约定与审核，完整呈现。'),
    tag: text('Terms & milestones', '条款与里程碑'), limits: text('Conserved amount · up to 20 milestones', '金额精确守恒 · 最多 20 期'),
  },

  expense: {
    newLabel: text('New expense', '新建报销'), kicker: text('EXPENSE REIMBURSEMENT', '费用报销'),
    title: text('A clear account of every expense.', '一份清晰的报销申请。'),
    introduction: text('Add the expenses and their purpose. Reviewers see every line. All fields are required.', '填写费用与用途，审批人可以查看每一项。所有字段均为必填。'),
    submits: text('Submits the expense request', '提交报销申请'),
    snapshot: text('This process and the expense lines are saved together at submission. Approval completes the demo; it does not issue a payment.', '提交时保存此流程与费用明细。通过审批仅结束演示流程，不发起付款。'),
    localNote: text('Use synthetic data only. No receipt uploads, currency conversion or external integrations.', '仅填写合成数据。没有发票上传、汇率换算或外部集成。'),
    submitted: text('Expense request saved. Its approval process has started.', '报销申请已保存，审批流程已启动。'),
    placeholder: text('Every expense has a story.', '每一项费用，都有上下文。'),
    tag: text('Itemized expenses', '多行费用'), limits: text('5 currencies · up to 20 expense lines', '5 个币种 · 最多 20 项费用'),
  },
  travel: {
    newLabel: text('New travel request', '新建出差'), kicker: text('BUSINESS TRAVEL', '出差申请'),
    title: text('A clear plan before the trip.', '让行程与预算，一目了然。'),
    introduction: text('Add the destination, dates, purpose and estimated cost. All fields are required.', '填写目的地、日期、用途与预计费用。所有字段均为必填。'),
    submits: text('Submits the travel request', '提交出差申请'),
    snapshot: text('This process, itinerary and budget are saved together. Approval does not book travel, reimburse expenses or issue a payment.', '提交时保存此流程、行程与预算。审批通过不会预订、报销或付款。'),
    localNote: text('Use synthetic itineraries only. No booking, notifications or external writeback.', '仅填写合成行程。没有预订、通知或外部系统写回。'),
    submitted: text('Travel request saved. Its approval process has started.', '出差申请已保存，审批流程已启动。'),
    placeholder: text('Every trip has a purpose.', '每一段行程，都有目的。'),
    tag: text('Itinerary & budget', '行程与预算'), limits: text('5 currencies · 1–90 day trips', '5 个币种 · 1–90 天行程'),
  },
  sealUse: {
    newLabel: text('New seal-use request', '新建用印申请'), kicker: text('SEAL-USE REQUEST', '用印申请'),
    title: text('Document, purpose and seal. Ready for review.', '文件、用途与用印，清晰可审。'),
    introduction: text('Enter a synthetic document reference, seal category and copy count. All fields are required.', '填写合成文件编号、印章类型与份数。所有字段均为必填。'),
    submits: text('Submits the seal-use request', '提交用印申请'),
    snapshot: text('The document, purpose and process are saved together. Approval does not mean the document was stamped or signed.', '提交时保存文件、用途与此流程。审核通过不代表文件已盖章或签署。'),
    localNote: text('Document references are inert synthetic text; no actual file or authority is verified.', '文件编号为不联网的合成引用，不验证实际文件或使用权。'),
    submitted: text('Seal-use request saved. Its review process has started.', '用印申请已保存，审核流程已启动。'),
    placeholder: text('Every document has a purpose.', '每一份文件，都有用途。'),
    tag: text('Document and purpose', '文件与用途'), limits: text('3 synthetic seal categories · 1–100 copies', '3 种合成印章 · 1–100 份'),
  },
  receiving: {
    newLabel: text('New receipt', '新建收货单'), kicker: text('PURCHASE ORDER RECEIVING', '采购收货验收'),
    title: text('Every unit, accounted for.', '让到货数量，对得上。'),
    introduction: text('Record this delivery, reconcile accepted and rejected goods, then send it for review.', '记录本次到货、合格与不合格数量，再交给审批人复核。'),
    submits: text('Submits the receipt', '提交收货单'),
    snapshot: text('The document and process are saved together. Later process publications do not change this receipt.', '业务与流程在提交时一起保存，之后发布的新流程不会改动本单。'),
    localNote: text('Local synthetic data only. No real purchase order lookup, cumulative quantities across receipts, stock posting, payment or external writeback.', '仅本地合成数据。不查询真实采购单，不核算跨单累计数量，不增加库存，不付款，也不回写外部系统。'),
    submitted: text('Receipt saved. Its approval process has started.', '收货单已保存，审批流程已启动。'),
    placeholder: text('A complete record of every line.', '每一行收货，记录完整。'),
    tag: text('Line inspection', '逐行验收'), limits: text('Totals by unit · up to 20 lines', '按单位合计 · 最多 20 行'),
  },
})[type]
const copy = computed(() => sceneCopy(handler.value.documentType))
const complex = computed(() => ['paymentRequest', 'contractApproval'].includes(handler.value.documentType))
const complexRolesNote = computed(() => text('Bob and Carol are the actual demo reviewers. The same person may appear again and must vote separately at each stage. Routes stay fixed; clause flags and amounts do not dynamically assign people or stages.', 'Bob 与 Carol 是实际演示审批人。同一人可能再次出现，每个节点须单独表决。路线固定，条款标记与金额不会动态分配人员或节点。'))
const receiving = computed(() => handler.value.documentType === 'receiving')
const receivingRolesNote = computed(() => text('In the default sample route, Bob serves both warehouse inspection and procurement review; Carol participates in quality inspection. The displayed process defines actual assignments. No dynamic role assignment or separation-of-duties guarantee.', '默认演示流程中，Bob 兼任仓库验收与采购复核，Carol 参与质量验收。实际分配以所示流程为准；没有动态角色分配或职责分离保证。'))
const newLabel = computed(() => copy.value.newLabel)
const scenarioKicker = computed(() => copy.value.kicker)
// Bind callbacks to this scope before passing them to the cached designer.
const designer = computed(() => {
  const id = s.activeId, state = s.scopes[id], scope = workspace.scopeFor(id)
  return { id, state, scope, update: value => { state.draft = value }, publish: () => scope.publish(), reset: () => scope.resetDraft() }
})
const template = computed(() => s.catalog.find(entry => entry.id === handler.value.id))
const name = id => { const person = s.people.find(person => person.id === id); return person?.displayName || person?.name || id }
const summary = view => receiving.value
  ? view.summary.quantities.map(row => `${row.received} ${row.unit}`).join(' · ')
  : handler.value.documentType === 'sealUse' ? handler.value.summary(view.request.business, view.total, locale.value)
  : formatExpenseMoney(view.total, view.request.business.currency)
const mine = computed(() => s.items.filter(view => view.request.applicantId === s.me?.id))
const review = computed(() => s.items.filter(view => pendingParticipants(view.request).includes(s.me?.id)))
const handled = computed(() => s.items.filter(view => view.request.history.some(event => event.actorId === s.me?.id && ['APPROVE', 'REJECT'].includes(event.action))))
const retained = computed(() => s.items.filter(view => workspace.retainedNotesFor(view.request.id).length))
const retainedCount = computed(() => Object.keys(s.retainedNotes).length)
const visible = computed(() => s.tab === 'retained' ? retained.value : s.tab === 'review' ? review.value : s.tab === 'handled' ? handled.value : mine.value)
// Keep each scene's in-progress review when navigating, but render its detail
// only when the saved selection belongs to the currently displayed worklist.
const selected = computed(() => visible.value.find(view => view.request.id === s.selectedId))
const status = value => ({ PENDING: zh.value ? '审批中' : 'Pending', APPROVED: zh.value ? '已通过' : 'Approved', REJECTED: zh.value ? '已驳回' : 'Rejected' })[value]
const tabs = computed(() => [
  { id: 'new', label: newLabel.value, icon: 'requests' },
  { id: 'mine', label: zh.value ? '我的申请' : 'My requests', icon: 'requests', count: mine.value.length },
  { id: 'review', label: zh.value ? '待我审批' : 'Needs my review', icon: 'review', count: review.value.length },
  { id: 'handled', label: zh.value ? '我的审批记录' : 'My decisions', icon: 'review', count: handled.value.length },
  ...(retained.value.length ? [{ id: 'retained', label: zh.value ? '保留的说明' : 'Retained notes', icon: 'requests', count: retained.value.length }] : []),
  { id: 'designer', label: zh.value ? '审批流程' : 'Approval process', icon: 'process' },
])
const currentTitle = computed(() => tabs.value.find(tab => tab.id === s.tab)?.label || (zh.value ? '场景库' : 'Scenario library'))
function openScenario(id) { return workspace.activate(id) }
function requestSummary(business) {
  if (business.type === 'travel') return `${business.destination} · ${getScenarioHandler('oa-travel').duration(business)} ${zh.value ? '天' : 'days'}`
  if (business.type === 'sealUse') return business.documentName
  if (business.type === 'paymentRequest') return `${business.supplierRef} · ${business.lines.length} ${zh.value ? '张发票' : 'invoices'}`
  if (business.type === 'contractApproval') return `${business.customerRef} · ${zh.value ? '合同修订' : 'revision'} ${business.contractRevision} · ${business.lines.length} ${zh.value ? '期里程碑' : 'milestones'}`
  if (business.type === 'receiving') return `${business.purchaseOrderRef} · ${business.lines.length} ${zh.value ? '行明细' : 'lines'}`
  return `${business.lines.length} ${zh.value ? '项费用' : 'expense lines'}`
}
function navigate(tab) { s.tab = tab }
function selectRequest(id) { if (id !== s.selectedId) workspace.select(id) }
function openRetained() { navigate('retained'); if (!selected.value && retained.value.length) selectRequest(retained.value[0].request.id) }
function dismissNote(id, stepId) {
  workspace.dismissRetainedNote(id, stepId)
  if (s.tab === 'retained' && !workspace.retainedNotesFor(id).length) {
    if (retained.value.length) selectRequest(retained.value[0].request.id)
    else navigate('review')
  }
}
async function login() { if (s.busy) return; const secret = password.value; password.value = ''; await workspace.login(username.value, secret) }
const errorText = computed(() => {
  if (!s.error) return ''
  if (s.error.operation === 'routing') return routingErrorText(s.error.cause, locale.value)
  if (s.error.operation === 'decision' && s.error.cause?.code === 'DECISION_COMMENT_MISMATCH') {
    return zh.value ? '保存的审批说明与本次提交不一致，你填写的说明已保留。请更新数据，核对已保存的审批记录后再继续。' : 'The saved comment did not match this decision. Your typed note is retained. Refresh to inspect the saved audit before continuing.'
  }
  if (s.error.operation === 'decision' && s.error.cause?.code === 'DECISION_RECOVERY_MISMATCH') {
    return zh.value ? '已保存的记录未确认你本次提交的审批与说明。原说明已按原节点保留，请更新数据后再继续。' : 'Saved activity did not confirm your submitted decision and note. Your note is retained with its original step. Refresh before continuing.'
  }
  const en = { login: 'Sign-in could not be completed. Check the account, server-configured password and backend, then try again.', validation: 'Check the highlighted fields before submitting.', selfAssigned: 'The applicant cannot also review this request. Alice can adjust the published approval process.', refresh: 'Refresh failed. Existing data and your draft are preserved. Try Refresh again.', publish: 'Publication was not confirmed. Your draft is preserved. Refresh, reset to the latest process, then reapply your edits before publishing.', submit: s.rejectedVersion ? 'The published process changed. Refresh to load the new version before submitting.' : 'Submission was not confirmed. Check My requests, or retry the unchanged form with its original key and process version. Editing the form creates a new request intent.', decision: 'The decision was not confirmed. We checked for saved results. If actions remain locked, use Refresh before deciding again.' }
  const cn = { login: '登录未完成。请检查账号、服务端设置的密码及后端服务，然后重试。', validation: '请检查高亮字段后再提交。', selfAssigned: '申请人不能审批自己的申请。Alice 可调整已发布的流程。', refresh: '数据更新失败。现有数据与草稿已保留，请再次点击更新数据。', publish: '发布结果未确认，草稿已保留。请更新数据，重置为最新流程，再重新应用修改后发布。', submit: s.rejectedVersion ? '已发布流程发生变化。请更新数据后再提交。' : '提交结果未确认。请检查我的申请，或保持表单不变，以原提交标识与流程版本重试。修改表单会创建新的申请意图。', decision: '审批结果未确认，已尝试读取已保存结果。如操作仍被锁定，请先更新数据再审批。' }
  return (zh.value ? cn : en)[s.error.operation] || (zh.value ? '操作失败，请重试。' : 'The operation failed. Try again.')
})
const noticeText = computed(() => ({ refreshed: zh.value ? '数据已更新，本地修改已保留。' : 'Data refreshed. Local edits are preserved.', submitted: copy.value.submitted, published: zh.value ? `流程 v${s.process?.version} 已发布，既有申请保留原快照。` : `Process v${s.process?.version} published. Existing requests keep their snapshots.`, decided: selected.value ? (zh.value ? '审批意见已保存，以下为最新结果。' : 'Your decision is saved. The latest result is shown below.') : (zh.value ? '审批意见已保存，可在我的审批记录中查看结果。' : 'Your decision is saved. Find the result in My decisions.') })[s.notice])
</script>
<template>
  <div v-if="!s.me" class="sf-login" :lang="zh ? 'zh-CN' : 'en'">
    <section class="sf-login-story"><div class="wordmark"><span class="logo">a</span>ArcFlow<span class="sf-product-tag">SCENARIOS</span></div><div><p class="sf-kicker">{{ zh ? '从业务出发，让审批自然发生' : 'BUSINESS FIRST. FLOW FOLLOWS.' }}</p><h1>{{ zh ? '每个场景，' : 'Every detail.' }}<br>{{ zh ? '都有清晰的流程。' : 'A clearer flow.' }}</h1><p>{{ zh ? '从费用、出差、用印到收货、付款申请与合同审批，用独立业务表单看清每一步。' : 'Expense, travel, seal use, receiving, payment requests and contracts. Distinct documents, with every decision in context.' }}</p><div class="sf-login-path"><span>01<br><b>{{ zh ? '填写申请' : 'Prepare' }}</b></span><i>→</i><span>02<br><b>{{ zh ? '逐级审批' : 'Review' }}</b></span><i>→</i><span>03<br><b>{{ zh ? '追溯记录' : 'Trace' }}</b></span></div></div><small>{{ zh ? '仅本地合成数据演示 · 审批不执行付款、签署、盖章、预订或入库' : 'Local synthetic-data demo · review does not pay, sign, stamp, book or post stock' }}</small></section>
    <section class="sf-login-panel"><label class="sf-language"><span class="sr-only">Language / 语言</span><select v-model="locale" aria-label="Language / 语言"><option value="en">English</option><option value="zh">中文</option></select></label><form class="sf-login-form" @submit.prevent="login"><p class="sf-kicker">{{ zh ? 'ARCFLOW 场景库' : 'ARCFLOW SCENARIO LIBRARY' }}</p><h2>{{ zh ? '进入工作空间' : 'Enter your workspace' }}</h2><p class="muted">{{ zh ? '使用服务端配置的演示账号与密码。' : 'Use a demo account and its server-configured password.' }}</p><label>{{ zh ? '演示账号' : 'Demo account' }}<select v-model="username" :disabled="s.busy"><option value="alice">Alice · {{ zh ? '申请人 / 流程管理员' : 'Applicant / process editor' }}</option><option value="bob">Bob · {{ zh ? '业务审核' : 'Business reviewer' }}</option><option value="carol">Carol · {{ zh ? '费用 / 预算复核' : 'Finance / budget reviewer' }}</option></select></label><label>{{ zh ? '密码' : 'Password' }}<input v-model="password" type="password" autocomplete="off" :disabled="s.busy" required></label><p v-if="s.error" class="error" role="alert">{{ errorText }}</p><button class="primary full" type="submit" :disabled="s.busy">{{ s.busy ? (zh ? '正在登录…' : 'Signing in…') : (zh ? '进入场景库' : 'Open scenario library') }} →</button><p class="sf-login-note">{{ zh ? '账号凭据仅保存在本标签页内存中。退出或刷新网页会清除未保存草稿。' : 'Credentials stay in this tab’s memory. Sign-out or browser reload clears unsaved drafts.' }}</p></form></section>
  </div>
  <div v-else class="sf-shell" :data-scenario="s.activeId" :lang="zh ? 'zh-CN' : 'en'">
    <aside class="sf-sidebar"><div class="wordmark"><span class="logo">a</span>ArcFlow</div><div class="sf-sidebar-title">{{ zh ? '工作空间' : 'WORKSPACE' }}</div><nav :aria-label="zh ? '主导航' : 'Main navigation'"><button :class="{ active: s.tab === 'catalog' }" data-testid="catalog-tab" @click="navigate('catalog')"><span class="sf-grid-icon" aria-hidden="true">▦</span>{{ zh ? '场景库' : 'Scenario library' }}<small>{{ String(s.catalog.length).padStart(2, '0') }}</small></button><p>{{ template.domain }} · {{ template.title[locale] }}</p><button v-for="tab in tabs" :key="tab.id" :data-testid="`${tab.id}-tab`" :class="{ active: s.tab === tab.id }" @click="navigate(tab.id)"><UiIcon :name="tab.icon" />{{ tab.label }}<small v-if="tab.count !== undefined">{{ tab.count }}</small></button></nav><div class="sf-sidebar-bottom"><span class="sf-synthetic-dot"></span><span>{{ zh ? '合成数据工作空间' : 'Synthetic workspace' }}</span><p>{{ zh ? '数据计数仅代表已加载记录。' : 'Counts reflect loaded records.' }}</p></div><div class="sf-person"><span>{{ name(s.me.id).charAt(0) }}</span><div><strong>{{ name(s.me.id) }}</strong><small>{{ s.me.id === 'alice' ? (zh ? '申请人 · 流程管理员' : 'Applicant · editor') : (zh ? '审批人' : 'Reviewer') }}</small></div><button type="button" :aria-label="zh ? '退出登录' : 'Sign out'" data-testid="scenario-logout" @click="workspace.logout"><UiIcon name="logout" /></button></div></aside>
    <main class="sf-main"><header class="sf-topbar"><div><span>ArcFlow</span><i>/</i><strong>{{ currentTitle }}</strong></div><div class="sf-topbar-actions"><label class="sf-language"><span class="sr-only">Language / 语言</span><select v-model="locale" aria-label="Language / 语言"><option value="en">English</option><option value="zh">中文</option></select></label><button class="secondary" data-testid="scenario-refresh" :disabled="s.busy" @click="workspace.refresh">↻ <span>{{ zh ? '更新数据' : 'Refresh' }}</span></button><button class="secondary sf-mobile-logout" type="button" :aria-label="zh ? '退出登录' : 'Sign out'" @click="workspace.logout"><UiIcon name="logout" /></button></div></header>
      <div class="sf-content"><div v-if="s.error" class="error sf-alert" role="alert"><strong>{{ errorText }}</strong><details v-if="s.error.cause?.message"><summary>{{ zh ? '原始服务信息' : 'Original service detail' }}</summary>{{ s.error.cause.message }}</details></div><p v-if="s.notice" class="notice" role="status">{{ noticeText }}</p><button v-if="retainedCount" type="button" class="sf-retained-index" data-testid="retained-notes-summary" @click="openRetained"><span>{{ retainedCount }} {{ zh ? '条未确认说明已保留在当前会话' : 'unconfirmed notes retained in this session' }}</span><strong>{{ zh ? '查看说明' : 'Review notes' }} →</strong></button>
        <section v-if="s.tab === 'catalog'" class="sf-catalog"><div class="sf-page-title"><p class="sf-kicker">{{ zh ? '可复用的业务场景' : 'REUSABLE BUSINESS SCENARIOS' }}</p><h1>{{ zh ? '从业务场景，开始审批。' : 'Start with the work.' }}</h1><p>{{ zh ? '业务表单、审批流程与完整记录，在一个场景中协同。' : 'Business forms, approval processes and a complete record. Together in one scenario.' }}</p></div><div class="sf-catalog-filter"><span>{{ zh ? '全部场景' : 'All scenarios' }} <b>{{ s.catalog.length }}</b></span><small>{{ zh ? 'OA · 办公 / ERP · 采购财务 / CRM · 合同' : 'OA · Office / ERP · Operations / CRM · Contracts' }}</small><small class="sf-local-badge">{{ zh ? '仅本地演示' : 'LOCAL DEMO' }}</small></div><article v-for="(entry, index) in s.catalog" :key="entry.id" class="sf-template-card"><div class="sf-template-art" :class="{ 'sf-travel-art': entry.documentType === 'travel', 'sf-seal-art': entry.documentType === 'sealUse', 'rf-catalog-art': entry.documentType === 'receiving', 'pf-catalog-art': entry.documentType === 'paymentRequest', 'cf-catalog-art': entry.documentType === 'contractApproval' }" aria-hidden="true"><div v-if="entry.documentType === 'travel'" class="sf-itinerary"><span>BUSINESS TRAVEL</span><strong>{{ zh ? '出差计划' : 'A clear itinerary' }}</strong><div><b>01</b><span>{{ zh ? '目的地' : 'Destination' }}<i>{{ zh ? '项目交付' : 'Project delivery' }}</i></span></div><div><b>02</b><span>{{ zh ? '行程与预算' : 'Dates & budget' }}<i>{{ zh ? '审批前清晰呈现' : 'Ready for review' }}</i></span></div></div><div v-else-if="entry.documentType === 'sealUse'" class="sf-document-art"><span>SYNTHETIC DOCUMENT</span><strong>{{ zh ? '文件用印审核' : 'Document review' }}</strong><i></i><i></i><i></i><div>{{ zh ? '2 份 · 合成示例公章' : '2 copies · synthetic seal' }}</div></div><div v-else-if="entry.documentType === 'receiving'" class="sf-receipt"><span>GOODS RECEIPT</span><strong>{{ zh ? '逐行核对' : 'Reconcile each line' }}</strong><i></i><i></i><i></i><div><span>ACCEPTED + REJECTED</span><b>78 + 2 = 80</b></div></div><div v-else-if="entry.documentType === 'paymentRequest'" class="xf-catalog-ledger"><span>PAYMENT REQUEST</span><strong>{{ zh ? '本次申请核对' : 'Invoice reconciliation' }}</strong><div><span>{{ zh ? '本次分配' : 'Allocation' }}</span><b>7,000.00</b></div><div><span>{{ zh ? '扣减' : 'Deduction' }}</span><b>−500.00</b></div><div><span>{{ zh ? '净申请' : 'Net request' }}</span><b>6,500.00</b></div></div><div v-else-if="entry.documentType === 'contractApproval'" class="xf-catalog-ledger"><span>CONTRACT DOSSIER</span><strong>{{ zh ? '约定与交付' : 'Terms & delivery' }}</strong><div><span>01 · {{ zh ? '方案' : 'Proposal' }}</span><b>30%</b></div><div><span>02 · {{ zh ? '中期' : 'Interim' }}</span><b>40%</b></div><div><span>03 · {{ zh ? '验收' : 'Acceptance' }}</span><b>30%</b></div></div><div v-else class="sf-receipt"><span>EXPENSE REPORT</span><strong>3 {{ zh ? '笔费用' : 'line items' }}</strong><i></i><i></i><i></i><div><span>TOTAL</span><b>1,280.50</b></div></div><div class="sf-art-stamp">✓</div><div class="sf-art-label">{{ entry.documentType === 'travel' ? (zh ? '行程 → 预算 → 审批' : 'Plan → Budget → Review') : (zh ? '明细 → 审核 → 记录' : 'Itemize → Review → Trace') }}</div></div><div class="sf-template-info"><div class="sf-card-meta"><span>{{ entry.domain }}</span><small>{{ zh ? '模板' : 'TEMPLATE' }} {{ String(index + 1).padStart(2, '0') }} · v{{ entry.formVersion }}</small></div><h2>{{ entry.title[locale] }}</h2><p>{{ entry.description[locale] }}</p><div class="sf-tags"><span>{{ sceneCopy(entry.documentType).tag }}</span><span>{{ zh ? '顺序审批' : 'Sequential review' }}</span><span>{{ zh ? '不可变快照' : 'Saved snapshots' }}</span></div><footer><span>{{ sceneCopy(entry.documentType).limits }}</span><button class="primary" :data-testid="`open-${getScenarioHandler(entry.id).prefix}`" @click="openScenario(entry.id)">{{ zh ? '使用此场景' : 'Use scenario' }} →</button></footer></div></article><div class="sf-pattern-row"><div><span>01</span><h3>{{ zh ? '业务先行' : 'Built around the document' }}</h3><p>{{ zh ? '六类场景各有独立表单、草稿与业务规则。' : 'Six document types, each with its own form, draft and business rules.' }}</p></div><div><span>02</span><h3>{{ zh ? '流程可复用' : 'One reusable approval flow' }}</h3><p>{{ zh ? '固定阶段支持单人、ALL 与 ANY 审批，表单与流程各自演进。' : 'Ordered stages support single, ALL and ANY review. The form and process can evolve separately.' }}</p></div><div><span>03</span><h3>{{ zh ? '每一步可追溯' : 'Every decision in context' }}</h3><p>{{ zh ? '提交时保存业务与流程快照，后续流程修改不影响已提交申请。' : 'Business data and process are snapshotted at submission, so later edits do not change existing requests.' }}</p></div></div></section>
        <template v-if="s.tab === 'new'"><div class="sf-page-title sf-title-row"><div><p class="sf-kicker">{{ template.domain }} / {{ scenarioKicker }}</p><h1>{{ copy.title }}</h1><p>{{ copy.introduction }}</p></div><span class="sf-version-tag">{{ zh ? '表单' : 'FORM' }} v{{ template.formVersion }}</span></div><p v-if="s.uncertainSubmission" class="warning">{{ zh ? '上次提交结果不确定。原提交标识仍保留；修改表单前，请先检查我的申请。' : 'The last submission is uncertain. Its retry key is retained. Check My requests before editing the form.' }}</p><div class="sf-create-layout"><component :is="receiving ? ReceivingForm : complex ? ComplexScenarioForm : ScenarioForm" :key="s.activeId" :template="template" v-bind="receiving ? {} : { handler }" :model-value="s.form" :locale="locale" :errors="handler.errors(s.form)" :attempted="s.attempted" :busy="s.busy || !s.process" :retrying="s.uncertainSubmission" :rejected-version="s.rejectedVersion" @update:model-value="workspace.setForm" @submit="workspace.submit" /><aside class="sf-context-card"><p class="sf-kicker">{{ zh ? '本次审批路径' : 'THIS REQUEST’S ROUTE' }}</p><h2>{{ zh ? '提交后，接下来是…' : 'What happens next' }}</h2><ol class="sf-mini-flow"><li class="sf-mini-start"><span>↗</span><div><strong>{{ name(s.me.id) }}</strong><small>{{ copy.submits }}</small></div></li><RouteSteps :definition="workspace.submissionDefinition()" :business="s.form" :people="s.people" :locale="locale" /><li class="sf-mini-end"><span>✓</span><div><strong>{{ zh ? '审批完成' : 'Review complete' }}</strong><small>{{ zh ? '保留完整审批记录' : 'A complete decision trail' }}</small></div></li></ol><div class="sf-context-note"><strong>{{ zh ? '流程快照' : 'Process snapshot' }} v{{ workspace.submissionDefinition()?.version }}</strong><p>{{ copy.snapshot }}</p></div><p v-if="complex" class="rf-roles-note">{{ complexRolesNote }}</p><p v-if="receiving" class="rf-roles-note">{{ receivingRolesNote }}</p><p class="sf-local-note">{{ copy.localNote }}</p></aside></div></template>
        <section v-if="['mine', 'review', 'handled', 'retained'].includes(s.tab)"><div class="sf-page-title sf-title-row"><div><p class="sf-kicker">{{ template.domain }} / {{ scenarioKicker }}</p><h1>{{ currentTitle }}</h1><p>{{ s.tab === 'retained' ? (zh ? '这些说明保留在原申请与原节点中。可复制或清除本地说明，退出登录时会清除。' : 'These notes remain attached to their original request and stage. Copy or dismiss them here; sign-out clears them.') : s.tab === 'review' ? (zh ? '只显示当前节点仍需要你审批的申请。' : 'Requests that still need your decision on their current stage.') : s.tab === 'handled' ? (zh ? '你已保存过审批意见的申请，可能仍在流转。' : 'Requests with your saved decisions. Some may still be in progress.') : (zh ? '你提交的申请，以及每一步的最新状态。' : 'Your requests and the latest state of every step.') }}</p></div><button v-if="s.tab === 'mine'" class="primary" @click="navigate('new')">＋ {{ newLabel }}</button></div><div class="sf-record-layout"><section class="sf-request-list" :aria-label="currentTitle"><header><strong>{{ visible.length }} {{ zh ? '条已加载记录' : 'loaded records' }}</strong></header><div v-if="!visible.length" class="sf-empty"><UiIcon :name="s.tab === 'review' ? 'review' : 'requests'" /><h2>{{ zh ? '目前没有申请' : 'Nothing here yet' }}</h2><p>{{ s.tab === 'review' ? (zh ? '需要你审批的申请会显示在这里。' : 'Requests needing your review will appear here.') : (zh ? '申请与审批记录会显示在这里。' : 'Your requests and decisions will appear here.') }}</p></div><button v-for="view in visible" :key="view.request.id" type="button" class="sf-request-item" :class="{ selected: s.selectedId === view.request.id }" :aria-pressed="s.selectedId === view.request.id" @click="selectRequest(view.request.id)"><div><span class="sf-status" :class="view.request.status.toLowerCase()">{{ status(view.request.status) }}</span><small>{{ view.request.business.businessId }}</small></div><strong>{{ view.request.title }}</strong><p>{{ name(view.request.applicantId) }} · {{ requestSummary(view.request.business) }}</p><footer><b>{{ summary(view) }}</b><span>→</span></footer><small v-if="receiving && view.summary.exceptionLineCount" class="rf-exception-label">{{ view.summary.exceptionLineCount }} {{ zh ? '行有不合格品' : 'lines with rejected goods' }}</small></button></section><ScenarioDetail :key="`${s.activeId}-${s.selectedId}`" v-if="selected" :view="selected" :template="template" :locale="locale" :people="s.people" v-model:comment="s.comment" :busy="s.busy" :can-decide="workspace.canDecide(selected)" :blocked="s.blockedDecisions.includes(selected.request.id)" :retained-notes="workspace.retainedNotesFor(selected.request.id)" @dismiss-note="dismissNote(selected.request.id, $event)" @decide="workspace.decide" /><div v-else class="sf-detail-placeholder"><div class="sf-placeholder-symbol">↗</div><h2>{{ copy.placeholder }}</h2><p>{{ zh ? '选择申请，查看业务快照、保存的流程与完整审批记录。' : 'Select a request to see its business snapshot, saved process and complete decision trail.' }}</p></div></div></section>
        <section v-show="s.tab === 'designer'" class="sf-designer-section"><div class="sf-page-title"><p class="sf-kicker">{{ template.domain }} / {{ zh ? '流程设计' : 'PROCESS DESIGN' }}</p><h1>{{ zh ? '清晰的责任，逐步推进。' : 'Clear ownership. One step at a time.' }}</h1><p>{{ zh ? '有序阶段支持单人、ALL 或 ANY 审批。已提交申请保留其原流程快照。' : 'Ordered stages support single, ALL or ANY review. Submitted requests keep their original process snapshot.' }}</p></div><KeepAlive><ProcessDesigner :key="designer.id" v-if="designer.state.draft" :model-value="designer.state.draft" @update:model-value="designer.update" :published="designer.state.process" :expected-process-id="designer.id" :id-prefix="designer.id" :people="s.people" :editable="s.me.id === 'alice'" :busy="s.busy" :publishing="s.publishing" :dirty="designer.scope.dirty()" :stale="designer.scope.stale()" :initial-locale="locale" :show-language="false" @publish="designer.publish" @reset="designer.reset" /></KeepAlive></section>
        <footer class="sf-workspace-footer"><span>ArcFlow · {{ zh ? '场景库' : 'Scenario library' }}</span><span>{{ zh ? '仅合成数据 · 审批不执行付款、签署、盖章、预订或入库' : 'Synthetic data only · review does not pay, sign, stamp, book or post stock' }}</span></footer>
      </div>
    </main>
  </div>
</template>
