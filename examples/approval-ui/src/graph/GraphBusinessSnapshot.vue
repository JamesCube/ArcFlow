<script setup>
import { computed } from 'vue'
import { amountCents, decimal, formatExpenseMoney } from '../scenarios/expense-document.js'
import { paymentSummary } from '../scenarios/payment-document.js'
import { quantity, receivingSummary } from '../scenarios/receiving-document.js'
import { travelDurationDays } from '../scenarios/travel-document.js'

const props = defineProps({ business: { type: Object, required: true }, locale: { type: String, default: 'en' } })
const zh = computed(() => props.locale === 'zh'), type = computed(() => props.business.type)
const copy = (en, cn) => zh.value ? cn : en
const labels = {
  businessId: ['Business reference', '业务单号'], title: ['Title', '申请标题'], reason: ['Business purpose', '申请事由'], currency: ['Currency', '币种'],
  supplierRef: ['Supplier reference', '供应商编号'], requestedPaymentOn: ['Requested payment date', '申请付款日'],
  destination: ['Destination', '目的地'], startDate: ['Departure date', '出发日期'], endDate: ['Return date', '返回日期'], purpose: ['Travel purpose', '出差类型'], costCenter: ['Cost center', '成本中心'], estimatedCost: ['Estimated budget', '预计费用'],
  purchaseOrderRef: ['Purchase order reference', '采购单编号'], warehouse: ['Warehouse', '仓库'], receivedOn: ['Receiving date', '收货日期'],
  customerRef: ['Customer reference', '客户编号'], quoteRevision: ['Source quote revision', '来源报价修订号'], item: ['Quoted item', '报价产品'], quantity: ['Quantity', '数量'], listUnitPrice: ['List unit price', '目录单价'], requestedUnitPrice: ['Requested unit price', '申请单价'], validUntil: ['Quote valid until', '报价有效期'],
  lineId: ['Line reference', '明细编号'], invoiceRef: ['Invoice reference', '发票编号'], description: ['Description', '明细说明'], invoiceAmount: ['Invoice amount', '发票原额'], previouslySettledAmount: ['Previously settled', '声明已结金额'], allocationAmount: ['This allocation', '本次分配'], deductionAmount: ['Deduction', '本次扣减'], deductionReason: ['Deduction reason', '扣减原因'],
  orderLineRef: ['Purchase order line', '采购单行号'], unit: ['Unit', '单位'], ordered: ['Ordered quantity', '订购数量'], received: ['Received quantity', '实收数量'], accepted: ['Accepted quantity', '合格数量'], rejected: ['Rejected quantity', '不合格数量'], exceptionReason: ['Exception reason', '异常原因'],
  declaredOutstanding: ['Declared outstanding', '声明未结金额'], grossAllocation: ['Gross allocation', '本次分配总额'], deductionTotal: ['Total deductions', '扣减总额'], netTotal: ['Net requested payment', '净付款申请额'],
  duration: ['Trip duration (inclusive)', '出差天数（含首尾）'], lineCount: ['Receiving lines', '收货明细数'], exceptionLineCount: ['Lines with rejected goods', '含不合格品的明细数'], listTotal: ['Source list total', '来源目录总额'], requestedTotal: ['Requested quote total', '申请报价总额'],
}
const enumLabels = {
  SALES: ['Sales', '销售'], ENGINEERING: ['Engineering', '工程'], OPERATIONS: ['Operations', '运营'],
  CUSTOMER_VISIT: ['Customer visit', '客户拜访'], PROJECT_DELIVERY: ['Project delivery', '项目交付'], TRAINING: ['Training', '培训'], CONFERENCE: ['Conference', '会议'], OTHER: ['Other', '其他'],
  EAST: ['East warehouse', '东仓'], WEST: ['West warehouse', '西仓'], PCS: ['Pieces (PCS)', '件（PCS）'], BOX: ['Boxes (BOX)', '箱（BOX）'],
}
const label = key => copy(...(labels[key] || [key, key]))
const enumLabel = value => enumLabels[value] ? copy(...enumLabels[value]) : value
const moneyKeys = new Set(['estimatedCost', 'listUnitPrice', 'requestedUnitPrice', 'invoiceAmount', 'previouslySettledAmount', 'allocationAmount', 'deductionAmount', 'declaredOutstanding', 'grossAllocation', 'deductionTotal', 'netTotal', 'listTotal', 'requestedTotal'])
const display = (key, value) => value === '' || value === undefined || value === null ? copy('Not provided', '未填写') : moneyKeys.has(key) ? formatExpenseMoney(value, props.business.currency) : ['costCenter', 'purpose', 'warehouse', 'unit'].includes(key) ? enumLabel(value) : String(value)
const heading = computed(() => ({ paymentRequest: copy('Payment request details', '付款申请详情'), travel: copy('Travel request details', '出差申请详情'), receiving: copy('Receiving document details', '收货验收详情'), quoteDiscount: copy('Quote discount request details', '报价折扣申请详情') }[type.value] || copy('Business document details', '业务单据详情')))
const rootFields = computed(() => ['businessId', 'title', ...({
  paymentRequest: ['supplierRef', 'requestedPaymentOn', 'currency'],
  travel: ['destination', 'startDate', 'endDate', 'purpose', 'costCenter', 'estimatedCost', 'currency'],
  receiving: ['purchaseOrderRef', 'warehouse', 'receivedOn'],
  quoteDiscount: ['quoteRevision', 'customerRef', 'item', 'quantity', 'listUnitPrice', 'requestedUnitPrice', 'currency', 'validUntil'],
}[type.value] || []), 'reason'])
const lineFields = computed(() => type.value === 'paymentRequest'
  ? ['lineId', 'invoiceRef', 'description', 'invoiceAmount', 'previouslySettledAmount', 'allocationAmount', 'deductionAmount', 'deductionReason']
  : ['lineId', 'orderLineRef', 'description', 'unit', 'ordered', 'received', 'accepted', 'rejected', 'exceptionReason'])
