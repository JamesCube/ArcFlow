<script setup>
import { ref } from 'vue'
import GraphWorkspace from './GraphWorkspace.vue'
import { GRAPH_FAMILIES } from './business.js'
const props = defineProps({ actor: Object, locale: String, mode: String, active: Boolean })
const emit = defineEmits(['unauthorized'])
const selected = ref('payment'), visited = ref(['payment'])
function choose(value) {
  if (!GRAPH_FAMILIES.some(family => family.key === value)) return
  if (!visited.value.includes(value)) visited.value.push(value)
  selected.value = value
}
</script>
<template>
  <section class="gf-hub" data-testid="graph-hub">
    <div class="gf-family-selector"><label>{{ locale === 'zh' ? '业务场景' : 'Business scenario' }}<select :value="selected" data-testid="graph-scenario" @change="choose($event.target.value)"><option v-for="family in GRAPH_FAMILIES" :key="family.key" :value="family.key">{{ family[locale === 'zh' ? 'zh' : 'en'] }}</option></select></label><p>{{ locale === 'zh' ? '切换场景会保留各自未保存的草稿、表单与待确认操作。' : 'Switching preserves each scenario’s unsaved draft, form, and unconfirmed operations.' }}</p></div>
    <GraphWorkspace v-for="scenario in visited" v-show="selected === scenario" :key="`${actor.id}:${scenario}`" :scenario="scenario" :actor="actor" :locale="locale" :mode="mode" :active="active && selected === scenario" @unauthorized="emit('unauthorized')" />
  </section>
</template>
