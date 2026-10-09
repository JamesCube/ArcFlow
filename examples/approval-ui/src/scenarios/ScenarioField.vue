<script setup>
defineProps({ field: Object, modelValue: [String, Number], locale: String, id: String, invalid: Boolean, error: String, disabled: Boolean, currency: String })
const emit = defineEmits(['update:modelValue'])
const update = event => emit('update:modelValue', event.target.value)
</script>
<template>
  <div class="sf-field" :class="{ 'sf-wide': field.kind === 'textarea' }">
    <label :for="id">{{ field.label[locale] }}<span v-if="field.kind === 'money'" class="sf-field-unit">{{ currency }}</span></label>
    <textarea v-if="field.kind === 'textarea'" :id="id" :value="modelValue" :disabled="disabled" :maxlength="field.maxLength || undefined" rows="3" :aria-required="field.required" :aria-invalid="invalid" :aria-describedby="invalid ? `${id}-error` : undefined" @input="update" />
    <select v-else-if="field.kind === 'select'" :id="id" :value="modelValue" :disabled="disabled" :aria-required="field.required" :aria-invalid="invalid" :aria-describedby="invalid ? `${id}-error` : undefined" @change="update"><option v-for="option in field.options" :key="option.value" :value="option.value">{{ option.label[locale] }}</option></select>
    <input v-else :id="id" :value="modelValue" :type="field.kind === 'date' ? 'date' : 'text'" :inputmode="field.kind === 'money' ? 'decimal' : field.kind === 'quantity' ? 'numeric' : undefined" :disabled="disabled" :maxlength="field.maxLength || (field.kind === 'money' ? 32 : undefined)" :placeholder="field.kind === 'money' ? (currency === 'JPY' ? '0' : '0.00') : undefined" :aria-required="field.required" :aria-invalid="invalid" :aria-describedby="invalid ? `${id}-error` : undefined" autocomplete="off" @input="update">
    <p v-if="invalid" :id="`${id}-error`" class="field-error">{{ error }}</p>
  </div>
</template>
