<script setup>
import { computed, nextTick, ref } from 'vue'
import { getScenarioHandler } from './scenario-registry.js'
import { newSubmissionKey } from '../submission-intent.js'
import ScenarioField from './ScenarioField.vue'
const props = defineProps({ template: Object, handler: { type: Object, default: () => getScenarioHandler() }, modelValue: Object, locale: String, errors: Array, attempted: Boolean, busy: Boolean, retrying: Boolean, rejectedVersion: Boolean })
const emit = defineEmits(['update:modelValue', 'submit'])
const form = ref(null), zh = computed(() => props.locale === 'zh')
const prefix = computed(() => props.handler.documentType), travel = computed(() => prefix.value === 'travel')
const duration = computed(() => props.handler.duration?.(props.modelValue) ?? null)
const total = computed(() => props.handler.total(props.modelValue))
const invalid = path => props.attempted && props.errors.includes(path)
const copy = () => props.template.lineItems ? ({ ...props.modelValue, lines: props.modelValue.lines.map(line => ({ ...line })) }) : ({ ...props.modelValue })
const updateRoot = (path, value) => emit('update:modelValue', { ...copy(), [path]: value })
function updateLine(index, path, value) { const next = copy(); next.lines[index][path] = value; emit('update:modelValue', next) }
async function addLine() {
  if (props.busy || props.modelValue.lines.length >= props.template.lineItems.maxItems) return
  const index = props.modelValue.lines.length
  emit('update:modelValue', { ...copy(), lines: [...props.modelValue.lines, props.handler.createLine(newSubmissionKey)] })
  await nextTick(); form.value?.querySelector(`[id="${prefix.value}-lines-${index}-spentOn"]`)?.focus()
}
function removeLine(index) {
  if (props.busy || props.modelValue.lines.length <= props.template.lineItems.minItems) return
  emit('update:modelValue', { ...copy(), lines: props.modelValue.lines.filter((_, i) => index !== i) })
}
function errorFor(path) {
  const key = path.split('.').at(-1)
  const en = { businessId: 'Use 1–128 ASCII letters, digits or . _ : / -; start with a letter or digit.', title: 'Enter a title, up to 120 characters.', reason: 'Enter a business purpose, up to 2,000 characters.', spentOn: 'Enter a real date in YYYY-MM-DD format.', description: 'Describe this expense, up to 240 characters.', amount: props.modelValue.currency === 'JPY' ? 'Enter a positive whole-yen amount, at most 1,000,000,000.' : 'Enter a positive amount with up to 2 decimals, at most 1,000,000,000.', receiptRef: 'Use a unique receipt reference: 1–128 ASCII letters, digits or . _ : / -.', category: 'Choose an expense category.', currency: 'Choose a supported currency.', costCenter: 'Choose a cost center.' }
  const cn = { businessId: '请输入 1–128 位字母、数字或 . _ : / -，以字母或数字开头。', title: '请填写标题，最多 120 字。', reason: '请填写报销事由，最多 2,000 字。', spentOn: '请输入有效日期，格式为 YYYY-MM-DD。', description: '请填写费用说明，最多 240 字。', amount: props.modelValue.currency === 'JPY' ? '请输入大于 0、不超过 1,000,000,000 的整数日元金额。' : '请输入大于 0、不超过 1,000,000,000 的金额，最多两位小数。', receiptRef: '凭证编号不可重复：1–128 位字母、数字或 . _ : / -。', category: '请选择费用类别。', currency: '请选择支持的币种。', costCenter: '请选择成本中心。' }
  Object.assign(en, { destination: 'Enter a destination, up to 160 characters.', startDate: 'Enter a real start date in YYYY-MM-DD format.', endDate: 'Enter a real end date on or after the start date, for an inclusive trip of 1–90 days.', purpose: 'Choose a travel purpose.', estimatedCost: en.amount })
  Object.assign(cn, { destination: '请填写出差地点，最多 160 字。', startDate: '请输入有效出发日期，格式为 YYYY-MM-DD。', endDate: '返程日期不能早于出发日期，含首尾的行程须为 1–90 天。', purpose: '请选择出差目的。', estimatedCost: cn.amount })
  if (travel.value) { en.reason = 'Enter a business justification, up to 2,000 characters.'; cn.reason = '请填写出差事由，最多 2,000 字。' }
  return (zh.value ? cn : en)[key] || (zh.value ? '请检查此项。' : 'Check this field.')
}
async function submit() { emit('submit'); await nextTick(); form.value?.querySelector('[aria-invalid="true"]')?.focus() }
</script>
<template>
  <form ref="form" class="sf-expense-form sf-scenario-form" novalidate @submit.prevent="submit">
    <section v-for="(section, index) in template.sections" :key="section.id" class="sf-form-section" :aria-labelledby="`section-${section.id}`"><header class="sf-section-title"><span>{{ String(index + 1).padStart(2, '0') }}</span><div><h2 :id="`section-${section.id}`">{{ section.title[locale] }}</h2></div></header><div class="sf-field-grid"><ScenarioField v-for="field in section.fields" :key="field.path" :field="field" :id="`${prefix}-${field.path}`" :model-value="modelValue[field.path]" :locale="locale" :disabled="busy" :currency="modelValue.currency" :invalid="invalid(field.path)" :error="errorFor(field.path)" @update:model-value="updateRoot(field.path, $event)" /></div></section>
    <section v-if="template.lineItems" class="sf-form-section sf-line-section" aria-labelledby="expense-lines-heading"><header class="sf-section-title"><span>{{ String(template.sections.length + 1).padStart(2, '0') }}</span><div><h2 id="expense-lines-heading">{{ template.lineItems.label[locale] }}</h2><p>{{ zh ? '每项费用对应一个唯一凭证编号。仅填写演示编号，无需上传文件。' : 'One unique receipt reference per expense. Use sample references; no file upload.' }}</p></div><b class="sf-count">{{ modelValue.lines.length }} / {{ template.lineItems.maxItems }}</b></header>
      <fieldset v-for="(line, index) in modelValue.lines" :key="line.lineId" class="sf-line-card" :data-line-id="line.lineId"><legend>{{ zh ? '费用' : 'Expense' }} {{ String(index + 1).padStart(2, '0') }}</legend><div class="sf-line-fields"><ScenarioField v-for="field in template.lineItems.fields" :key="field.path" :field="field" :id="`${prefix}-lines-${index}-${field.path}`" :model-value="line[field.path]" :locale="locale" :disabled="busy" :currency="modelValue.currency" :invalid="invalid(`lines.${index}.${field.path}`)" :error="errorFor(field.path)" @update:model-value="updateLine(index, field.path, $event)" /></div><button class="sf-remove-line" type="button" :disabled="busy || modelValue.lines.length <= template.lineItems.minItems" :aria-label="`${zh ? '删除费用' : 'Remove expense'} ${index + 1}`" @click="removeLine(index)">{{ zh ? '删除此项' : 'Remove line' }}</button></fieldset>
      <button type="button" class="secondary sf-add-line" data-testid="add-expense-line" :disabled="busy || modelValue.lines.length >= template.lineItems.maxItems" @click="addLine">＋ {{ zh ? '添加费用明细' : 'Add expense line' }}</button>
    </section>
    <section v-if="travel" class="sf-derived-summary" aria-live="polite"><span>{{ zh ? '行程天数（含首尾）' : 'Trip duration (inclusive)' }}</span><strong data-testid="travel-duration">{{ duration === null ? '—' : `${duration} ${zh ? '天' : duration === 1 ? 'day' : 'days'}` }}</strong><p>{{ zh ? '由日期计算，须为 1–90 天。此值不会作为表单字段提交。' : 'Calculated from your dates; must be 1–90 days. This value is not submitted as a form field.' }}</p></section>
    <footer class="sf-form-footer"><div><span>{{ travel ? (zh ? '预计费用' : 'ESTIMATED COST') : (zh ? '报销总额' : 'TOTAL REIMBURSEMENT') }}</span><strong :data-testid="`${prefix}-total`">{{ total === null ? '—' : handler.money(total, modelValue.currency) }}</strong><small>{{ travel ? (zh ? '仅为合成预算 · 不预订、不报销、不付款' : 'Synthetic budget · no booking, reimbursement or payment') : (zh ? '精确合计 · 所有明细使用同一币种' : 'Exact total · one currency for every line') }}</small></div><button class="primary" type="submit" :data-testid="`submit-${prefix}`" :disabled="busy || rejectedVersion">{{ busy ? (zh ? '正在处理…' : 'Working…') : retrying ? (zh ? '重试原申请' : 'Retry original request') : (zh ? (travel ? '提交出差申请' : '提交报销申请') : 'Submit for approval') }} <span aria-hidden="true">→</span></button></footer>
  </form>
</template>
