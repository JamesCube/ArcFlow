<script setup>
import { computed } from 'vue'
import { copyFor } from './copy.js'
import { factLabel, factType } from './business.js'
import { runtimeNodeStatus, runtimeEdgeStatus } from './model.js'
const props = defineProps({ items: {type:Array,default:()=>[]}, locale: String, people: Array, selected: String, editable: Boolean, instance: Object })
const emit = defineEmits(['select'])
const t = computed(() => copyFor(props.locale))
const name = id => props.people?.find(p => p.id === id)?.displayName || id
const state = node => props.instance ? runtimeNodeStatus(props.instance,node.id) : ''
const edgeState = edge => props.instance ? runtimeEdgeStatus(props.instance,edge.id) : ''
const label = status => t.value[status === 'waiting' ? 'waitingState' : status] || status
const marker = type => ({start:'○',end:'●',approval:'✓',parallelApproval:'✓✓',exclusiveGateway:'◇',exclusiveMerge:'◇',parallelFork:'⑂',parallelJoin:'⊕'})[type]
const describePredicate = p => `${factLabel(p.field,props.locale)} ${p.operator} ${factType(p.field)==='boolean'?(props.locale==='zh'?(p.expected?'是':'否'):(p.expected?'Yes':'No')):`${p.currency || ''} ${p.threshold}${factType(p.field)==='percent'?'%':''}`}`
const select = (kind,id) => emit('select',{kind,id})
</script>
<template>
  <ol class="gf-sequence">
    <li v-for="item in items" :key="item.node.id" class="gf-unit" :data-node-id="item.node.id">
      <button type="button" class="gf-node" :class="[item.node.type, state(item.node), {chosen:selected === item.node.id}]" :aria-pressed="selected === item.node.id" :data-testid="`graph-node-${item.node.id}`" @click="select('node',item.node.id)">
        <span class="gf-node-symbol" aria-hidden="true">{{ marker(item.node.type) }}</span><span class="gf-node-copy"><small>{{ t[item.node.type] }}</small><strong>{{ item.node.name }}</strong><span v-if="item.node.assigneeIds?.length" class="gf-assignees">{{ item.node.assigneeIds.map(name).join(' · ') }}<b v-if="item.node.type === 'parallelApproval'"> · {{ item.node.completionMode }}</b></span><em v-if="state(item.node)" class="gf-state">{{ label(state(item.node)) }}</em></span>
      </button>
      <template v-if="item.kind === 'region'">
        <div class="gf-region" :class="item.node.type" :aria-label="`${item.node.name}: ${t.branch}`" :style="{'--gf-branch-count':item.branches.length}" :data-region-id="item.node.id" :data-pair-id="item.pair.id" :data-branch-count="item.branches.length">
          <header class="gf-region-heading"><strong>{{ item.node.type==='exclusiveGateway'?t.firstMatch:t.parallelPaths }}</strong><p>{{ item.node.type==='exclusiveGateway'?t.conditionHelp:t.pathHelp }}</p></header>
          <section v-for="(branch,index) in item.branches" :key="branch.edge.id" class="gf-lane" :class="edgeState(branch.edge)" :data-branch-id="branch.edge.id">
            <button :data-testid="`graph-branch-${branch.edge.id}`" class="gf-branch-label" :class="{chosen:selected === branch.edge.id}" :aria-pressed="selected === branch.edge.id" @click="select('edge',branch.edge.id)"><span class="gf-branch-order">{{ t.branch }} {{ String(index+1).padStart(2,'0') }}</span><strong>{{ branch.edge.label || `${t.branch} ${index+1}` }}</strong><small v-if="branch.edge.defaultBranch">{{ t.default }}</small><small v-else-if="branch.edge.condition">{{ branch.edge.condition.predicates.map(describePredicate).join(branch.edge.condition.mode === 'ALL' ? ' ∧ ' : ' ∨ ') }}</small><em v-if="edgeState(branch.edge)">{{ label(edgeState(branch.edge)) }}</em></button>
            <div class="gf-connector"><button v-if="editable" :data-testid="`graph-edge-${branch.edge.id}`" :aria-label="`${t.insert}: ${branch.edge.label || branch.edge.id}`" @click="select('edge',branch.edge.id)">＋</button><span v-else aria-hidden="true">↓</span></div>
            <GraphSequence :items="branch.items" :locale="locale" :people="people" :selected="selected" :editable="editable" :instance="instance" @select="emit('select',$event)" />
            <p v-if="!branch.items.length" class="gf-muted">{{ t.emptyBranch }}</p>
          </section>
        </div>
        <button v-if="item.pair" class="gf-node gf-pair" :class="[state(item.pair),{chosen:selected === item.pair.id}]" :data-testid="`graph-node-${item.pair.id}`" :aria-pressed="selected === item.pair.id" @click="select('node',item.pair.id)"><span class="gf-node-symbol" aria-hidden="true">{{ marker(item.pair.type) }}</span><span class="gf-node-copy"><small>{{ t[item.pair.type] }}</small><strong>{{ item.pair.name }}</strong><em v-if="state(item.pair)">{{ label(state(item.pair)) }}</em></span></button>
      </template>
      <div v-if="item.afterEdge" class="gf-connector" :class="edgeState(item.afterEdge)"><button v-if="editable" :class="{chosen:selected === item.afterEdge.id}" :data-testid="`graph-edge-${item.afterEdge.id}`" :aria-label="`${t.insert}: ${item.node.name}`" @click="select('edge',item.afterEdge.id)">＋</button><span v-else aria-hidden="true">↓</span></div>
    </li>
  </ol>
</template>
