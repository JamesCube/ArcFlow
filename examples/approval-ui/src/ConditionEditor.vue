<script setup>
import { computed } from 'vue'
const props = defineProps({ modelValue: Object, processId: String, locale: String, editable: Boolean, busy: Boolean, totalPredicates: Number, canCondition: Boolean })
const emit = defineEmits(['update:modelValue', 'end-merge'])
const zh = computed(() => props.locale === 'zh')
const text = (en, cn) => zh.value ? cn : en
const payment = computed(() => props.processId === 'erp-payment')
const receiving = computed(() => props.processId === 'erp-receiving')
const defaultAtom = () => payment.value ? { field: 'payment.netTotal', operator: 'GTE', currency: 'CNY', threshold: 10000 } : receiving.value ? { field: 'receiving.hasRejectedLines', operator: 'EQ', expected: true } : { field: 'contract.termsKind', operator: 'EQ', values: ['NONSTANDARD'] }
function update(value) { if (props.editable && !props.busy) emit('update:modelValue', value) }
function toggle(value) { if (!value || props.canCondition && props.totalPredicates < 8) update(value ? { mode: 'ALL', predicates: [defaultAtom()] } : undefined) }
function edit(index, changes) { const next = JSON.parse(JSON.stringify(props.modelValue)); next.predicates[index] = { ...next.predicates[index], ...changes }; update(next) }
function termsOperator(index, operator) { const atom = props.modelValue.predicates[index]; edit(index, { operator, values: operator === 'EQ' ? atom.values.slice(0, 1) : atom.values }) }
function toggleValue(index, value, checked) { const values = props.modelValue.predicates[index].values; edit(index, { values: checked ? [...new Set([...values, value])] : values.filter(item => item !== value) }) }
function add() { if (props.totalPredicates < 8) update({ ...props.modelValue, predicates: [...props.modelValue.predicates, defaultAtom()] }) }
function remove(index) { update({ ...props.modelValue, predicates: props.modelValue.predicates.filter((_, current) => current !== index) }) }
// Keep invalid input visible as an invalid draft; never round hidden sub-cent digits.
const thresholdValue = value => value === '' ? null : /^\d+(?:\.\d{1,2})?$/.test(value) ? Number(value) : value
const label = (name, index) => `${text('Condition', '条件')} ${index + 1} ${name}`
</script>
<template>
  <section class="routing-editor" data-testid="routing-editor">
    <h4>{{ text('When this step runs', '节点执行条件') }}</h4>
    <label v-if="editable">{{ text('Route inclusion', '纳入审批路径') }}<select :value="modelValue ? 'conditional' : 'always'" data-testid="condition-enabled" :disabled="busy" @change="toggle($event.target.value === 'conditional')"><option value="always">{{ text('Always include', '始终纳入') }}</option><option value="conditional" :disabled="!modelValue && (!canCondition || totalPredicates >= 8)">{{ text('Include when conditions match', '满足条件时纳入') }}</option></select></label>
    <p v-else class="routing-readonly">{{ modelValue ? text('Conditional step', '条件节点') : text('Always included', '始终纳入') }}</p>
    <p class="routing-help">{{ text('Evaluated once from the saved document on submission. Keep at least one unconditional step. At most 8 conditions across the process.', '提交时依据保存的业务单据一次性计算。至少保留一个无条件节点；整个流程最多 8 条条件。') }}</p>
    <template v-if="modelValue">
      <label>{{ text('Match rule', '匹配规则') }}<select :value="modelValue.mode" data-testid="condition-mode" :disabled="busy || !editable" @change="update({ ...modelValue, mode: $event.target.value })"><option value="ALL">{{ text('All conditions (ALL)', '全部满足（ALL）') }}</option><option value="ANY">{{ text('Any condition (ANY)', '任一满足（ANY）') }}</option></select></label>
      <fieldset v-for="(atom, index) in modelValue.predicates" :key="index" class="routing-atom" :disabled="busy || !editable"><legend>{{ text('Condition', '条件') }} {{ index + 1 }}</legend><p class="routing-field">{{ payment ? text('Payment net total', '付款净申请额') : receiving ? text('Receipt has rejected lines', '收货单存在不合格明细') : text('Contract terms kind', '合同条款类型') }}</p>
        <template v-if="payment">
          <label>{{ text('Comparison', '比较方式') }}<select :value="atom.operator" :aria-label="label(text('comparison', '比较方式'), index)" @change="edit(index, { operator: $event.target.value })"><option value="EQ">{{ text('Equals', '等于') }} (=)</option><option value="GT">{{ text('Greater than', '大于') }} (&gt;)</option><option value="GTE">{{ text('At least', '大于等于') }} (≥)</option><option value="LT">{{ text('Less than', '小于') }} (&lt;)</option><option value="LTE">{{ text('At most', '小于等于') }} (≤)</option></select></label>
          <div class="routing-money"><label>{{ text('Currency', '币种') }}<select :value="atom.currency" :aria-label="label(text('currency', '币种'), index)" @change="edit(index, { currency: $event.target.value })"><option v-for="currency in ['CNY', 'USD', 'EUR', 'GBP', 'JPY']" :key="currency">{{ currency }}</option></select></label><label>{{ text('Threshold', '金额阈值') }}<input :value="atom.threshold" type="number" min="0" max="20000000000" :step="atom.currency === 'JPY' ? '1' : '0.01'" :aria-label="label(text('threshold', '金额阈值'), index)" @input="edit(index, { threshold: thresholdValue($event.target.value) })" @blur="emit('end-merge')"></label></div>
          <p class="routing-help">{{ text('0–20,000,000,000; up to 2 decimals (JPY: whole numbers). The document must use the same currency as every amount condition. No currency conversion.', '0–20,000,000,000；最多两位小数（日元必须为整数）。单据币种必须与每条金额条件一致，不进行汇率换算。') }}</p>
        </template>
        <label v-else-if="receiving">{{ text('Expected value', '预期值') }}<select :value="String(atom.expected)" :aria-label="label(text('expected value', '预期值'), index)" @change="edit(index, { expected: $event.target.value === 'true' })"><option value="true">{{ text('Yes, rejected lines exist', '是，存在不合格明细') }}</option><option value="false">{{ text('No rejected lines', '否，无不合格明细') }}</option></select></label>
        <template v-else>
          <label>{{ text('Comparison', '比较方式') }}<select :value="atom.operator" :aria-label="label(text('comparison', '比较方式'), index)" @change="termsOperator(index, $event.target.value)"><option value="EQ">{{ text('Equals (EQ)', '等于（EQ）') }}</option><option value="IN">{{ text('One of (IN)', '属于（IN）') }}</option></select></label>
          <label v-if="atom.operator === 'EQ'">{{ text('Terms kind', '条款类型') }}<select :value="atom.values[0]" :aria-label="label(text('terms kind', '条款类型'), index)" @change="edit(index, { values: [$event.target.value] })"><option value="STANDARD">{{ text('Standard', '标准条款') }}</option><option value="NONSTANDARD">{{ text('Nonstandard', '非标准条款') }}</option></select></label>
          <div v-else class="routing-values"><label v-for="value in ['STANDARD', 'NONSTANDARD']" :key="value"><input type="checkbox" :checked="atom.values.includes(value)" :aria-label="label(value, index)" @change="toggleValue(index, value, $event.target.checked)">{{ value === 'STANDARD' ? text('Standard', '标准条款') : text('Nonstandard', '非标准条款') }}</label><p>{{ text('Select at least one terms kind.', '至少选择一种条款类型。') }}</p></div>
        </template>
        <button v-if="editable" type="button" class="remove-step" :disabled="modelValue.predicates.length <= 1" :aria-label="label(text('remove', '删除'), index)" @click="remove(index)">{{ text('Remove condition', '删除条件') }}</button>
      </fieldset>
      <button v-if="editable" type="button" class="secondary" data-testid="add-condition" :disabled="busy || totalPredicates >= 8" @click="add">＋ {{ text('Add condition', '添加条件') }}</button>
      <p class="routing-help">{{ totalPredicates }} / 8 {{ text('conditions in this process', '条流程条件') }}</p>
    </template>
    <p v-if="editable && !modelValue && !canCondition" class="routing-help">{{ text('This is the last unconditional step. Keep it always included, or make another step unconditional first.', '这是最后一个无条件节点。请保留始终纳入，或先将其他节点改为无条件。') }}</p>
  </section>
</template>
