<script setup name="ArcflowTravelGraph">
import { computed, onUnmounted, ref, watch } from 'vue'
import useUserStore from '@/store/modules/user'
import { nativeGraphTransport } from '@/api/arcflow/graph'
import GraphWorkspaceCore from './shared/graph/GraphWorkspaceCore.vue'
import './native-graph.css'
const user = useUserStore(), transport = nativeGraphTransport(() => user.token)
const actor = ref(null), error = ref(''), loading = ref(false), sessionKey = ref(0)
const locale = ref('zh'), mode = ref('requests')
const allowed = permission => user.permissions?.includes('*:*:*') || user.permissions?.includes(permission)
const canRead = computed(() => !!allowed('arcflow:request:read'))
const canSubmit = computed(() => !!allowed('arcflow:request:submit'))
const canDecide = computed(() => !!allowed('arcflow:request:decide'))
let alive = true
async function initialize() {
  transport.cancel(); const epoch = ++sessionKey.value
  actor.value = null; error.value = ''; loading.value = false
  if (!user.token || !canRead.value) return
  loading.value = true
  try {
    const me = await transport.me()
    if (!alive || epoch !== sessionKey.value) return
    if (!me || typeof me.id !== 'string' || !/^[1-9]\d*$/.test(me.id)) throw new Error('Invalid native actor')
    actor.value = me
  } catch (cause) { if (alive && epoch === sessionKey.value && cause?.name !== 'AbortError') error.value = cause?.message || 'Unable to load account' }
  finally { if (alive && epoch === sessionKey.value) loading.value = false }
}
function unauthorized() { transport.cancel(); sessionKey.value++; actor.value = null; error.value = locale.value === 'zh' ? '登录已失效，请重新登录。' : 'Session expired. Sign in again.' }
watch([() => user.token, canRead], initialize, { immediate: true, flush: 'sync' })
onUnmounted(() => { alive = false; transport.dispose() })
</script>
<template>
  <main class="arcflow-native-graph" data-testid="native-travel-graph" :data-actor-id="actor?.id">
    <header class="native-graph-controls"><div class="graph-mode-switch" :aria-label="locale==='zh'?'工作区':'Workspace'"><button type="button" :aria-pressed="mode==='requests'" @click="mode='requests'">{{ locale==='zh'?'出差申请':'Travel requests' }}</button><button type="button" :aria-pressed="mode==='designer'" @click="mode='designer'">{{ locale==='zh'?'流程设计':'Process designer' }}</button></div><label>{{ locale==='zh'?'语言':'Language' }} <select v-model="locale"><option value="zh">中文</option><option value="en">English</option></select></label></header>
    <p v-if="actor" class="native-current-actor" data-testid="native-current-actor">{{ locale==='zh'?'当前用户：':'Current user: ' }}{{ actor.displayName }} (ID {{ actor.id }})</p>
    <p v-if="!canRead" role="alert">{{ locale==='zh'?'没有查看审批的权限。':'Approval read permission required.' }}</p>
    <p v-if="error" role="alert">{{ error }} <button type="button" @click="initialize">{{ locale==='zh'?'重试':'Retry' }}</button></p>
    <p v-if="loading" role="status">{{ locale==='zh'?'正在加载…':'Loading…' }}</p>
    <GraphWorkspaceCore v-if="actor&&canRead" :key="sessionKey" :transport="transport" :actor="actor" scenario="travel" :locale="locale" :mode="mode" :allow-submit="canSubmit" :allow-decide="canDecide" @unauthorized="unauthorized" />
  </main>
</template>
