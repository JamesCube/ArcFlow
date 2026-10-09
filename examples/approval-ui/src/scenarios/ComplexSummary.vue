<script setup>
import { computed } from 'vue'
import { formatExpenseMoney } from './expense-document.js'
const props = defineProps({ business: Object, handler: Object, locale: String, summary: Object })
const zh = computed(() => props.locale === 'zh'), payment = computed(() => props.handler.documentType === 'paymentRequest')
const values = computed(() => props.summary || props.handler.calculation(props.business))
const money = value => formatExpenseMoney(value, props.business.currency)
const rows = computed(() => payment.value ? [
  ['declaredOutstanding', zh.value ? '声明未结' : 'Declared outstanding'], ['grossAllocation', zh.value ? '本次分配' : 'Gross allocation'],
  ['deductionTotal', zh.value ? '本次扣减' : 'Deductions'], ['netTotal', zh.value ? '净申请额' : 'Net requested'],
] : [ ['contractAmount', zh.value ? '合同金额' : 'Contract amount'], ['milestoneTotal', zh.value ? '里程碑合计' : 'Milestone total'], ['balance', zh.value ? '待分配差额' : 'Unallocated balance'] ])
</script>
<template><section class="xf-summary" :class="payment ? 'pf-summary' : 'cf-summary'" :data-testid="`${handler.prefix}-summary`" aria-live="polite"><div v-for="[key, label] in rows" :key="key" :class="{ 'xf-summary-emphasis': key === (payment ? 'netTotal' : 'balance') }"><span>{{ label }}</span><strong :data-testid="`${handler.prefix}-${key}`">{{ values?.[key] == null ? '—' : values[key].startsWith('-') ? `−${money(values[key].slice(1))}` : money(values[key]) }}</strong></div><p>{{ payment ? (zh ? '由本申请明细精确计算。声明金额未经真实发票或 ERP 余额验证。' : 'Calculated exactly from this request. Declared amounts are not verified against invoices or ERP balances.') : (zh ? '差额必须为零。这是本单校验，不验证 CRM 来源或合同修订的唯一性。' : 'The balance must be zero. This checks the document only, not its CRM source or revision uniqueness.') }}</p></section></template>
