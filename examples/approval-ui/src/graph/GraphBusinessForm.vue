<script setup>
import { computed, nextTick, ref } from 'vue'
import GraphPaymentForm from './GraphPaymentForm.vue'
import { businessErrors, quoteFromSource } from './business.js'
import { amountCents, CURRENCIES, COST_CENTERS, decimal } from '../scenarios/expense-document.js'
import { TRAVEL_PURPOSES, travelDurationDays, travelTotal } from '../scenarios/travel-document.js'
import { emptyReceivingLine, quantity, QUANTITIES, UNITS, WAREHOUSES } from '../scenarios/receiving-document.js'
import { newSubmissionKey } from '../submission-intent.js'

const props = defineProps({ modelValue: { type: Object, required: true }, locale: { type: String, default: 'en' }, actor: Object, busy: Boolean, attempted: Boolean, quotes: { type: Array, default: () => [] } })
const emit = defineEmits(['update:modelValue', 'refresh-quotes'])
const root = ref(null), zh = computed(() => props.locale === 'zh')
const type = computed(() => props.modelValue.type), prefix = computed(() => type.value === 'quoteDiscount' ? 'quote' : type.value)
const errors = computed(() => businessErrors(props.modelValue))
const copy = (en, cn) => zh.value ? cn : en
const labels = {
  businessId: ['Business reference', '业务单号'], title: ['Title', '申请标题'], reason: ['Business purpose', '申请事由'],
  destination: ['Destination', '目的地'], startDate: ['Departure date', '出发日期'], endDate: ['Return date', '返回日期'], purpose: ['Travel purpose', '出差类型'],
  estimatedCost: ['Estimated budget', '预计费用'], currency: ['Currency', '币种'], costCenter: ['Cost center', '成本中心'],
  purchaseOrderRef: ['Purchase order reference', '采购单编号'], warehouse: ['Warehouse', '仓库'], receivedOn: ['Receiving date', '收货日期'],
  orderLineRef: ['Purchase order line', '采购单行号'], description: ['Description', '物料说明'], unit: ['Unit', '单位'],
  ordered: ['Ordered quantity', '订购数量'], received: ['Received quantity', '实收数量'], accepted: ['Accepted quantity', '合格数量'], rejected: ['Rejected quantity', '不合格数量'],
  exceptionReason: ['Exception reason', '异常原因'], customerRef: ['Customer reference', '客户编号'], quoteRevision: ['Quote revision', '报价修订号'],
  item: ['Quoted item', '报价产品'], quantity: ['Quantity', '数量'], listUnitPrice: ['List unit price', '目录单价'], validUntil: ['Quote valid until', '报价有效期'], requestedUnitPrice: ['Requested unit price', '申请单价'],
}
const options = {
  currency: CURRENCIES, costCenter: COST_CENTERS, purpose: TRAVEL_PURPOSES, warehouse: WAREHOUSES, unit: UNITS,
}
const optionLabels = {
  SALES: ['Sales', '销售'], ENGINEERING: ['Engineering', '工程'], OPERATIONS: ['Operations', '运营'],
  CUSTOMER_VISIT: ['Customer visit', '客户拜访'], PROJECT_DELIVERY: ['Project delivery', '项目交付'], TRAINING: ['Training', '培训'], CONFERENCE: ['Conference', '会议'], OTHER: ['Other', '其他'],
  EAST: ['East warehouse', '东仓'], WEST: ['West warehouse', '西仓'], PCS: ['Pieces (PCS)', '件（PCS）'], BOX: ['Boxes (BOX)', '箱（BOX）'],
}
const label = key => copy(...(labels[key] || [key, key]))
const optionLabel = value => optionLabels[value] ? copy(...optionLabels[value]) : value
const roots = computed(() => type.value === 'travel'
  ? ['businessId', 'title', 'costCenter', 'currency', 'destination', 'startDate', 'endDate', 'purpose', 'estimatedCost', 'reason']
  : type.value === 'receiving' ? ['businessId', 'title', 'purchaseOrderRef', 'warehouse', 'receivedOn', 'reason'] : ['title', 'requestedUnitPrice', 'reason'])
