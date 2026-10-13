<script setup>
import {computed,onMounted,onUnmounted,ref,watch,nextTick} from 'vue'
import {api} from '../api.js'
import {newSubmissionKey} from '../submission-intent.js'
import {emptyBusiness,businessErrors,familyFor,validateQuoteSources,quoteSubmissionKey} from './business.js'
import {copyFor} from './copy.js'
import {clone,graphSequence} from './model.js'
import {graphCapabilities,graphDefinition,graphInstance,submissionBody,previewBody,verifySubmission,verifyDecision} from './api.js'
import GraphSequence from './GraphSequence.vue'
import GraphInspector from './GraphInspector.vue'
import GraphBusinessForm from './GraphBusinessForm.vue'
import GraphRuntime from './GraphRuntime.vue'
import './graph.css'
const props=defineProps({actor:Object,locale:{type:String,default:'en'},mode:{type:String,default:'designer'},active:{type:Boolean,default:true},scenario:{type:String,default:'payment'}})
const emit=defineEmits(['unauthorized'])
// A mounted workspace owns one immutable endpoint family. The hub keeps it
// mounted on switches, so late writes and uncertain intents cannot migrate.
const family=familyFor(props.scenario), GRAPH_BASE=family.base
// The generic codec preserves historical schema-5 payment IDs. Each mounted
// standalone endpoint additionally binds its one configured process identity.
const parseDefinition=value=>{if(value?.id!==family.id)throw new Error('Wrong graph process response');return graphDefinition(value,family.key)}
const parseInstance=value=>{parseDefinition(value?.definition);return graphInstance(value,family.key)}
const quotes=ref([]), facts=ref([]), canSubmit=ref(false)
const rootElement=ref(null), requestList=ref(null)
const t=computed(()=>({...copyFor(props.locale,family.key),schema:`${props.locale==='zh'?'图定义版本':'Graph schema'} ${family.schemaVersion}`})), busy=ref(false), loaded=ref(false), error=ref(''), notice=ref(''), canPublish=ref(false)
const people=ref([]), published=ref(null), draft=ref(null), revision=ref(0), baseline=ref(''), selection=ref(null), mobilePanel=ref('canvas'), wideCanvas=ref(false)
const history=ref([]), future=ref([]), diagnostics=ref([]), stale=ref(false), confirmReload=ref(false)
const requests=ref([]), selectedId=ref(null), form=ref(emptyBusiness(family.key,newSubmissionKey)), attempted=ref(false), showNew=ref(false), preview=ref(null), previewOpen=ref(false)
const submission=ref(null), decisions=ref({}), uncertain=ref({})
let alive=true, requestSelectionEpoch=0
onUnmounted(()=>{alive=false;window.removeEventListener('keydown',keyboard)})
const dirty=computed(()=>!!draft.value&&JSON.stringify(draft.value)!==baseline.value)
const definition=computed(()=>canPublish.value?draft.value:published.value)
const selected=computed(()=>requests.value.find(item=>item.id===selectedId.value))
const sequence=computed(()=>{try{return definition.value?graphSequence(definition.value):[]}catch{return []}})
const isDesigner=computed(()=>props.mode==='designer')
const body=(data)=>JSON.stringify(data)
function failure(cause,scope='local') { if(!alive||cause?.name==='AbortError')return; if(cause?.status===401){emit('unauthorized');return} error.value=cause?.status===409?(scope==='decision'?t.value.decisionConflict:scope==='submission'?t.value.submissionConflict:t.value.conflict):`${t.value.failed} ${cause?.message||''}`; if(cause?.status===409&&['save','publish'].includes(scope))stale.value=true }
async function run(action,scope='read') { if(busy.value)return; busy.value=true; error.value='';notice.value='';try{await action()}catch(cause){failure(cause,scope)}finally{if(alive)busy.value=false} }
function adopt(next) { draft.value=clone(parseDefinition(next.definition)); revision.value=next.revision; baseline.value=JSON.stringify(draft.value);history.value=[];future.value=[];stale.value=false;selection.value=null;diagnostics.value=[];preview.value=null }
function merge(items) { return items.map(item=>{parseInstance(item); const prior=requests.value.find(p=>p.id===item.id);return prior&&prior.commandRevision>item.commandRevision?prior:item}) }
async function initialize() { await run(async()=>{const [cap,users,process,items]=await Promise.all([api.request(`${GRAPH_BASE}/capabilities`),api.request(`${GRAPH_BASE}/users`),api.request(`${GRAPH_BASE}/process`),api.request(`${GRAPH_BASE}/requests`)]); if(!alive)return; if(!Array.isArray(users)||users.some(p=>typeof p.id!=='string'||typeof p.displayName!=='string'))throw new Error('Invalid actor directory'); graphCapabilities(cap,family.key); people.value=users; facts.value=cap.facts; canPublish.value=cap.permissions.canPublish;canSubmit.value=cap.permissions.canSubmit; published.value=parseDefinition(process);requests.value=merge(items);if(canPublish.value){const workspace=await api.request(`${GRAPH_BASE}/workspace`);if(!alive)return;adopt(workspace.draft);published.value=parseDefinition(workspace.definition)}if(family.key==='quoteDiscount')quotes.value=validateQuoteSources(await api.request(`${GRAPH_BASE}/quotes`));if(!alive)return;loaded.value=true}) }
onMounted(()=>{initialize();window.addEventListener('keydown',keyboard)})
function keyboard(event) {
  if(!props.active||!isDesigner.value||event.isComposing||busy.value)return
  if(event.key==='Escape'&&mobilePanel.value==='properties'){event.preventDefault();showCanvas();return}
  if(event.target?.closest?.('input,textarea,select,[contenteditable=true]'))return
  if((event.ctrlKey||event.metaKey)&&['z','y'].includes(event.key.toLowerCase())){event.preventDefault();event.key.toLowerCase()==='y'||event.shiftKey?redo():undo()}
}
// Reveal only intentional navigation, never routine list or decision refreshes.
async function revealSelectedRequest() {
  const id=selectedId.value, epoch=requestSelectionEpoch
  await nextTick()
  if(!alive||!props.active||isDesigner.value||id!==selectedId.value||epoch!==requestSelectionEpoch)return
  const list=requestList.value, item=list?.querySelector('.gf-request-item.chosen')
  if(!item||!list.clientHeight)return
  const bounds=item.getBoundingClientRect(), top=list.getBoundingClientRect().top+list.clientTop, bottom=top+list.clientHeight
  // An oversized row already spanning the viewport needs no movement.
  if(bounds.top<top&&bounds.bottom>bottom)return
  const delta=bounds.top<top?Math.max(bounds.top-top,bounds.bottom-bottom):bounds.bottom>bottom?Math.min(bounds.top-top,bounds.bottom-bottom):0
  if(delta)list.scrollTop+=delta
}
function setSelectedRequest(id){selectedId.value=id;revealSelectedRequest()}
function selectRequest(id){requestSelectionEpoch++;setSelectedRequest(id)}
watch(()=>props.active,active=>{if(active)revealSelectedRequest()},{flush:'post'})
watch(requestList,(list,previous,onCleanup)=>{
  if(!list)return
  revealSelectedRequest()
  let visible=list.clientHeight>0, narrow=window.innerWidth<=760
  // The runtime's expanded canvas hides this list through CSS. Only restoration
  // or entry into the scrolling mobile layout should reveal the selection again.
  if(typeof ResizeObserver==='undefined')return
  const observer=new ResizeObserver(()=>{
    if(!alive||requestList.value!==list)return
    const nextVisible=list.clientHeight>0, nextNarrow=window.innerWidth<=760
    if(nextVisible&&(!visible||nextNarrow&&!narrow))revealSelectedRequest()
    visible=nextVisible;narrow=nextNarrow
  })
  observer.observe(list)
  onCleanup(()=>observer.disconnect())
},{flush:'post'})
function reconcile(items) {
  if(submission.value){const found=items.find(item=>item.submissionKey===submission.value.key);if(found){verifySubmission(found,submission.value,props.actor.id);if(requestSelectionEpoch===submission.value.selectionEpoch)setSelectedRequest(found.id);submission.value=null;form.value=emptyBusiness(family.key,newSubmissionKey);attempted.value=false;showNew.value=false;notice.value='submitted'}}
  for(const [taskId,intent] of Object.entries(decisions.value)){const found=items.find(item=>item.id===intent.instanceId);const command=found?.commands.find(command=>command.id===intent.key);if(command&&command.taskId===intent.taskId&&command.actorId===props.actor.id&&command.decision===intent.decision&&command.comment===intent.comment){delete decisions.value[taskId];delete uncertain.value[taskId]}}
}
async function refresh() { if(!loaded.value)return initialize();await run(async()=>{const [process,items,users]=await Promise.all([api.request(`${GRAPH_BASE}/process`),api.request(`${GRAPH_BASE}/requests`),api.request(`${GRAPH_BASE}/users`)]);if(!alive)return;published.value=parseDefinition(process);requests.value=merge(items);people.value=users;reconcile(requests.value);if(selectedId.value&&!requests.value.some(r=>r.id===selectedId.value))selectedId.value=null}) }
function change(next) { if(busy.value||!canPublish.value)return;history.value=[...history.value.slice(-49),clone(draft.value)];future.value=[];draft.value=next;diagnostics.value=[];preview.value=null;if(selection.value&&!next.nodes.some(n=>n.id===selection.value.id)&&!next.edges.some(e=>e.id===selection.value.id))selection.value=null }
function undo() { if(!history.value.length||busy.value)return;future.value.push(clone(draft.value));draft.value=history.value.pop();diagnostics.value=[];preview.value=null }
function redo() { if(!future.value.length||busy.value)return;history.value.push(clone(draft.value));draft.value=future.value.pop();diagnostics.value=[];preview.value=null }
function focusSelection() {const kind=selection.value?.kind==='edge'?'edge':'node',id=selection.value?.id;const target=rootElement.value?.querySelector(`[data-testid="graph-${kind}-${id}"]`)||rootElement.value?.querySelector(`[data-testid="graph-branch-${id}"]`)||rootElement.value?.querySelector('[data-testid="graph-canvas"]');target?.focus()}
function showCanvas(){mobilePanel.value='canvas';nextTick(()=>{if(alive&&props.active)focusSelection()})}
function showProperties(){wideCanvas.value=false;mobilePanel.value='properties';nextTick(()=>{if(!alive||!props.active)return;const panel=rootElement.value?.querySelector('[data-testid="graph-properties"]');(panel?.querySelector('input:not(:disabled),select:not(:disabled),button:not(:disabled)')||panel)?.focus()})}
function select(value) { selection.value=value;showProperties() }
async function save() { await run(async()=>{const result=await api.request(`${GRAPH_BASE}/draft`,{method:'PUT',body:body({expectedRevision:revision.value,definition:draft.value})});if(!alive)return;parseDefinition(result.definition);revision.value=result.revision;draft.value=clone(result.definition);baseline.value=JSON.stringify(draft.value);stale.value=false;notice.value='saved'},'save') }
async function reload(force=false) {if(dirty.value&&!force){confirmReload.value=true;return}confirmReload.value=false;await run(async()=>{const result=await api.request(`${GRAPH_BASE}/workspace`);if(!alive)return;adopt(result.draft);published.value=parseDefinition(result.definition);notice.value='reloaded'})}
async function validate() { await run(async()=>{const result=await api.request(`${GRAPH_BASE}/validate`,{method:'POST',body:body(draft.value)});if(!alive)return;diagnostics.value=result.diagnostics;notice.value=result.diagnostics.length?'':'valid'}) }
async function publish() { if(dirty.value){error.value=t.value.needsSave;return}await run(async()=>{const checked=await api.request(`${GRAPH_BASE}/validate`,{method:'POST',body:body(draft.value)});if(!alive)return;diagnostics.value=checked.diagnostics;if(checked.diagnostics.some(d=>!String(d.code).startsWith('WARN')))return;const result=await api.request(`${GRAPH_BASE}/publish`,{method:'POST',body:body({expectedVersion:published.value.version,expectedDraftRevision:revision.value})});if(!alive)return;published.value=parseDefinition(result);const workspace=await api.request(`${GRAPH_BASE}/workspace`);if(!alive)return;adopt(workspace.draft);notice.value='publishedNotice'},'publish') }
function checkBusiness() {attempted.value=true;if(businessErrors(form.value).length){error.value=t.value.invalidPayment;return false}return true}
async function runPreview() { if(!checkBusiness())return;await run(async()=>{const result=await api.request(`${GRAPH_BASE}/preview`,{method:'POST',body:previewBody(draft.value,form.value)});if(!alive)return;preview.value=parseInstance(result)}) }
watch(form,()=>{preview.value=null},{deep:true})
async function submit() {
  if(!checkBusiness())return
  await run(async()=>{
    if(!submission.value){
      const business=clone(form.value), expectedVersion=published.value.version, actorId=props.actor.id, selectionEpoch=requestSelectionEpoch
      const key=family.key==='quoteDiscount'?await quoteSubmissionKey(business):newSubmissionKey()
      // Hashing precedes the API session guard: a closed workspace must not
      // resume this write under a subsequent login session.
      if(!alive||props.actor.id!==actorId)return
      submission.value={family:family.key,selectionEpoch,key,body:submissionBody(business,expectedVersion),business}
    }
    let result
    try {result=parseInstance(await api.request(`${GRAPH_BASE}/requests`,{method:'POST',headers:{'Idempotency-Key':submission.value.key},body:submission.value.body}))}
    catch(cause){
      const definitiveQuote=family.key==='quoteDiscount'&&[400,403,404,409].includes(cause?.status)
      if(definitiveQuote||cause?.status===400||cause?.status===403||cause?.status===409&&cause.message==='The published graph changed; review the current version before submitting')submission.value=null
      throw cause
    }
    if(!alive)return
    verifySubmission(result,submission.value,props.actor.id)
    requests.value=[result,...requests.value.filter(item=>item.id!==result.id)]
    if(requestSelectionEpoch===submission.value.selectionEpoch)setSelectedRequest(result.id)
    submission.value=null;form.value=emptyBusiness(family.key,newSubmissionKey);attempted.value=false;showNew.value=false;notice.value='submitted'
  },'submission')
}
async function decide(input) { const {task,decision,comment}=input;const instanceId=selected.value.id; const intent={key:newSubmissionKey(),taskId:task.id,instanceId,actorId:props.actor.id,decision,comment};decisions.value[task.id]=intent;await executeDecision(intent) }
async function executeDecision(intent) { await run(async()=>{uncertain.value[intent.taskId]=true;const result=parseInstance(await api.request(`${GRAPH_BASE}/requests/${encodeURIComponent(intent.instanceId)}/tasks/${encodeURIComponent(intent.taskId)}/decision`,{method:'POST',headers:{'Idempotency-Key':intent.key},body:body({decision:intent.decision,comment:intent.comment})}));if(!alive)return;verifyDecision(result,intent,requests.value.find(item=>item.id===intent.instanceId));requests.value=requests.value.map(item=>item.id===result.id?result:item);delete uncertain.value[intent.taskId];delete decisions.value[intent.taskId];notice.value='recorded'},'decision') }
const retry=task=>executeDecision(decisions.value[task.id])
async function refreshQuotes(){await run(async()=>{const result=validateQuoteSources(await api.request(`${GRAPH_BASE}/quotes`));if(alive)quotes.value=result})}
</script>
<template>
  <section ref="rootElement" class="gf-workspace" :lang="locale==='zh'?'zh-CN':'en'" data-testid="graph-workspace" :data-scenario="family.key" :data-definition-id="definition?.id" :data-definition-schema="definition?.schemaVersion" :data-definition-version="definition?.version">
    <header class="gf-workspace-heading"><div><span class="gf-eyebrow">ARCFLOW / {{ t.schema }}</span><h2>{{ t.title }}</h2><p>{{ t.subtitle }}</p></div><button class="secondary" data-testid="graph-refresh" :disabled="busy" @click="refresh">↻ {{ t.refresh }}</button></header>
    <p v-if="error" class="gf-alert" role="alert">{{ error }}</p><p v-if="notice" class="gf-notice" role="status">{{ t[notice] }}</p><p v-if="!loaded">{{ t.loading }} <button v-if="!busy" class="secondary" @click="initialize">{{ t.retry }}</button></p>
    <template v-if="loaded&&isDesigner"><div class="gf-designer-toolbar"><label class="gf-process-name">{{ t.name }}<input :value="definition.name" :disabled="busy||!canPublish" data-testid="graph-process-name" maxlength="120" @input="change({...draft,name:$event.target.value})"></label><div class="gf-version"><strong>{{ t.published }} v{{ published.version }}</strong><small>{{ dirty?t.unsaved:t.savedState }} · {{ t.draft }} r{{ revision }}</small></div><div v-if="canPublish" class="gf-toolbar-actions"><button class="secondary" data-testid="graph-undo" :disabled="busy||!history.length" @click="undo">↶ {{ t.undo }}</button><button class="secondary" data-testid="graph-redo" :disabled="busy||!future.length" @click="redo">↷ {{ t.redo }}</button><button class="secondary" data-testid="graph-reload" :disabled="busy" @click="reload(false)">{{ t.reload }}</button><button class="secondary" data-testid="graph-save" :disabled="busy||!dirty||stale" @click="save">{{ t.save }}</button><button class="secondary" data-testid="graph-validate" :disabled="busy" @click="validate">{{ t.validate }}</button><button class="secondary" data-testid="graph-preview-toggle" :disabled="busy" @click="previewOpen=!previewOpen">{{ t.preview }}</button><button class="primary" data-testid="graph-publish" :disabled="busy||dirty||stale" @click="publish">{{ t.publish }}</button></div></div>
      <div v-if="confirmReload" role="alertdialog" :aria-label="t.replaceQuestion" class="gf-callout"><p>{{ t.replaceQuestion }}</p><div class="gf-button-row"><button class="gf-danger" data-testid="graph-confirm-reload" @click="reload(true)">{{ t.discard }}</button><button class="secondary" @click="confirmReload=false">{{ t.cancel }}</button></div></div>
      <p v-if="!canPublish" class="gf-callout">{{ t.noPublish }}</p><div v-if="diagnostics.length" class="gf-diagnostics" role="alert"><h3>{{ t.diagnostics }}</h3><ul><li v-for="(diagnostic,i) in diagnostics" :key="i"><button class="gf-text-button" @click="diagnostic.nodeId?select({kind:'node',id:diagnostic.nodeId}):diagnostic.edgeId?select({kind:'edge',id:diagnostic.edgeId}):null">{{ diagnostic.code }} · {{ diagnostic.message }}</button></li></ul></div>
      <div class="gf-workbench-meta"><span>{{ definition.nodes.length }} / 32 {{ t.nodeCount }} · {{ definition.edges.length }} / 48 {{ t.edgeCount }}</span><span>{{ t.limits }}</span><button type="button" class="secondary gf-expand-control" data-testid="graph-expand-canvas" :aria-pressed="wideCanvas" @click="wideCanvas=!wideCanvas;mobilePanel='canvas'">{{ wideCanvas?t.restoreProperties:t.expandCanvas }}</button></div><div class="gf-mobile-switch"><button :aria-pressed="mobilePanel==='canvas'" @click="showCanvas">{{ t.mobileCanvas }}</button><button :aria-pressed="mobilePanel==='properties'" @click="showProperties">{{ t.mobileProperties }}</button></div>
      <div class="gf-workbench" :class="[`gf-panel-${mobilePanel}`,{'gf-expanded':wideCanvas}]"><div class="gf-canvas" tabindex="-1" data-testid="graph-canvas"><p class="gf-canvas-hint">{{ t.selectConnection }}</p><p class="gf-layout-hint">{{ t.responsiveGraph }}</p><GraphSequence :items="sequence" :locale="locale" :people="people" :selected="selection?.id" :editable="canPublish&&!busy" @select="select" /></div><GraphInspector :definition="definition" :selection="selection" :locale="locale" :people="people" :busy="busy" :editable="canPublish" :facts="facts" @select="select" @change="change" @error="failure" /></div>
      <section v-if="previewOpen&&canPublish" class="gf-preview-panel"><header><h2>{{ t.preview }}</h2><p>{{ t.previewHelp }}</p></header><GraphBusinessForm v-model="form" :locale="locale" :busy="busy || !!submission" :attempted="attempted" :quotes="quotes" :actor="actor" @refresh-quotes="refreshQuotes" /><button class="primary" :disabled="busy" data-testid="graph-preview" @click="runPreview">{{ t.preview }}</button><GraphRuntime v-if="preview" :instance="preview" :locale="locale" :people="people" :actor="actor" preview /></section>
    </template>
    <template v-if="loaded&&!isDesigner"><div class="gf-request-toolbar"><p>{{ t.onlySelected }}</p><button class="primary" data-testid="graph-new-request" :disabled="busy||!canSubmit" @click="showNew=!showNew">＋ {{ t.newRequest }}</button></div><section v-if="showNew" class="gf-new-request"><h2>{{ t.newRequest }}</h2><p>{{ t.published }} v{{ published.version }}</p><p v-if="submission" class="gf-callout">{{ t.submissionUncertain }}</p><GraphBusinessForm v-model="form" :locale="locale" :busy="busy || !!submission" :attempted="attempted" :quotes="quotes" :actor="actor" @refresh-quotes="refreshQuotes" /><button class="primary" data-testid="graph-submit" :disabled="busy||!canSubmit" @click="submit">{{ submission?t.retrySubmit:t.submit }}</button></section><div class="gf-request-layout"><aside ref="requestList" class="gf-request-list"><h3>{{ t.visibleRequests }} <span>{{ requests.length }}</span></h3><p v-if="!requests.length" class="gf-muted">{{ t.noRequests }}</p><button v-for="item in requests" :key="item.id" type="button" class="gf-request-item" :class="{chosen:selectedId===item.id}" :aria-pressed="selectedId===item.id" :data-testid="`graph-request-${item.id}`" @click="selectRequest(item.id)"><strong>{{ item.business.title }}</strong><small>{{ item.business.businessId }} · v{{ item.definition.version }}</small><span>{{ t[item.status.toLowerCase()] }} · {{ item.tasks.filter(task=>task.status==='ACTIVE').length }} {{ t.activeTasks }}</span></button></aside><GraphRuntime v-if="selected" :key="selected.id" :instance="selected" :locale="locale" :people="people" :actor="actor" :busy="busy" :uncertain="uncertain" @decide="decide" @retry="retry" /><p v-else class="gf-empty">{{ t.inspect }}</p></div></template>
  </section>
</template>
