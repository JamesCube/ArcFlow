<script setup>
import ComplexSummary from './ComplexSummary.vue'
import RoutingExplanation from './RoutingExplanation.vue'
import { effectiveApprovalNodes } from '../routing.js'
import '../routing.css'
import { rejectedLineCount, lineCount } from '../display-count.js'
import { computed } from 'vue'
import { approvalNodes, participantVotes, stepState } from '../process.js'
import { formatExpenseMoney } from './expense-document.js'
import { getScenarioHandler } from './scenario-registry.js'
const props = defineProps({ view: Object, template: Object, locale: String, people: Array, comment: String, busy: Boolean, canDecide: Boolean, blocked: Boolean, retainedNotes: { type: Array, default: () => [] } })
const emit = defineEmits(['update:comment', 'decide', 'dismiss-note'])
const zh = computed(() => props.locale === 'zh'), request = computed(() => props.view.request)
const handler = computed(() => getScenarioHandler(props.template.id))
const payment = computed(() => handler.value.documentType === 'paymentRequest')
const contract = computed(() => handler.value.documentType === 'contractApproval')
const receiving = computed(() => handler.value.documentType === 'receiving')
const seal = computed(() => handler.value.documentType === 'sealUse')
const prefix = computed(() => handler.value.prefix || handler.value.documentType)
const duration = computed(() => handler.value.duration?.(request.value.business) ?? null)
const name = id => { const person = props.people.find(person => person.id === id); return person?.displayName || person?.name || id }
const money = value => formatExpenseMoney(value, request.value.business.currency)
const date = value => new Date(value).toLocaleString(zh.value ? 'zh-CN' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' })
const status = value => ({ PENDING: zh.value ? '审批中' : 'Pending', APPROVED: zh.value ? '已通过' : 'Approved', REJECTED: zh.value ? '已驳回' : 'Rejected' })[value]
const stageStatus = value => ({ completed: zh.value ? '已完成' : 'Completed', approved: zh.value ? '已同意' : 'Approved', rejected: zh.value ? '已拒绝' : 'Rejected', current: zh.value ? '待审批' : 'Awaiting review', upcoming: zh.value ? '尚未开始' : 'Upcoming', skipped: zh.value ? '未执行' : 'Not reached', 'conditional-skipped': zh.value ? '条件未满足，未纳入' : 'Condition not met · not included' })[value]
const effectiveSteps = computed(() => effectiveApprovalNodes(request.value))
const completeCount = computed(() => effectiveSteps.value.filter(node => ['approved', 'rejected'].includes(stepState(request.value, node))).length)
const voteStatus = value => value === 'pending' ? (zh.value ? '待表决' : 'Awaiting vote') : value === 'not-needed' ? (zh.value ? '无需表决' : 'Not required') : stageStatus(value)
const optionLabel = (field, value) => field.kind === 'money' ? money(value) : field.options.find(option => option.value === value)?.label[props.locale] || value
</script>
<template>
  <article class="sf-request-detail">
    <header class="sf-detail-header"><div><span class="sf-status" :class="request.status.toLowerCase()">{{ status(request.status) }}</span><p class="sf-kicker">{{ request.business.businessId }}</p><h2>{{ request.title }}</h2><p>{{ name(request.applicantId) }} · {{ date(request.createdAt) }}</p></div><strong v-if="seal">{{ handler.summary(request.business, view.total, locale) }}</strong><strong v-else-if="receiving" class="rf-document-mark">{{ zh ? '收货单' : 'GOODS RECEIPT' }}<small>{{ lineCount(request.business.lines.length, locale) }}</small></strong><strong v-else>{{ money(view.total) }}</strong></header>
    <p v-if="payment || contract" class="xf-detail-outcome">{{ payment ? (request.status === 'APPROVED' ? (zh ? '付款申请审批通过。尚未执行付款。' : 'Payment request approved. No payment has been made.') : (zh ? '仅审核合成申请，不执行付款或锁定发票余额。' : 'Synthetic request review only. No payment or invoice balance reservation.')) : (request.status === 'APPROVED' ? (zh ? '合同内部审批通过。尚未签署或发送给客户。' : 'Contract approved internally. It has not been signed or sent to the customer.') : (zh ? '仅内部合同审批，不构成签署或法律意见。' : 'Internal contract review only, not a signature or legal advice.')) }}</p><ComplexSummary v-if="payment || contract" :business="request.business" :handler="handler" :locale="locale" :summary="payment ? view.paymentSummary : undefined" /><p v-if="seal" class="sf-local-note">{{ zh ? '审核结果不代表文件已盖章或签署。文件编号为不联网的合成引用。' : 'A review result does not mean the document was stamped or signed. Document references are inert synthetic text.' }}</p>
    <p v-if="contract && request.business.termsKind === 'NONSTANDARD'" class="xf-detail-outcome">{{ request.routing ? (zh ? '非标准条款已提交人工复核。下方展示已保存的条件判定；合成文件引用未经验签。' : 'Nonstandard terms were submitted for manual review. Saved routing evaluations appear below; the synthetic document reference is not a verified signed file.') : (zh ? '非标准条款已提交人工复核。此旧版固定流程不因条款标记改变；合成文件引用未经验签。' : 'Nonstandard terms were submitted for manual review. This saved fixed route does not change with the flag; the synthetic document reference is not a verified signed file.') }}</p><section class="sf-detail-section"><h3>{{ zh ? '业务快照' : 'Business snapshot' }} <small>v{{ request.business.documentVersion }}</small></h3>
      <dl class="sf-detail-fields"><template v-for="field in template.sections.flatMap(section => section.fields).filter(field => !['title', 'businessId'].includes(field.path))" :key="field.path"><dt>{{ field.label[locale] }}</dt><dd>{{ optionLabel(field, request.business[field.path]) }}</dd></template></dl>
      <dl v-if="handler.documentType === 'travel'" class="sf-detail-fields"><dt>{{ zh ? '行程天数（含首尾）' : 'Trip duration (inclusive)' }}</dt><dd data-testid="saved-travel-duration">{{ duration }} {{ zh ? '天' : duration === 1 ? 'day' : 'days' }}</dd></dl>
      <div v-if="receiving" class="rf-summary" data-testid="receiving-saved-summary"><div v-for="row in view.summary.quantities" :key="row.unit"><b>{{ row.unit }}</b><span>{{ zh ? '实收' : 'Received' }} <strong>{{ row.received }}</strong></span><span>{{ zh ? '合格' : 'Accepted' }} <strong>{{ row.accepted }}</strong></span><span>{{ zh ? '不合格' : 'Rejected' }} <strong>{{ row.rejected }}</strong></span></div><p>{{ rejectedLineCount(view.summary.exceptionLineCount, locale) }} · {{ zh ? '各单位分别合计' : 'units totalled separately' }}</p></div><div v-if="template.lineItems" class="sf-saved-lines"><section v-for="(line, index) in request.business.lines" :key="line.lineId"><header><span>{{ String(index + 1).padStart(2, '0') }}</span><strong>{{ line.description }}</strong><b>{{ receiving ? `${line.received} ${line.unit}` : payment ? `${zh ? '分配' : 'Allocation'} ${money(line.allocationAmount)}` : money(line.amount) }}</b></header><dl><template v-for="field in template.lineItems.fields.filter(field => !['description', 'amount'].includes(field.path))" :key="field.path"><dt>{{ field.label[locale] }}</dt><dd>{{ optionLabel(field, line[field.path]) }}</dd></template></dl></section></div>
    </section>
    <section class="sf-detail-section"><h3>{{ zh ? '审批流程快照' : 'Approval snapshot' }} <small>v{{ request.processVersion }}</small></h3><p v-if="request.routing" class="routing-progress" data-testid="routing-progress">{{ zh ? `实际路径：${completeCount} / ${effectiveSteps.length} 个节点已有结果。条件在提交时冻结，后续发布不改变本申请。` : `Selected route, stages decided: ${completeCount} / ${effectiveSteps.length}. Conditions were frozen on submission; later publications do not change this request.` }}</p><ol class="sf-snapshot-flow"><li v-for="node in approvalNodes(request.definition)" :key="node.id" :class="stepState(request, node)"><header><strong>{{ node.name }}</strong><span>{{ stageStatus(stepState(request, node)) }}</span></header><p v-if="node.completionMode" class="sf-group-rule">{{ node.completionMode === 'ALL' ? (zh ? 'ALL：所有人同意通过，任一拒绝即驳回。' : 'ALL: everyone must approve; any rejection ends the request.') : (zh ? 'ANY：任一同意通过，所有人拒绝才驳回。' : 'ANY: one approval advances; all must reject to end the request.') }}</p><RoutingExplanation :node="node" :routing="request.routing" :locale="locale" /><div v-for="vote in participantVotes(request, node)" :key="vote.actorId" class="sf-vote"><span>{{ name(vote.actorId) }}</span><span>{{ voteStatus(vote.state) }}</span><p v-if="vote.comment">{{ vote.comment }}</p></div></li></ol></section>
    <section v-for="note in retainedNotes" :key="note.stepId" class="sf-retained-note">
      <h3>{{ zh ? '保留的未确认说明' : 'Retained unconfirmed note' }}</h3>
      <label :for="`retained-note-${note.stepId}`">{{ request.definition.nodes.find(node => node.id === note.stepId)?.name || note.stepId }}</label>
      <p>{{ zh ? '此说明属于原审批节点，可复制留存；它未被确认为你的已保存说明。' : 'This note belongs to its original stage. You can copy it; it was not confirmed as your saved comment.' }}</p>
      <textarea :id="`retained-note-${note.stepId}`" :value="note.comment" readonly rows="3" spellcheck="false"></textarea>
      <button type="button" class="secondary" @click="emit('dismiss-note', note.stepId)">{{ zh ? '清除此本地说明' : 'Dismiss this local note' }}</button>
    </section>
    <section v-if="canDecide" class="sf-decision-panel"><h3>{{ zh ? '你的审批意见' : 'Your decision' }}</h3><label for="scenario-comment">{{ zh ? '说明（可选）' : 'Comment (optional)' }}</label><textarea id="scenario-comment" :value="comment" rows="2" maxlength="2000" :disabled="busy" @input="emit('update:comment', $event.target.value)"></textarea><div><button class="danger" :data-testid="`reject-${prefix}`" :disabled="busy" @click="emit('decide', 'REJECT')">{{ zh ? '驳回' : 'Reject' }}</button><button class="primary" :data-testid="`approve-${prefix}`" :disabled="busy" @click="emit('decide', 'APPROVE')">{{ zh ? '同意此节点' : 'Approve this stage' }}</button></div></section>
    <p v-else-if="blocked" class="warning">{{ zh ? '审批结果尚未确认，请先更新数据。' : 'Decision state is unconfirmed. Refresh before deciding again.' }}</p>
    <section class="sf-detail-section"><h3>{{ zh ? '活动记录' : 'Activity' }}</h3><ol class="timeline"><li v-for="(event, index) in request.history" :key="index"><strong>{{ name(event.actorId) }} · {{ event.action === 'SUBMIT' ? (zh ? '提交申请' : 'Submitted request') : event.action === 'APPROVE' ? (zh ? '同意' : 'Approved') : (zh ? '拒绝' : 'Rejected') }}</strong><p v-if="event.stepId">{{ request.definition.nodes.find(node => node.id === event.stepId)?.name }}</p><p v-if="event.comment" class="decision-comment">{{ event.comment }}</p><small>{{ date(event.at) }}</small></li></ol></section>
  </article>
</template>