const sourceFields = ['businessId', 'quoteRevision', 'customerRef', 'item', 'quantity', 'listUnitPrice', 'currency', 'validUntil']
const lineFields = ['orderLineRef', 'description', 'unit', ...QUANTITIES, 'exceptionReason']
const isMoney = key => ['estimatedCost', 'requestedUnitPrice'].includes(key)
const isDate = key => ['startDate', 'endDate', 'receivedOn'].includes(key)
const maxLength = key => ({ title: 120, reason: 2000, destination: 160, description: 240, exceptionReason: 1000 }[key] || (isMoney(key) ? 32 : QUANTITIES.includes(key) ? 16 : 128))
const fieldId = path => `graph-${prefix.value}-${path.replaceAll('.', '-')}`
const invalid = path => props.attempted && (errors.value.includes(path) || path.endsWith('.accepted') && errors.value.includes(path.replace(/accepted$/, 'reconciliation')))
const sourceInvalid = computed(() => props.attempted && sourceFields.some(invalid))
function errorText(path) {
  const key = path.split('.').at(-1)
  if (key === 'accepted' && errors.value.includes(path.replace(/accepted$/, 'reconciliation'))) return copy('Accepted plus rejected must equal received.', '合格与不合格数量之和必须等于实收数量。')
  if (QUANTITIES.includes(key)) return copy('Use an integer from 0–100,000. Ordered must be positive; received cannot exceed ordered.', '请输入 0–100,000 的整数；订购须大于 0，实收不得超过订购数量。')
  const messages = {
    businessId: ['Use 1–128 ASCII reference characters, starting with a letter or digit.', '请使用 1–128 位 ASCII 引用字符，以字母或数字开头。'],
    purchaseOrderRef: ['Enter a sample purchase order reference, up to 128 ASCII characters.', '请填写演示采购单编号，最多 128 位 ASCII 引用字符。'],
    orderLineRef: ['Use a distinct purchase order line reference, up to 128 ASCII characters.', '采购单行号不可重复，最多 128 位 ASCII 引用字符。'],
    title: ['Enter a title, up to 120 characters.', '请填写标题，最多 120 字。'], reason: ['Enter the business purpose, up to 2,000 characters.', '请填写申请事由，最多 2,000 字。'],
    destination: ['Enter the destination, up to 160 characters.', '请填写目的地，最多 160 字。'],
    startDate: ['Enter a real departure date.', '请输入有效的出发日期。'], endDate: ['Return must be on or after departure; the trip can last 1–90 days, including both dates.', '返回日期不得早于出发日期；含首尾日期的行程须为 1–90 天。'],
    receivedOn: ['Enter a real receiving date.', '请输入有效的收货日期。'],
    estimatedCost: ['Use an amount above zero, up to 1,000,000,000, with at most two decimals. JPY must be whole yen.', '费用须大于 0 且不超过 1,000,000,000，最多两位小数；日元须为整数。'],
    requestedUnitPrice: ['Enter a positive price below the source list price, with at most two decimals. JPY must be whole yen.', '请输入大于 0 且低于来源目录单价的金额，最多两位小数；日元须为整数。'],
    description: ['Describe the goods, up to 240 characters.', '请填写物料说明，最多 240 字。'],
    exceptionReason: ['Explain rejected goods when rejected quantity is above zero, up to 1,000 characters.', '不合格数量大于 0 时须填写异常原因，最多 1,000 字。'],
  }
  return copy(...(messages[key] || ['Choose a valid value.', '请选择有效值。']))
}
function update(key, value) { if (!props.busy) emit('update:modelValue', { ...props.modelValue, [key]: value }) }
function updateLine(index, key, value) { update('lines', props.modelValue.lines.map((line, i) => i === index ? { ...line, [key]: value } : line)) }
async function addLine() {
  if (props.busy || props.modelValue.lines.length >= 20) return
  const index = props.modelValue.lines.length
  update('lines', [...props.modelValue.lines, emptyReceivingLine(newSubmissionKey)])
  await nextTick()
  root.value?.querySelector(`[data-testid="graph-receiving-${index}-orderLineRef"]`)?.focus()
}
function removeLine(index) { if (!props.busy && props.modelValue.lines.length > 1) update('lines', props.modelValue.lines.filter((_, i) => i !== index)) }
const balanced = line => QUANTITIES.every(key => quantity(line[key]) !== null) && quantity(line.ordered) > 0 && quantity(line.received) <= quantity(line.ordered) && quantity(line.accepted) + quantity(line.rejected) === quantity(line.received)
const quantities = computed(() => type.value !== 'receiving' ? [] : UNITS.filter(unit => props.modelValue.lines.some(line => line.unit === unit)).map(unit => {
  const lines = props.modelValue.lines.filter(line => line.unit === unit)
  return { unit, ...Object.fromEntries(['received', 'accepted', 'rejected'].map(key => [key, lines.every(line => quantity(line[key]) !== null) ? lines.reduce((sum, line) => sum + quantity(line[key]), 0) : '—'])) }
}))
const duration = computed(() => travelDurationDays(props.modelValue.startDate, props.modelValue.endDate))
const sourceKey = source => JSON.stringify([source.businessId, source.revision])
const selectedSourceKey = computed(() => JSON.stringify([props.modelValue.businessId, props.modelValue.quoteRevision]))
const hasSource = computed(() => Boolean(props.modelValue.businessId && props.modelValue.quoteRevision))
const selectedSource = computed(() => props.quotes.find(source => sourceKey(source) === selectedSourceKey.value))
const owned = source => !props.actor?.id || source.ownerId === props.actor.id
const expired = source => typeof source?.validUntil === 'string' && source.validUntil < new Date().toISOString().slice(0, 10)
const sourceChanged = computed(() => selectedSource.value && sourceFields.some(key => {
  const value = key === 'quoteRevision' ? selectedSource.value.revision : selectedSource.value[key]
  return key === 'listUnitPrice' ? amountCents(value, selectedSource.value.currency) !== amountCents(props.modelValue[key], props.modelValue.currency) : value !== props.modelValue[key]
}))
function chooseSource(event) {
  if (props.busy) return
  const source = props.quotes.find(item => sourceKey(item) === event.target.value)
  if (source && owned(source) && !expired(source)) emit('update:modelValue', quoteFromSource(source, props.modelValue))
}
const quoteTotal = computed(() => {
  const value = amountCents(props.modelValue.requestedUnitPrice, props.modelValue.currency)
  const count = quantity(props.modelValue.quantity)
  return value === null || count === null || count === 0 ? null : decimal(value * BigInt(count), props.modelValue.currency)
})
</script>

