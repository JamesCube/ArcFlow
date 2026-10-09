<script setup>
import { computed, nextTick, ref } from 'vue'
import ScenarioField from './ScenarioField.vue'
import { newSubmissionKey } from '../submission-intent.js'
import { quantity, UNITS, QUANTITIES, emptyReceivingLine } from './receiving-document.js'
const props = defineProps({ template: Object, modelValue: Object, locale: String, errors: Array, attempted: Boolean, busy: Boolean, retrying: Boolean, rejectedVersion: Boolean })
const emit = defineEmits(['update:modelValue', 'submit'])
const form = ref(null), zh = computed(() => props.locale === 'zh')
const clone = () => ({ ...props.modelValue, lines: props.modelValue.lines.map(line => ({ ...line })) })
const invalid = path => props.attempted && props.errors.includes(path)
const updateRoot = (path, value) => emit('update:modelValue', { ...clone(), [path]: value })
function updateLine(index, path, value) { const next = clone(); next.lines[index][path] = value; emit('update:modelValue', next) }
const fields = computed(() => props.template.lineItems.fields)
const field = path => fields.value.find(entry => entry.path === path)
const reconciled = line => QUANTITIES.every(key => quantity(line[key]) !== null) && quantity(line.ordered) > 0 && quantity(line.received) <= quantity(line.ordered) && quantity(line.accepted) + quantity(line.rejected) === quantity(line.received)
const summaries = computed(() => UNITS.filter(unit => props.modelValue.lines.some(line => line.unit === unit)).map(unit => {
  const lines = props.modelValue.lines.filter(line => line.unit === unit)
  return { unit, ...Object.fromEntries(['received', 'accepted', 'rejected'].map(key => [key, lines.every(line => quantity(line[key]) !== null) ? lines.reduce((sum, line) => sum + quantity(line[key]), 0) : '—'])) }
}))
function errorFor(path) {
  const key = path.split('.').at(-1)
  if (QUANTITIES.includes(key)) return zh.value ? '请输入 0–100,000 的整数；订购数量须大于 0，实收不得超过订购数量。' : 'Use an integer from 0–100,000. Ordered must be positive; received cannot exceed ordered.'
  const en = { businessId: 'Use a sample receipt reference, up to 128 ASCII reference characters.', purchaseOrderRef: 'Enter a synthetic purchase order reference, up to 128 ASCII reference characters.', title: 'Enter a title, up to 120 characters.', reason: 'Enter the receiving purpose, up to 2,000 characters.', receivedOn: 'Enter a real date in YYYY-MM-DD format.', description: 'Describe the goods, up to 240 characters.', orderLineRef: 'Use a distinct purchase order line reference, up to 128 ASCII reference characters.', exceptionReason: 'Explain rejected goods (required when rejected is above zero), up to 1,000 characters.', unit: 'Choose PCS or BOX.', warehouse: 'Choose a warehouse.' }
  const cn = { businessId: '请填写演示单据编号，最多 128 位 ASCII 引用字符。', purchaseOrderRef: '请填写演示采购单编号，最多 128 位 ASCII 引用字符。', title: '请填写标题，最多 120 字。', reason: '请填写收货事由，最多 2,000 字。', receivedOn: '请输入有效日期，格式为 YYYY-MM-DD。', description: '请填写物料说明，最多 240 字。', orderLineRef: '采购单行号不可重复，最多 128 位 ASCII 引用字符。', exceptionReason: '不合格数量大于 0 时须填写原因，最多 1,000 字。', unit: '请选择件或箱。', warehouse: '请选择仓库。' }
  return (zh.value ? cn : en)[key] || (zh.value ? '请检查此项。' : 'Check this field.')
}
async function addLine() {
  if (props.busy || props.modelValue.lines.length >= 20) return
  const index = props.modelValue.lines.length
  emit('update:modelValue', { ...clone(), lines: [...props.modelValue.lines, emptyReceivingLine(newSubmissionKey)] })
  await nextTick(); form.value?.querySelector(`#receiving-lines-${index}-orderLineRef`)?.focus()
}
function removeLine(index) { if (!props.busy && props.modelValue.lines.length > 1) emit('update:modelValue', { ...clone(), lines: props.modelValue.lines.filter((_, i) => i !== index) }) }
function sample() {
  if (props.busy) return
  const make = () => emptyReceivingLine(newSubmissionKey)
  emit('update:modelValue', { type: 'receiving', documentVersion: 1, businessId: 'GRN-DEMO-001', title: zh.value ? '车间物料到货验收' : 'Workshop supply delivery', reason: zh.value ? '演示采购单收货验收，仅使用合成数据。' : 'Sample purchase order receipt using synthetic data only.', purchaseOrderRef: 'PO-DEMO-001', warehouse: 'EAST', receivedOn: new Date().toISOString().slice(0, 10), lines: [
    { ...make(), orderLineRef: 'PO-DEMO-001-10', description: zh.value ? '安装支架' : 'Mounting brackets', unit: 'PCS', ordered: '100', received: '80', accepted: '78', rejected: '2', exceptionReason: zh.value ? '两件支架弯曲' : 'Two bent brackets' },
    { ...make(), orderLineRef: 'PO-DEMO-001-20', description: zh.value ? '防护包装' : 'Protective packaging', unit: 'BOX', ordered: '10', received: '10', accepted: '10', rejected: '0', exceptionReason: '' },
  ] })
}
async function submit() { emit('submit'); await nextTick(); form.value?.querySelector('[aria-invalid="true"]')?.focus() }
</script>
<template>
  <form ref="form" class="rf-form" novalidate @submit.prevent="submit">
    <section class="sf-form-section"><header class="sf-section-title"><span>01</span><div><h2>{{ zh ? '收货信息' : 'Delivery details' }}</h2><p>{{ zh ? '采购单与行号均为演示引用，不会查询真实订单。' : 'Purchase order and line references are synthetic. No real order lookup.' }}</p></div><button v-if="!modelValue.businessId && !modelValue.title" class="secondary rf-sample" type="button" :disabled="busy" data-testid="fill-receiving-sample" @click="sample">{{ zh ? '填入演示数据' : 'Fill sample receipt' }}</button></header>
      <div class="sf-field-grid"><ScenarioField v-for="entry in template.sections.flatMap(section => section.fields)" :key="entry.path" :field="entry" :id="`receiving-${entry.path}`" :model-value="modelValue[entry.path]" :locale="locale" :disabled="busy" :invalid="invalid(entry.path)" :error="errorFor(entry.path)" @update:model-value="updateRoot(entry.path, $event)" /></div>
    </section>
    <section class="sf-form-section rf-line-section"><header class="sf-section-title"><span>02</span><div><h2>{{ zh ? '数量与验收' : 'Quantities & inspection' }}</h2><p>{{ zh ? '逐行核对：合格 + 不合格 = 实收，实收 ≤ 订购。' : 'Reconcile each line: accepted + rejected = received, received ≤ ordered.' }}</p></div><b class="sf-count">{{ modelValue.lines.length }} / 20</b></header>
      <p v-if="invalid('received')" class="error" role="alert">{{ zh ? '至少一行实收数量必须大于 0。' : 'At least one line must have a received quantity above zero.' }}</p>
      <fieldset v-for="(line, index) in modelValue.lines" :key="line.lineId" class="rf-line-card" :data-line-id="line.lineId"><legend>{{ zh ? '收货行' : 'RECEIVING LINE' }} {{ String(index + 1).padStart(2, '0') }}</legend>
        <div class="rf-line-meta"><ScenarioField v-for="path in ['orderLineRef', 'description', 'unit']" :key="path" :field="field(path)" :id="`receiving-lines-${index}-${path}`" :model-value="line[path]" :locale="locale" :disabled="busy" :invalid="invalid(`lines.${index}.${path}`)" :error="errorFor(path)" @update:model-value="updateLine(index, path, $event)" /></div>
        <div class="rf-quantity-grid"><ScenarioField v-for="path in QUANTITIES" :key="path" :field="field(path)" :id="`receiving-lines-${index}-${path}`" :model-value="line[path]" :locale="locale" :disabled="busy" :invalid="invalid(`lines.${index}.${path}`) || path === 'accepted' && invalid(`lines.${index}.reconciliation`)" :error="invalid(`lines.${index}.reconciliation`) && path === 'accepted' ? (zh ? '合格与不合格数量之和必须等于实收数量。' : 'Accepted plus rejected must equal received.') : errorFor(path)" @update:model-value="updateLine(index, path, $event)" /></div>
        <div class="rf-equation" :class="{ balanced: reconciled(line) }" aria-live="polite"><span>{{ reconciled(line) ? '✓' : '○' }}</span>{{ zh ? '合格 + 不合格 = 实收' : 'Accepted + rejected = received' }}<strong>{{ reconciled(line) ? (zh ? '已核对' : 'Balanced') : (zh ? '待核对' : 'Check quantities') }}</strong></div>
        <ScenarioField :field="{ ...field('exceptionReason'), required: quantity(line.rejected) > 0, label: { en: quantity(line.rejected) > 0 ? 'Exception reason (required)' : 'Exception reason (optional)', zh: quantity(line.rejected) > 0 ? '异常原因（必填）' : '异常原因（选填）' } }" :id="`receiving-lines-${index}-exceptionReason`" :model-value="line.exceptionReason" :locale="locale" :disabled="busy" :invalid="invalid(`lines.${index}.exceptionReason`)" :error="errorFor('exceptionReason')" @update:model-value="updateLine(index, 'exceptionReason', $event)" />
        <button type="button" class="sf-remove-line" :disabled="busy || modelValue.lines.length <= 1" :aria-label="`${zh ? '删除收货行' : 'Remove receiving line'} ${index + 1}`" @click="removeLine(index)">{{ zh ? '删除此行' : 'Remove line' }}</button>
      </fieldset>
      <button class="secondary sf-add-line" type="button" data-testid="add-receiving-line" :disabled="busy || modelValue.lines.length >= 20" @click="addLine">＋ {{ zh ? '添加收货明细' : 'Add receiving line' }}</button>
    </section>
    <section class="rf-summary rf-form-summary" aria-live="polite" data-testid="receiving-summary"><p class="sf-kicker">{{ zh ? '按单位汇总 · 不混加件与箱' : 'QUANTITIES BY UNIT · PCS AND BOX STAY SEPARATE' }}</p><div v-for="row in summaries" :key="row.unit"><b>{{ row.unit }}</b><span>{{ zh ? '实收' : 'Received' }} <strong>{{ row.received }}</strong></span><span>{{ zh ? '合格' : 'Accepted' }} <strong>{{ row.accepted }}</strong></span><span>{{ zh ? '不合格' : 'Rejected' }} <strong>{{ row.rejected }}</strong></span></div></section>
    <footer class="rf-submit"><p>{{ zh ? '提交后保存业务与流程快照。审批通过不会增加库存。' : 'Submission saves the document and process snapshot. Approval does not post stock.' }}</p><button class="primary" type="submit" data-testid="submit-receiving" :disabled="busy || rejectedVersion">{{ busy ? (zh ? '正在处理…' : 'Working…') : retrying ? (zh ? '重试原收货单' : 'Retry original receipt') : (zh ? '提交收货验收' : 'Submit receiving') }} →</button></footer>
  </form>
</template>