const receiving = computed(() => type.value === 'receiving' ? receivingSummary(props.business) : null)
const totals = computed(() => {
  if (type.value === 'paymentRequest') {
    const summary = paymentSummary(props.business)
    return ['declaredOutstanding', 'grossAllocation', 'deductionTotal', 'netTotal'].map(key => ({ key, value: summary?.[key] == null ? '—' : display(key, summary[key]) }))
  }
  if (type.value === 'travel') return [{ key: 'estimatedCost', value: display('estimatedCost', props.business.estimatedCost) }, { key: 'duration', value: `${travelDurationDays(props.business.startDate, props.business.endDate) ?? '—'} ${copy('days', '天')}` }]
  if (type.value === 'receiving') return ['lineCount', 'exceptionLineCount'].map(key => ({ key, value: receiving.value?.[key] ?? '—' }))
  if (type.value === 'quoteDiscount') {
    const count = quantity(props.business.quantity)
    return [['listTotal', 'listUnitPrice'], ['requestedTotal', 'requestedUnitPrice']].map(([key, field]) => {
      const cents = amountCents(props.business[field], props.business.currency)
      return { key, value: cents === null || count === null || count === 0 ? '—' : display(key, decimal(cents * BigInt(count), props.business.currency)) }
    })
  }
  return []
})
const footnote = computed(() => ({
  paymentRequest: copy('Calculated from the frozen invoice allocations. Declared balances are not checked against an ERP. Approval does not make a payment.', '金额依据冻结的发票分配明细计算，声明余额未经 ERP 核验。审批通过不会执行付款。'),
  travel: copy('The itinerary and budget are saved with this request. Approval does not book travel, reimburse expenses or issue a payment.', '此行程与预算随申请保存。审批通过不会预订出行、报销或付款。'),
  receiving: copy('Quantities are kept separate by unit. Approval records the inspection decision without posting inventory.', '数量按单位分别汇总。审批通过仅记录验收决定，不会增加库存。'),
  quoteDiscount: copy('Source quote facts and revision are frozen with this request. Routing uses the server-calculated discount; approval does not change the source quote or place an order.', '来源报价事实与修订随申请冻结。路由采用服务端计算的折扣；审批通过不会更改来源报价或下单。'),
}[type.value]))
</script>