<template>
  <GraphPaymentForm v-if="type === 'paymentRequest'" :model-value="modelValue" :locale="locale" :busy="busy" :attempted="attempted" @update:model-value="emit('update:modelValue', $event)" />
  <div v-else ref="root" class="gf-business-form" :data-testid="`graph-${prefix}-form`">
    <template v-if="type === 'quoteDiscount'">
      <div class="gf-source-picker">
        <label for="graph-quote-source">{{ copy('Source quote revision', '来源报价修订') }}
          <select id="graph-quote-source" :value="hasSource ? selectedSourceKey : ''" :disabled="busy || !quotes.length" aria-required="true" :aria-invalid="sourceInvalid" :aria-describedby="sourceInvalid ? 'graph-quote-source-help graph-quote-source-error' : 'graph-quote-source-help'" data-testid="graph-quote-source" @change="chooseSource">
            <option value="" disabled>{{ copy('Choose a source quote', '请选择来源报价') }}</option>
            <option v-if="hasSource && !selectedSource" :value="selectedSourceKey">{{ modelValue.businessId }} · r{{ modelValue.quoteRevision }} · {{ copy('saved selection', '已保留选择') }}</option>
            <option v-for="source in quotes" :key="sourceKey(source)" :value="sourceKey(source)" :disabled="!owned(source) || expired(source)">{{ source.businessId }} · r{{ source.revision }} · {{ source.item }}{{ !owned(source) ? ` · ${copy('Read-only; owner', '只读；所属人')} ${source.ownerId}` : expired(source) ? ` · ${copy('Expired', '已过期')}` : '' }}</option>
          </select>
          <span v-if="sourceInvalid" id="graph-quote-source-error" class="gf-field-error">{{ copy('Choose a valid source quote revision.', '请选择有效的来源报价修订。') }}</span>
        </label>
        <button type="button" class="secondary" :disabled="busy" data-testid="graph-refresh-quotes" @click="emit('refresh-quotes')">{{ copy('Refresh quotes', '刷新报价') }}</button>
      </div>
      <p id="graph-quote-source-help" class="gf-muted">{{ copy('The server supplies the source revision, customer, item, quantity, list price, currency and expiry. These fields are read-only and rechecked on submission. Only your requested price, title and reason can be edited.', '来源修订、客户、产品、数量、目录价、币种及有效期由服务端提供，均为只读，提交时会再次核验。仅可编辑申请单价、标题及事由。') }}</p>
      <p v-if="!quotes.length" class="gf-callout" role="status">{{ copy('No source quotes are available to this account. Refresh to check again.', '当前账号暂无可用来源报价，可刷新重试。') }}</p>
      <p v-if="hasSource && (!selectedSource || sourceChanged)" class="gf-callout" role="status" data-testid="graph-quote-source-stale">{{ copy('The saved selection no longer matches an available source revision. Your inputs are preserved. Choose a current quote before submitting.', '保留的选择与当前可用来源修订不一致，输入内容已保留。请重新选择当前报价后再提交。') }} <button v-if="sourceChanged && owned(selectedSource) && !expired(selectedSource)" type="button" class="gf-text-button" :disabled="busy" data-testid="graph-quote-reload-source" @click="chooseSource({ target: { value: selectedSourceKey } })">{{ copy('Reload selected source facts', '重新加载所选来源事实') }}</button></p>
      <p v-if="hasSource && expired(modelValue)" class="gf-callout" role="status" data-testid="graph-quote-source-expired">{{ copy('This quote has expired. Choose a current source quote.', '此报价已过期，请选择当前有效的来源报价。') }}</p>
      <p v-if="selectedSource && !owned(selectedSource)" class="gf-callout" role="status">{{ copy('This quote is readable by your account, but only its owner may submit a discount request.', '此账号可查看此报价，但仅报价所属人可提交折扣申请。') }}</p>
      <dl v-if="hasSource" class="gf-source-facts" data-testid="graph-quote-source-facts"><div v-for="key in sourceFields" :key="key"><dt>{{ label(key) }}</dt><dd :data-testid="`graph-quote-${key}`">{{ modelValue[key] }}</dd></div></dl>
    </template>
    <div class="gf-form-grid">
      <label v-for="key in roots" :key="key" :for="fieldId(key)" :class="{ 'gf-wide': key === 'reason' }">{{ label(key) }}<small v-if="isMoney(key)"> · {{ modelValue.currency }}</small>
        <textarea v-if="key === 'reason'" :id="fieldId(key)" :value="modelValue[key]" :disabled="busy" :maxlength="maxLength(key)" rows="3" aria-required="true" :aria-invalid="invalid(key)" :aria-describedby="invalid(key) ? `${fieldId(key)}-error` : undefined" :data-testid="fieldId(key)" @input="update(key, $event.target.value)" />
        <select v-else-if="options[key]" :id="fieldId(key)" :value="modelValue[key]" :disabled="busy" aria-required="true" :aria-invalid="invalid(key)" :aria-describedby="invalid(key) ? `${fieldId(key)}-error` : undefined" :data-testid="fieldId(key)" @change="update(key, $event.target.value)"><option v-for="value in options[key]" :key="value" :value="value">{{ optionLabel(value) }}</option></select>
        <input v-else :id="fieldId(key)" :type="isDate(key) ? 'date' : 'text'" :value="modelValue[key]" :disabled="busy" :inputmode="isMoney(key) ? 'decimal' : undefined" :maxlength="maxLength(key)" aria-required="true" :aria-invalid="invalid(key)" :aria-describedby="invalid(key) ? `${fieldId(key)}-error` : undefined" :data-testid="fieldId(key)" @input="update(key, $event.target.value)">
        <span v-if="invalid(key)" :id="`${fieldId(key)}-error`" class="gf-field-error">{{ errorText(key) }}</span>
      </label>
    </div>
    <template v-if="type === 'travel'">
      <div class="gf-business-totals" aria-live="polite"><div><span>{{ copy('Trip duration (inclusive)', '出差天数（含首尾）') }}</span><strong data-testid="graph-travel-duration">{{ duration ?? '—' }} {{ copy('days', '天') }}</strong></div><div><span>{{ label('estimatedCost') }}</span><strong data-testid="graph-travel-total">{{ modelValue.currency }} {{ travelTotal(modelValue) ?? '—' }}</strong></div></div>
      <p class="gf-muted">{{ copy('Synthetic itinerary and budget only. Approval does not book travel, reimburse expenses or issue a payment.', '此处为合成行程与预算，审批通过不会预订出行、报销或付款。') }}</p>
    </template>
    <template v-if="type === 'receiving'">
      <p class="gf-muted">{{ copy('Purchase order references are synthetic. Reconcile each line: accepted + rejected = received, and received ≤ ordered.', '采购单引用为合成数据。请逐行核对：合格 + 不合格 = 实收，且实收 ≤ 订购。') }}</p>
      <p v-if="invalid('received')" class="gf-field-error" role="alert">{{ copy('At least one line must have a received quantity above zero.', '至少一行的实收数量须大于 0。') }}</p>
      <p v-if="invalid('lines')" class="gf-field-error" role="alert">{{ copy('Include 1–20 receiving lines.', '请填写 1–20 条收货明细。') }}</p>
      <fieldset v-for="(item, index) in modelValue.lines" :key="item.lineId" class="gf-invoice" :data-testid="`graph-receiving-line-${index}`"><legend>{{ copy('Receiving line', '收货明细') }} {{ index + 1 }}</legend>
        <div class="gf-form-grid">
          <label v-for="key in lineFields" :key="key" :for="fieldId(`lines.${index}.${key}`)" :class="{ 'gf-wide': key === 'exceptionReason' }">{{ label(key) }}<small v-if="key === 'exceptionReason'"> · {{ quantity(item.rejected) > 0 ? copy('Required', '必填') : copy('Optional', '选填') }}</small>
            <select v-if="key === 'unit'" :id="fieldId(`lines.${index}.${key}`)" :value="item[key]" :disabled="busy" aria-required="true" :aria-invalid="invalid(`lines.${index}.${key}`)" :aria-describedby="invalid(`lines.${index}.${key}`) ? `${fieldId(`lines.${index}.${key}`)}-error` : undefined" :data-testid="`graph-receiving-${index}-${key}`" @change="updateLine(index, key, $event.target.value)"><option v-for="value in UNITS" :key="value" :value="value">{{ optionLabel(value) }}</option></select>
            <textarea v-else-if="key === 'exceptionReason'" :id="fieldId(`lines.${index}.${key}`)" :value="item[key]" :disabled="busy" :maxlength="maxLength(key)" rows="2" :aria-required="quantity(item.rejected) > 0" :aria-invalid="invalid(`lines.${index}.${key}`)" :aria-describedby="invalid(`lines.${index}.${key}`) ? `${fieldId(`lines.${index}.${key}`)}-error` : undefined" :data-testid="`graph-receiving-${index}-${key}`" @input="updateLine(index, key, $event.target.value)" />
            <input v-else :id="fieldId(`lines.${index}.${key}`)" type="text" :value="item[key]" :disabled="busy" :inputmode="QUANTITIES.includes(key) ? 'numeric' : undefined" :maxlength="maxLength(key)" aria-required="true" :aria-invalid="invalid(`lines.${index}.${key}`)" :aria-describedby="invalid(`lines.${index}.${key}`) ? `${fieldId(`lines.${index}.${key}`)}-error` : undefined" :data-testid="`graph-receiving-${index}-${key}`" @input="updateLine(index, key, $event.target.value)">
            <span v-if="invalid(`lines.${index}.${key}`)" :id="`${fieldId(`lines.${index}.${key}`)}-error`" class="gf-field-error">{{ errorText(`lines.${index}.${key}`) }}</span>
          </label>
        </div>
        <div class="gf-receiving-line-footer"><p class="gf-muted" aria-live="polite">{{ balanced(item) ? copy('✓ Quantities reconciled', '✓ 数量已核对') : copy('Check quantities', '请核对数量') }}</p><button type="button" class="gf-text-button" :disabled="busy || modelValue.lines.length <= 1" :aria-label="`${copy('Remove receiving line', '删除收货行')} ${index + 1}`" :data-testid="`graph-remove-receiving-line-${index}`" @click="removeLine(index)">{{ copy('Remove line', '删除此行') }}</button></div>
      </fieldset>
      <button type="button" class="secondary" data-testid="graph-add-receiving-line" :disabled="busy || modelValue.lines.length >= 20" @click="addLine">＋ {{ copy('Add receiving line', '添加收货明细') }}</button>
      <section class="gf-receiving-summary" aria-live="polite" data-testid="graph-receiving-summary"><h3>{{ copy('Quantities by unit', '按单位汇总') }}</h3><p class="gf-muted">{{ copy('Pieces and boxes stay separate.', '件与箱分别汇总，不混加。') }}</p><div v-for="row in quantities" :key="row.unit"><strong>{{ optionLabel(row.unit) }}</strong><span v-for="key in ['received', 'accepted', 'rejected']" :key="key">{{ label(key) }} <b>{{ row[key] }}</b></span></div></section>
      <p class="gf-muted">{{ copy('Approval saves the receiving decision; it does not post inventory.', '审批通过会保存验收决定，不会增加库存。') }}</p>
    </template>
    <template v-if="type === 'quoteDiscount'"><div class="gf-total" aria-live="polite"><span>{{ copy('Requested quote total', '申请报价总额') }}</span><strong data-testid="graph-quote-total">{{ modelValue.currency }} {{ quoteTotal ?? '—' }}</strong></div><p class="gf-muted">{{ copy('The server calculates the discount and routing facts from the selected source and requested price. Approval does not issue an order or change the source quote.', '服务端依据所选来源及申请单价计算折扣与路由事实。审批通过不会下单或更改来源报价。') }}</p></template>
  </div>
