<script setup>
import { computed, nextTick, ref } from 'vue'
import ScenarioField from './ScenarioField.vue'
import ComplexSummary from './ComplexSummary.vue'
import { paymentAmountCents } from './payment-document.js'
import { newSubmissionKey } from '../submission-intent.js'
const props = defineProps({ template: Object, handler: Object, modelValue: Object, locale: String, errors: Array, attempted: Boolean, busy: Boolean, retrying: Boolean, rejectedVersion: Boolean })
const emit = defineEmits(['update:modelValue', 'submit'])
const form = ref(null), zh = computed(() => props.locale === 'zh'), payment = computed(() => props.handler.documentType === 'paymentRequest')
const prefix = computed(() => props.handler.prefix)
const invalid = path => !!props.attempted && props.errors.includes(path)
const error = path => props.handler.errorText(path, props.locale)
const fieldState = (field, line = null) => field.path === 'deviationReason' ? { ...field, required: props.modelValue.termsKind === 'NONSTANDARD' } : field.path === 'deductionReason' ? { ...field, required: (paymentAmountCents(line?.deductionAmount, props.modelValue.currency, true) ?? 0n) > 0n } : field
const lineSummary = line => props.handler.calculation({ ...props.modelValue, lines: [line] })
const copy = () => ({ ...props.modelValue, lines: props.modelValue.lines.map(line => ({ ...line })) })
function updateRoot(path, value) { emit('update:modelValue', { ...copy(), [path]: value }) }
function updateLine(index, path, value) { const next = copy(); next.lines[index][path] = value; emit('update:modelValue', next) }
async function addLine() {
  if (props.busy || props.modelValue.lines.length >= 20) return
  const next = copy(); next.lines.push(props.handler.createLine(newSubmissionKey)); emit('update:modelValue', next)
  await nextTick(); form.value?.querySelector(`#${prefix.value}-lines-${next.lines.length - 1}-${payment.value ? 'invoiceRef' : 'milestoneRef'}`)?.focus()
}
function removeLine(index) {
  if (props.busy || props.modelValue.lines.length <= 1) return
  const next = copy(); next.lines.splice(index, 1); emit('update:modelValue', next)
}
async function moveLine(index, offset) {
  if (props.busy || index + offset < 0 || index + offset >= props.modelValue.lines.length) return
  const next = copy(), [line] = next.lines.splice(index, 1); next.lines.splice(index + offset, 0, line); emit('update:modelValue', next)
  await nextTick(); form.value?.querySelector(`#${prefix.value}-lines-${index + offset}-${payment.value ? 'invoiceRef' : 'milestoneRef'}`)?.focus()
}
async function submit() { emit('submit'); await nextTick(); form.value?.querySelector('[aria-invalid="true"]')?.focus() }
const lineLabel = computed(() => payment.value ? (zh.value ? '发票' : 'Invoice') : (zh.value ? '里程碑' : 'Milestone'))
</script>
<template>
  <form ref="form" class="sf-scenario-form xf-form" :class="payment ? 'pf-form' : 'cf-form'" novalidate @submit.prevent="submit">
    <div class="xf-document-banner"><span>{{ payment ? 'PAYMENT REQUEST' : 'CONTRACT REVIEW' }}</span><strong>{{ payment ? (zh ? '核对每张发票的本次申请' : 'Reconcile this request, invoice by invoice') : (zh ? '条款明确，交付可核对' : 'Clear terms. Measurable delivery.') }}</strong><p>{{ payment ? (zh ? '原额 − 已结 = 声明未结；本次分配 − 扣减 = 净申请。' : 'Invoice − previously settled = declared outstanding. Allocation − deduction = net request.') : (zh ? '合同金额与里程碑精确相等，审批记录保留每项约定。' : 'Milestones must exactly match the contract amount. Every commitment stays in the review record.') }}</p></div>
    <section v-for="(section, index) in template.sections" :key="section.id" class="sf-form-section" :aria-labelledby="`${prefix}-section-${section.id}`"><header class="sf-section-title"><span>{{ String(index + 1).padStart(2, '0') }}</span><div><h2 :id="`${prefix}-section-${section.id}`">{{ section.title[locale] }}</h2></div></header><div class="sf-field-grid"><ScenarioField v-for="field in section.fields" :key="field.path" :field="fieldState(field)" :id="`${prefix}-${field.path}`" :model-value="modelValue[field.path]" :locale="locale" :disabled="busy" :currency="modelValue.currency" :invalid="invalid(field.path)" :error="error(field.path)" @update:model-value="updateRoot(field.path, $event)" /></div>
      <p v-if="!payment && section.fields.some(field => field.path === 'termsKind')" class="cf-terms-note" :class="{ nonstandard: modelValue.termsKind === 'NONSTANDARD' }" data-testid="contract-terms-note">{{ modelValue.termsKind === 'NONSTANDARD' ? (zh ? '非标准条款：请说明差异，交给实际分配的审批人核对。此标记不会自动改变路线。' : 'Nonstandard terms: describe the deviation for the assigned reviewers. This flag does not automatically change the route.') : (zh ? '标准条款：非标说明必须为空。切换不会清除已填文字，请明确清空；普通备注可写在申请事由中。' : 'Standard terms require an empty deviation reason. Switching keeps your text for review; clear it explicitly. General notes belong in the business purpose.') }}</p>
    </section>
    <section class="sf-form-section xf-lines" :aria-labelledby="`${prefix}-lines-heading`"><header class="sf-section-title"><span>{{ String(template.sections.length + 1).padStart(2, '0') }}</span><div><h2 :id="`${prefix}-lines-heading`">{{ template.lineItems.label[locale] }}</h2><p>{{ payment ? (zh ? '每张发票使用唯一编号。只验证本申请内声明的金额。' : 'Use one unique reference per invoice. Amounts are checked only within this request.') : (zh ? '按到期日先后排列，日期须在合同期限内；同日可有多期。' : 'Keep milestones in date order and within the contract term. Multiple milestones may share a date.') }}</p></div><b class="sf-count">{{ modelValue.lines.length }} / 20</b></header>
      <p v-if="invalid('lines')" class="field-error" role="alert">{{ error('lines') }}</p>
      <fieldset v-for="(line, index) in modelValue.lines" :key="line.lineId" class="xf-line-card" :data-line-id="line.lineId"><legend><span>{{ String(index + 1).padStart(2, '0') }}</span>{{ lineLabel }} {{ index + 1 }}</legend><div class="sf-line-fields"><ScenarioField v-for="field in template.lineItems.fields" :key="field.path" :field="fieldState(field, line)" :id="`${prefix}-lines-${index}-${field.path}`" :model-value="line[field.path]" :locale="locale" :disabled="busy" :currency="modelValue.currency" :invalid="invalid(`lines.${index}.${field.path}`)" :error="error(`lines.${index}.${field.path}`)" @update:model-value="updateLine(index, field.path, $event)" /></div>
        <p v-if="invalid(`lines.${index}.lineId`) || invalid(`lines.${index}.fields`)" class="field-error" role="alert">{{ error(`lines.${index}.lineId`) }}</p>
        <div v-if="payment" class="pf-line-calculation"><span>{{ zh ? '本行声明未结' : 'Declared outstanding' }} <b>{{ lineSummary(line) ? handler.money(lineSummary(line).declaredOutstanding, modelValue.currency) : '—' }}</b></span><span>{{ zh ? '本行净申请' : 'Line net requested' }} <b>{{ lineSummary(line) ? handler.money(lineSummary(line).netTotal, modelValue.currency) : '—' }}</b></span></div><div class="xf-line-actions"><button type="button" class="secondary" :aria-label="`${zh ? '上移' : 'Move up'} ${lineLabel} ${index + 1}`" :disabled="busy || index === 0" @click="moveLine(index, -1)">↑ {{ zh ? '上移' : 'Up' }}</button><button type="button" class="secondary" :aria-label="`${zh ? '下移' : 'Move down'} ${lineLabel} ${index + 1}`" :disabled="busy || index === modelValue.lines.length - 1" @click="moveLine(index, 1)">↓ {{ zh ? '下移' : 'Down' }}</button><button type="button" class="sf-remove-line" :aria-label="`${zh ? '删除' : 'Remove'} ${lineLabel} ${index + 1}`" :disabled="busy || modelValue.lines.length <= 1" @click="removeLine(index)">{{ zh ? '删除此项' : 'Remove line' }}</button></div>
      </fieldset>
      <button type="button" class="secondary sf-add-line" :data-testid="`add-${prefix}-line`" :disabled="busy || modelValue.lines.length >= 20" @click="addLine">＋ {{ payment ? (zh ? '添加发票' : 'Add invoice') : (zh ? '添加里程碑' : 'Add milestone') }}</button>
    </section>
    <ComplexSummary :business="modelValue" :handler="handler" :locale="locale" />
    <p v-if="attempted && errors.some(path => ['total', 'balance', 'reconciliation', 'netTotal', 'contractAmount'].includes(path))" class="field-error xf-total-error" role="alert">{{ error(errors.find(path => ['total', 'balance', 'reconciliation', 'netTotal', 'contractAmount'].includes(path))) }}</p>
    <footer class="sf-form-footer xf-submit-footer"><p>{{ payment ? (zh ? '审批通过仅表示申请获批，不执行付款、不锁定余额，也不跨单占用发票。' : 'Approval records an approved request. It does not pay, lock a balance or reserve invoices across requests.') : (zh ? '仅内部人工审批，不签署、不发给客户、不建立应收或触发付款。' : 'Internal human review only. No signing, customer delivery, receivable creation or payment.') }}</p><button class="primary" type="submit" :data-testid="`submit-${prefix}`" :disabled="busy || rejectedVersion">{{ busy ? (zh ? '正在处理…' : 'Working…') : retrying ? (zh ? '重试原申请' : 'Retry original request') : payment ? (zh ? '提交付款申请' : 'Submit payment request') : (zh ? '提交合同审批' : 'Submit contract for review') }} →</button></footer>
  </form>
</template>