<template>
  <section class="gf-business-snapshot" :aria-label="heading" data-testid="graph-business-snapshot" :data-business-type="business.type">
    <header><h3>{{ heading }}</h3><small v-if="business.documentVersion">{{ copy('Document version', '单据版本') }} {{ business.documentVersion }}</small></header>
    <dl class="gf-snapshot-fields"><div v-for="key in rootFields" :key="key" :class="{ 'gf-snapshot-wide': ['title', 'reason', 'item'].includes(key) }"><dt>{{ label(key) }}</dt><dd :data-testid="`graph-snapshot-${key}`">{{ display(key, business[key]) }}</dd></div></dl>
    <div v-if="totals.length" class="gf-snapshot-totals"><div v-for="row in totals" :key="row.key"><span>{{ label(row.key) }}</span><strong :data-testid="`graph-snapshot-${row.key}-total`">{{ row.value }}</strong></div></div>
    <div v-if="receiving" class="gf-snapshot-units" data-testid="graph-snapshot-quantities"><h4>{{ copy('Quantities by unit', '按单位汇总') }}</h4><div v-for="row in receiving.quantities" :key="row.unit"><strong>{{ enumLabel(row.unit) }}</strong><span v-for="key in ['received', 'accepted', 'rejected']" :key="key">{{ label(key) }} <b>{{ row[key] }}</b></span></div></div>
    <section v-if="Array.isArray(business.lines)" class="gf-snapshot-lines" :aria-label="type === 'paymentRequest' ? copy('Invoice allocations', '发票分配明细') : copy('Receiving lines', '收货明细')"><article v-for="(line, index) in business.lines" :key="line.lineId" :data-testid="`graph-snapshot-line-${index}`"><h4>{{ type === 'paymentRequest' ? copy('Invoice allocation', '发票分配明细') : copy('Receiving line', '收货明细') }} {{ index + 1 }}</h4><dl class="gf-snapshot-fields"><div v-for="key in lineFields" :key="key" :class="{ 'gf-snapshot-wide': ['description', 'deductionReason', 'exceptionReason'].includes(key) }"><dt>{{ label(key) }}</dt><dd :data-testid="`graph-snapshot-${index}-${key}`">{{ display(key, line[key]) }}</dd></div></dl></article></section>
    <p v-if="footnote" class="gf-muted">{{ footnote }}</p>
  </section>
</template>

<style scoped>
.gf-business-snapshot{min-width:0;margin:20px 0;padding:18px;border:1px solid #dce6e0;border-radius:10px;background:#fbfcfa}.gf-business-snapshot>header{display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap}.gf-business-snapshot h3{margin:0;font-size:14px}.gf-business-snapshot header small{font-size:10px;color:#6a7d6f}.gf-snapshot-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:15px 20px;margin:18px 0}.gf-snapshot-fields>div{min-width:0}.gf-snapshot-wide{grid-column:1/-1}.gf-snapshot-fields dt{font-size:11px;color:#63796a}.gf-snapshot-fields dd{font-size:13px;line-height:1.6;margin:4px 0 0;overflow-wrap:anywhere;white-space:pre-wrap}.gf-snapshot-totals{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:15px;border-top:1px solid #dce6e0;padding:16px 0}.gf-snapshot-totals>div{display:flex;flex-direction:column;gap:7px;min-width:0}.gf-snapshot-totals span{font-size:11px;color:#63796a}.gf-snapshot-totals strong{font-size:16px;color:#185a48;overflow-wrap:anywhere}.gf-snapshot-units{border-top:1px solid #dce6e0;padding:10px 0}.gf-snapshot-units h4{font-size:12px}.gf-snapshot-units>div{display:flex;gap:12px;flex-wrap:wrap;font-size:12px;padding:10px 0}.gf-snapshot-lines article{border-top:1px solid #dce6e0;padding-top:16px;margin-top:12px}.gf-snapshot-lines h4{font-size:12px;color:#466b53;margin:0}@media(max-width:600px){.gf-business-snapshot{padding:14px}.gf-snapshot-fields,.gf-snapshot-totals{grid-template-columns:1fr}.gf-snapshot-units>div>strong{width:100%}}
</style>
