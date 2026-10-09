<script setup>
import { computed } from 'vue'
import { approvalNodes, participants } from '../process.js'
import { evaluateRouting } from '../routing.js'
import { routingErrorText } from '../routing-copy.js'
const props = defineProps({ definition: Object, business: Object, people: Array, locale: String })
const zh = computed(() => props.locale === 'zh')
const nodes = computed(() => approvalNodes(props.definition))
const preview = computed(() => { try { return { routing: evaluateRouting(props.definition, props.business), error: null } } catch (error) { return { routing: null, error } } })
const name = id => { const person = props.people?.find(person => person.id === id); return person?.displayName || person?.name || id }
const excluded = node => preview.value.routing && !preview.value.routing.stepIds.includes(node.id)
</script>
<template>
  <li v-for="(node, index) in nodes" :key="node.id" :class="{ 'conditional-skipped': excluded(node) }" :data-route-step="node.id"><span>{{ excluded(node) ? '–' : index + 1 }}</span><div><strong>{{ node.name }}</strong><small>{{ participants(node).map(name).join(' + ') }}<template v-if="node.completionMode"> · {{ node.completionMode }}</template></small><small v-if="node.runIf" class="sf-route-note">{{ preview.error ? (zh ? '条件路径待计算' : 'Condition preview pending') : excluded(node) ? (zh ? '条件未满足，未纳入' : 'Condition not met · not included') : (zh ? '条件满足，纳入路径' : 'Condition met · included') }}</small></div></li>
  <li v-if="definition?.schemaVersion === 4" class="sf-route-note" data-testid="route-preview"><p v-if="preview.error" :class="{ 'field-error': preview.error.code === 'CURRENCY_MISMATCH' }">{{ routingErrorText(preview.error, locale) }}</p><p v-else>{{ zh ? `预览：纳入 ${preview.routing.stepIds.length} 个审批节点。提交时冻结，服务端结果为准。` : `Preview: ${preview.routing.stepIds.length} approval stages included. Frozen on submission; server results are authoritative.` }}</p></li>
</template>
