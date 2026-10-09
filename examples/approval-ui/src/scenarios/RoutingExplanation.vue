<script setup>
import { computed } from 'vue'
import { routingPredicateLabel, routingActualValueLabel } from '../routing-copy.js'
const props = defineProps({ node: Object, routing: Object, locale: String })
const zh = computed(() => props.locale === 'zh')
const evaluation = computed(() => props.routing?.evaluations.find(item => item.stepId === props.node.id))
</script>
<template>
  <section v-if="node.runIf && evaluation" class="routing-explanation" :data-routing-evaluation="node.id">
    <h4>{{ zh ? '提交时的条件判定' : 'Condition evaluation at submission' }}</h4>
    <p>{{ node.runIf.mode === 'ALL' ? (zh ? '全部条件满足才纳入（ALL）' : 'Include only when all conditions match (ALL)') : (zh ? '任一条件满足即纳入（ANY）' : 'Include when any condition matches (ANY)') }} · {{ evaluation.result ? (zh ? '已纳入' : 'Included') : (zh ? '条件未满足，未纳入' : 'Condition not met · not included') }}</p>
    <ul><li v-for="(atom, index) in node.runIf.predicates" :key="index">{{ routingPredicateLabel(atom, locale) }}<span class="routing-fact">{{ zh ? '实际值' : 'Actual value' }}: {{ routingActualValueLabel(evaluation.predicates[index].field, evaluation.predicates[index].actualValue, locale) }} · {{ evaluation.predicates[index].result ? (zh ? '满足' : 'Matched') : (zh ? '未满足' : 'Not matched') }}</span></li></ul>
  </section>
</template>
