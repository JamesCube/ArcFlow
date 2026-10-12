<script setup>
import { computed } from 'vue'
import { copyFor } from './copy.js'
import { emptyPaymentLine, paymentErrors, paymentErrorText, paymentTotal } from '../scenarios/payment-document.js'
import { newSubmissionKey } from '../submission-intent.js'
const props = defineProps({modelValue:Object, locale:String, busy:Boolean, attempted:Boolean})
const emit = defineEmits(['update:modelValue'])
const t = computed(()=>copyFor(props.locale)), errors = computed(()=>paymentErrors(props.modelValue)), total = computed(()=>paymentTotal(props.modelValue))
const roots = ['businessId','supplierRef','title','requestedPaymentOn','reason']
const lines = ['invoiceRef','description','invoiceAmount','previouslySettledAmount','allocationAmount','deductionAmount','deductionReason']
const amounts = ['invoiceAmount','previouslySettledAmount','allocationAmount','deductionAmount']
const fieldCopy = key => key === 'title' ? t.value.titleField : t.value[key]
const invalid = path => props.attempted && errors.value.includes(path)
const update = (key,value) => emit('update:modelValue',{...props.modelValue,[key]:value})
const line = (index,key,value) => update('lines',props.modelValue.lines.map((item,i)=>i===index ? {...item,[key]:value} : item))
const add = () => update('lines',[...props.modelValue.lines,emptyPaymentLine(newSubmissionKey)])
</script>
<template>
  <div class="gf-payment" data-testid="graph-payment-form">
    <div class="gf-form-grid"><label v-for="key in roots" :key="key" :class="{'gf-wide':key==='reason'}">{{ fieldCopy(key) }}<textarea v-if="key==='reason'" :value="modelValue[key]" :disabled="busy" :aria-invalid="invalid(key)" maxlength="2000" rows="2" :data-testid="`graph-payment-${key}`" @input="update(key,$event.target.value)" /><input v-else :type="key==='requestedPaymentOn'?'date':'text'" :value="modelValue[key]" :disabled="busy" :aria-invalid="invalid(key)" :maxlength="key==='title'?120:128" :data-testid="`graph-payment-${key}`" @input="update(key,$event.target.value)"><span v-if="invalid(key)" class="gf-field-error">{{ paymentErrorText(key,locale) }}</span></label><label>{{ t.currency }}<select :value="modelValue.currency" :disabled="busy" data-testid="graph-payment-currency" @change="update('currency',$event.target.value)"><option v-for="currency in ['CNY','USD','EUR','GBP','JPY']" :key="currency">{{ currency }}</option></select></label></div>
    <fieldset v-for="(item,index) in modelValue.lines" :key="item.lineId" class="gf-invoice"><legend>{{ t.invoices }} {{ index+1 }}</legend><div class="gf-form-grid"><label v-for="key in lines" :key="key">{{ fieldCopy(key) }}<input :value="item[key]" :disabled="busy" :inputmode="amounts.includes(key)?'decimal':undefined" :maxlength="amounts.includes(key)?32:key==='deductionReason'?1000:240" :aria-invalid="invalid(`lines.${index}.${key}`)" :data-testid="`graph-payment-${index}-${key}`" @input="line(index,key,$event.target.value)"><span v-if="invalid(`lines.${index}.${key}`)" class="gf-field-error">{{ paymentErrorText(key,locale) }}</span></label></div><button type="button" class="gf-text-button" :disabled="busy || modelValue.lines.length <= 1" @click="update('lines',modelValue.lines.filter((_,i)=>i!==index))">{{ t.removeInvoice }}</button></fieldset>
    <button type="button" class="secondary" data-testid="graph-add-invoice" :disabled="busy || modelValue.lines.length >= 20" @click="add">＋ {{ t.addInvoice }}</button><div class="gf-total"><span>{{ t.calculated }}</span><strong data-testid="graph-net-total">{{ modelValue.currency }} {{ total ?? '—' }}</strong></div><p class="gf-muted">{{ t.paymentHelp }}</p><p v-if="attempted && errors.includes('netTotal')" class="gf-field-error">{{ paymentErrorText('netTotal',locale) }}</p>
  </div>
</template>