</template>

<style scoped>
.gf-business-form{min-width:0}.gf-business-form label{min-width:0}.gf-business-form input,.gf-business-form select,.gf-business-form textarea{max-width:100%;box-sizing:border-box}.gf-business-form [aria-invalid=true]{border-color:#b8694b}.gf-business-form small{font-weight:400}.gf-source-picker{display:flex;align-items:start;gap:12px;flex-wrap:wrap}.gf-source-picker label{flex:1;min-width:200px}.gf-source-picker button{margin-top:23px}.gf-source-facts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px 20px;padding:18px;border:1px solid #dce6e0;border-radius:10px;background:#f5f8f5;margin:12px 0 24px}.gf-source-facts dt{color:#64776d;font-size:11px}.gf-source-facts dd{margin:5px 0 0;font-size:13px;overflow-wrap:anywhere}.gf-business-totals{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;padding:16px 0;border-top:1px solid #dfe8e1;border-bottom:1px solid #dfe8e1}.gf-business-totals>div{display:flex;flex-direction:column;gap:7px}.gf-business-totals span{font-size:12px;color:#64776d}.gf-business-totals strong{font-size:18px;color:#185a48;overflow-wrap:anywhere}.gf-receiving-line-footer{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}.gf-receiving-summary{padding:16px 0}.gf-receiving-summary h3{font-size:13px}.gf-receiving-summary>div{display:flex;gap:12px;flex-wrap:wrap;padding:12px 0;border-top:1px solid #dfe8e1;font-size:12px}.gf-receiving-summary>div>strong{min-width:90px}@media(max-width:600px){.gf-source-picker{display:block}.gf-source-picker button{margin:0 0 10px}.gf-source-facts,.gf-business-totals{grid-template-columns:1fr}.gf-receiving-summary>div>strong{width:100%}}
</style>
