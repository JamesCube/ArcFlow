<script setup>
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { MAX_APPROVALS, MAX_NAME_LENGTH, approvalNodes, isApproval, approvalMode, participants, setApprovalMode, cloneDefinition, validateDefinition } from './process'
import { validationText } from './locale'
import { createDraftHistory, insertApproval, moveApproval, removeApproval, updateApproval } from './designer-model'

const props = defineProps({ modelValue: Object, published: Object, people: { type: Array, default: () => [] }, editable: Boolean, busy: Boolean, publishing: Boolean, dirty: Boolean, stale: Boolean, initialLocale: { type: String, default: 'zh' }, showLanguage: { type: Boolean, default: true } })
const emit = defineEmits(['update:modelValue', 'update:locale', 'publish', 'reset'])
const locale = ref(props.initialLocale), root = ref(null), inspector = ref(null), nameInput = ref(null)
const mobileEditing = ref(false)
watch(() => props.initialLocale, value => { if (['zh', 'en'].includes(value)) locale.value = value })
watch(locale, value => emit('update:locale', value))
const selectedId = ref(approvalNodes(props.modelValue)[0]?.id || null)
const history = reactive(createDraftHistory(50)), announcement = ref('')
let expectedDefinition = JSON.stringify(props.modelValue), nextId = 0
const text = {
  en: { title:'Approval designer', subtitle:'A clear path, with every review in its place.', language:'English', published:'Published', draft:'Draft based on', clean:'Up to date', dirty:'Unpublished changes', readOnly:'Read-only template', editorOnly:'Only Alice can edit and publish the process.', local:'Draft stays in this tab’s memory. Browser reload or sign out discards unpublished changes.', snapshots:'Existing requests keep their saved sequence.', stale:'A newer version may have been published. Use the workspace Refresh button (not browser reload), then reset to the published template and reapply your changes. Your draft is preserved until reset or sign out.', processName:'Process name', undo:'Undo', redo:'Redo', add:'Add approval step', reset:'Reset to published', publish:'Publish template', publishing:'Publishing…', sequence:'Approval sequence', count:'approval stages', start:'START', end:'END', submit:'Request submitted', complete:'Process complete', select:'Select a step to configure its review.', inspector:'Step settings', name:'Step name', mode:'Review mode', single:'Single approver', all:'Everyone approves (ALL)', any:'Any one approves (ANY)', assignee:'Assigned approver', people:'Participants', selected:'selected', minimum:'Choose at least two distinct participants.', demo:'Demo directory: Bob and Carol. Repeated participants in different steps make separate decisions.', singleRule:'One assigned person decides this step. A rejection ends the request.', allRule:'ALL: every participant must approve. Any rejection ends the request.', anyRule:'ANY: one approval completes this group. Rejection ends the request only after every participant rejects.', up:'Move up', down:'Move down', remove:'Remove step', required:'Keep at least one approval step.', limit:'Maximum 8 stages reached. Remove a stage before adding another.', inserted:'New approval added. Configure its name and reviewer.', removed:'Step removed. Undo is available.', reordered:'Step order updated.', undone:'Last draft change undone.', redone:'Draft change restored.', resetDone:'Draft reset. Undo can restore your previous draft.', keyboard:'Tab to a step, Enter to configure. Ctrl/Cmd+Z undoes canvas changes; text fields keep their native undo.', issues:'Check before publishing', ready:'Ready to publish', missing:'Needs configuration', fixed:'Fixed', preview:'Inspect draft JSON', version:'version', stage:'Stage', group:'group', rule:'Completion rule', modeHint:'Changing to a group preselects both demo reviewers. Review the participants before publishing.' },
  zh: { title:'审批流程设计器', subtitle:'把每一次审批，安排得清楚而有序。', language:'中文', published:'已发布', draft:'草稿基于', clean:'与已发布版本一致', dirty:'有未发布修改', readOnly:'只读流程', editorOnly:'仅 Alice 可以编辑与发布流程。', local:'草稿仅保存在当前标签页内存中；刷新网页或退出登录会丢失未发布修改。', snapshots:'已发起的申请保留原流程快照。', stale:'检测到可能有更新版本。请点击页面右上角“更新数据”（不要刷新浏览器），然后重置为已发布流程并重新应用修改。点击“更新数据”会保留当前草稿。', processName:'流程名称', undo:'撤销', redo:'重做', add:'添加审批节点', reset:'重置为已发布', publish:'发布流程', publishing:'正在发布…', sequence:'审批顺序', count:'个审批节点', start:'发起', end:'结束', submit:'提交申请', complete:'流程完成', select:'选择节点，配置审批规则。', inspector:'节点设置', name:'节点名称', mode:'审批方式', single:'单人审批', all:'全员同意（ALL）', any:'任一同意（ANY）', assignee:'审批人', people:'参与人', selected:'已选', minimum:'请选择至少两位不同的参与人。', demo:'示例用户：Bob 和 Carol。同一人在不同节点需要分别作出决定。', singleRule:'由指定审批人决定；拒绝后流程驳回。', allRule:'全员同意（ALL）：全部同意才通过，任一拒绝即驳回。', anyRule:'任一同意（ANY）：任一同意即通过，全部拒绝才驳回。', up:'上移', down:'下移', remove:'删除节点', required:'流程至少保留一个审批节点。', limit:'已达到 8 个节点上限，请先删除一个节点。', inserted:'已插入新节点，请配置名称和审批人。', removed:'节点已删除，可使用撤销恢复。', reordered:'节点顺序已更新。', undone:'已撤销上一次草稿修改。', redone:'已恢复草稿修改。', resetDone:'已重置草稿，可撤销以恢复之前的修改。', keyboard:'Tab 选择节点，Enter 打开配置。Ctrl/Cmd+Z 撤销画布修改；输入框保留原生撤销。', issues:'发布前请检查', ready:'可以发布', missing:'待配置', fixed:'固定节点', preview:'查看草稿 JSON', version:'版本', stage:'节点', group:'人协同', rule:'通过规则', modeHint:'切换为多人审批会预选两位示例用户，请在发布前确认参与人。' },
}
const t = computed(() => text[locale.value] || text.en)
const stages = computed(() => approvalNodes(props.modelValue))
const selected = computed(() => stages.value.find(node => node.id === selectedId.value))
const selectedIndex = computed(() => stages.value.findIndex(node => node.id === selectedId.value) + 1)
const approvers = computed(() => props.people.filter(person => ['bob', 'carol'].includes(person.id)))
const errors = computed(() => validateDefinition(props.modelValue))
const canAdd = computed(() => props.editable && !props.busy && stages.value.length < MAX_APPROVALS)
const ariaLabel = (kind, index, value = '') => {
  const en = { name:`Step ${index} name`, mode:`Step ${index} review mode`, assignee:`Step ${index} approver`, members:`Step ${index} participants`, member:`Step ${index} participant ${value}`, up:`Move step ${index} up`, down:`Move step ${index} down`, remove:`Remove step ${index}`, configure:`Configure step ${index}: ${value}`, insert:`Insert approval before ${value === 'end' ? 'end' : 'step ' + index}` }
  const zh = { name:`节点 ${index} 名称`, mode:`节点 ${index} 审批方式`, assignee:`节点 ${index} 审批人`, members:`节点 ${index} 参与人`, member:`节点 ${index} 参与人 ${value}`, up:`上移节点 ${index}`, down:`下移节点 ${index}`, remove:`删除节点 ${index}`, configure:`配置节点 ${index}：${value}`, insert:value === 'end' ? '在结束前插入审批节点' : `在节点 ${index} 前插入审批节点` }
  return (locale.value === 'zh' ? zh : en)[kind]
}
const personName = id => { const p = props.people.find(person => person.id === id); return p?.displayName || p?.name || id }
const issueText = message => {
  if (locale.value !== 'zh') return message
  const stage = /approval step (\d+)/i.exec(message)?.[1]
  if (message === 'Give the process a name.') return '请填写流程名称。'
  if (stage && message.startsWith('Give')) return `请填写节点 ${stage} 的名称。`
  if (stage && /distinct participants/.test(message)) return `节点 ${stage} 请选择至少两位不同参与人（Bob 和 Carol）。`
  if (stage && /Choose Bob or Carol/.test(message)) return `节点 ${stage} 请选择 Bob 或 Carol。`
  if (/control characters/.test(message)) return stage ? `节点 ${stage} 名称不能包含控制字符。` : '流程名称不能包含控制字符。'
  if (/120 characters/.test(message)) return stage ? `节点 ${stage} 名称不能超过 120 个字符。` : '流程名称不能超过 120 个字符。'
  return validationText(message, locale.value)
}
const modeName = node => ({ SINGLE:t.value.single, ALL:t.value.all, ANY:t.value.any })[approvalMode(node)]
const rule = node => ({ SINGLE:t.value.singleRule, ALL:t.value.allRule, ANY:t.value.anyRule })[approvalMode(node)]
const nodeErrors = node => {
  const index = props.modelValue.nodes.findIndex(n => n.id === node.id)
  return errors.value.filter(message => message.toLowerCase().includes(`approval step ${index}`))
}
const nameError = computed(() => selected.value && nodeErrors(selected.value).find(message => /name/i.test(message)))
const memberError = computed(() => selected.value && nodeErrors(selected.value).find(message => /participants|Choose Bob|assignee/i.test(message)))
watch(() => JSON.stringify(props.modelValue), value => {
  if (value !== expectedDefinition) { history.clear(); announcement.value = '' }
  expectedDefinition = value
  if (!stages.value.some(node => node.id === selectedId.value)) selectedId.value = stages.value[0]?.id || null
})
function commit(next, selection = selectedId.value, mergeKey = null) {
  if (!props.editable || props.busy || !next) return
  history.record(props.modelValue, next, selectedId.value, selection, mergeKey)
  expectedDefinition = JSON.stringify(next); selectedId.value = selection
  emit('update:modelValue', next)
}
async function choose(id, focus = false) {
  history.endMerge(); selectedId.value = id
  if (window.matchMedia?.('(max-width: 930px)').matches) mobileEditing.value = true
  await nextTick()
  if (focus) (nameInput.value || inspector.value)?.focus()
  else if (window.matchMedia?.('(max-width: 930px)').matches) inspector.value?.scrollIntoView?.({ block: 'start', behavior: 'smooth' })
}
async function insert(after) {
  if (!canAdd.value) return
  let id; do { id = `approval-${++nextId}` } while (props.modelValue.nodes.some(node => node.id === id))
  const next = insertApproval(props.modelValue, after, id)
  commit(updateApproval(next, id, { name: `${locale.value === 'zh' ? '审批节点' : 'Approval'} ${stages.value.length + 1}` }), id)
  announcement.value = t.value.inserted
  mobileEditing.value = true
  await nextTick(); nameInput.value?.focus()
}
function editName(value) { commit(updateApproval(props.modelValue, selectedId.value, { name: value }), selectedId.value, `name:${selectedId.value}`) }
function editProcessName(value) { commit({ ...cloneDefinition(props.modelValue), name: value }, selectedId.value, 'process-name') }
function mode(value) {
  if (!selected.value) return
  commit(setApprovalMode(props.modelValue, selectedId.value, value, approvers.value.map(person => person.id)))
  announcement.value = value === 'SINGLE' ? t.value.singleRule : t.value.modeHint
}
function assign(value) { commit(updateApproval(props.modelValue, selectedId.value, { assigneeId: value })) }
function toggleParticipant(id, checked) {
  if (!selected.value) return
  const members = participants(selected.value)
  commit(updateApproval(props.modelValue, selectedId.value, { assigneeIds: checked ? [...new Set([...members, id])] : members.filter(member => member !== id) }))
}
function move(direction) { commit(moveApproval(props.modelValue, selectedId.value, direction)); announcement.value = t.value.reordered }
function remove() {
  if (!props.editable || props.busy || stages.value.length <= 1) return
  const index = selectedIndex.value - 1
  const adjacent = stages.value[index + 1]?.id || stages.value[index - 1]?.id
  commit(removeApproval(props.modelValue, selectedId.value), adjacent)
  announcement.value = t.value.removed
}
function travel(direction) {
  if (!props.editable || props.busy) return
  const snapshot = history[direction](props.modelValue, selectedId.value)
  if (!snapshot) return
  expectedDefinition = JSON.stringify(snapshot.definition); selectedId.value = snapshot.selection
  emit('update:modelValue', snapshot.definition)
  announcement.value = direction === 'undo' ? t.value.undone : t.value.redone
}
function reset() {
  if (!props.editable || props.busy) return
  commit(cloneDefinition(props.published), approvalNodes(props.published)[0]?.id)
  emit('reset'); announcement.value = t.value.resetDone
}
async function keydown(event) {
  if (event.isComposing) return
  const inField = event.target.closest?.('input, textarea, select, [contenteditable="true"]')
  if (event.key === 'Escape' && inspector.value?.contains(event.target)) {
    event.preventDefault(); mobileEditing.value = false
    await nextTick()
    root.value?.querySelector(`[data-select-id="${selectedId.value}"]`)?.focus(); return
  }
  if (inField || !(event.ctrlKey || event.metaKey) || event.altKey) return
  if (event.key.toLowerCase() === 'z') { event.preventDefault(); travel(event.shiftKey ? 'redo' : 'undo') }
  else if (event.key.toLowerCase() === 'y') { event.preventDefault(); travel('redo') }
}
async function focusIssue(message) {
  mobileEditing.value = true
  const match = /approval step (\d+)/i.exec(message)
  if (match) {
    selectedId.value = props.modelValue.nodes[Number(match[1])]?.id
    await nextTick()
    if (/name/i.test(message)) nameInput.value?.focus()
    else if (/participants/i.test(message)) inspector.value?.querySelector('fieldset input')?.focus()
    else inspector.value?.querySelector('select')?.focus()
  } else root.value?.querySelector('[data-testid="process-name"]')?.focus()
}
</script>

<template>
  <section ref="root" class="blueprint designer-workbench" :class="{'is-mobile-editing': mobileEditing}" :lang="locale === 'zh' ? 'zh-CN' : 'en'" @keydown="keydown">
    <h2 class="sr-only">{{ t.title }}</h2>
    <div class="designer-toolbar">
      <label v-if="editable" class="process-name">{{ t.processName }}<input :value="modelValue.name" data-testid="process-name" :maxlength="MAX_NAME_LENGTH" :disabled="busy" @input="editProcessName($event.target.value)" @blur="history.endMerge()"></label>
      <h3 v-else class="readonly-name">{{ published.name }}</h3>
      <div v-if="editable" class="designer-history" :aria-label="locale === 'zh' ? '草稿编辑历史' : 'Draft edit history'"><button type="button" class="secondary" data-testid="undo" :disabled="busy || !history.canUndo" @click="travel('undo')">↶ {{ t.undo }}</button><button type="button" class="secondary" data-testid="redo" :disabled="busy || !history.canRedo" @click="travel('redo')">↷ {{ t.redo }}</button></div>
      <label v-if="showLanguage" class="designer-language"><span class="sr-only">Designer language / 设计器语言</span><select v-model="locale" data-testid="designer-language" aria-label="Designer language / 设计器语言"><option value="zh">中文</option><option value="en">English</option></select></label>
    </div>
    <div class="designer-state" aria-live="polite"><span class="draft-badge" :class="{dirty}">{{ !editable ? t.readOnly : dirty ? t.dirty : t.clean }}</span><span>{{ t.published }} v{{ published.version }}<template v-if="editable"> · {{ t.draft }} v{{ modelValue.version }}</template></span><span v-if="!editable" class="draft-storage">{{ t.editorOnly }}</span></div>
    <p v-if="editable && stale" class="warning" data-testid="stale-draft">{{ t.stale }}</p>
    <div class="mobile-designer-switch" :aria-label="locale === 'zh' ? '设计器视图' : 'Designer view'">
      <button type="button" :aria-pressed="!mobileEditing" @click="mobileEditing = false">{{ t.sequence }} <span>{{ stages.length }}</span></button>
      <button type="button" :aria-pressed="mobileEditing" @click="mobileEditing = true">{{ t.inspector }}</button>
    </div>
    <div class="designer-layout">
      <div class="designer-canvas">
        <div class="canvas-heading"><div><h3>{{ t.sequence }}</h3><p>{{ stages.length }} / {{ MAX_APPROVALS }} {{ t.count }}</p></div><span class="canvas-order">↓ {{ locale === 'zh' ? '按顺序执行' : 'Runs top to bottom' }}</span></div>
        <ol class="flow designer-track" :aria-label="t.sequence">
          <li v-for="(node, index) in modelValue.nodes" :key="node.id" class="track-position">
            <div v-if="index" class="stage-connector" aria-hidden="false"><span aria-hidden="true"></span><button v-if="editable" type="button" class="insert-step" :aria-label="ariaLabel('insert', index, node.type)" :disabled="!canAdd" :title="!canAdd ? t.limit : t.add" @click="insert(modelValue.nodes[index - 1].id)">＋</button></div>
            <button v-if="isApproval(node)" type="button" class="flow-node approval review-card" :class="{parallelApproval: node.type === 'parallelApproval', selected: selectedId === node.id, invalid: nodeErrors(node).length}" :data-step-id="node.id" :data-select-id="node.id" data-testid="select-step" :aria-label="ariaLabel('configure', index, node.name || t.missing)" :aria-pressed="selectedId === node.id" @click="choose(node.id, $event.detail === 0)">
              <span class="review-card-header"><span class="review-symbol" aria-hidden="true">{{ String(index).padStart(2, '0') }}</span><span class="review-stage-label">{{ t.stage }} {{ index }}</span><span class="mode-pill" :class="approvalMode(node).toLowerCase()">{{ modeName(node) }}</span></span>
              <strong class="review-card-title">{{ node.name.trim() || t.missing }}</strong>
              <span class="review-people"><span class="participant-avatars" aria-hidden="true"><span v-for="id in participants(node)" :key="id" :class="id">{{ personName(id).charAt(0) }}</span></span><span>{{ participants(node).map(personName).join(' + ') || t.missing }}</span><span class="card-open" aria-hidden="true"></span></span>
              <span v-if="nodeErrors(node).length" class="node-error">! {{ t.missing }}</span>
            </button>
            <div v-else class="flow-node boundary-card" :class="node.type" :data-step-id="node.id"><span class="boundary-symbol" aria-hidden="true">{{ node.type === 'start' ? '↗' : '●' }}</span><div><strong>{{ node.type === 'start' ? t.submit : t.complete }}</strong><span>{{ node.type === 'start' ? t.start : t.end }} · {{ t.fixed }}</span></div></div>
          </li>
        </ol>
        <div v-if="editable" class="designer-add"><button type="button" class="secondary" data-testid="add-step" :disabled="!canAdd" @click="insert(modelValue.nodes.at(-2).id)">＋ {{ t.add }}</button><p v-if="!canAdd && !busy" class="limit-hint">{{ t.limit }}</p><p v-else>{{ t.keyboard }}</p></div>
      </div>
      <aside v-if="selected" ref="inspector" class="step-inspector" tabindex="-1" aria-labelledby="inspector-heading">
        <header class="inspector-heading"><div><p>{{ t.stage }} {{ selectedIndex }}</p><h3 id="inspector-heading">{{ t.inspector }}</h3></div><span class="inspector-symbol" aria-hidden="true">≡</span></header>
        <template v-if="editable">
          <label>{{ t.name }}<input ref="nameInput" :value="selected.name" :aria-label="ariaLabel('name', selectedIndex)" :aria-invalid="!!nameError" :aria-describedby="nameError ? 'step-name-error' : undefined" :maxlength="MAX_NAME_LENGTH" :disabled="busy" @input="editName($event.target.value)" @blur="history.endMerge()"></label><p v-if="nameError" id="step-name-error" class="field-error">{{ issueText(nameError) }}</p>
          <label>{{ t.mode }}<select :value="approvalMode(selected)" :aria-label="ariaLabel('mode', selectedIndex)" :disabled="busy" @change="mode($event.target.value)"><option value="SINGLE">{{ t.single }}</option><option value="ALL">{{ t.all }}</option><option value="ANY">{{ t.any }}</option></select></label>
          <label v-if="selected.type === 'approval'">{{ t.assignee }}<select :value="selected.assigneeId" :aria-label="ariaLabel('assignee', selectedIndex)" :disabled="busy" @change="assign($event.target.value)"><option v-for="person in approvers" :key="person.id" :value="person.id">{{ personName(person.id) }}</option></select></label>
          <fieldset v-else class="participant-picker" :disabled="busy" :aria-label="ariaLabel('members', selectedIndex)" :aria-invalid="!!memberError" :aria-describedby="memberError ? 'step-members-error' : 'participant-help'"><legend>{{ t.people }} <span>{{ participants(selected).length }} {{ t.selected }}</span></legend><label v-for="person in approvers" :key="person.id" class="participant-option"><span class="participant-avatar" :class="person.id" aria-hidden="true">{{ personName(person.id).charAt(0) }}</span><span>{{ personName(person.id) }}</span><input type="checkbox" :checked="participants(selected).includes(person.id)" :aria-label="ariaLabel('member', selectedIndex, personName(person.id))" @change="toggleParticipant(person.id, $event.target.checked)"></label><p id="participant-help">{{ t.minimum }}</p></fieldset><p v-if="memberError" id="step-members-error" class="field-error">{{ issueText(memberError) }}</p>
        </template>
        <template v-else><h4 class="readonly-step-name">{{ selected.name }}</h4><p>{{ modeName(selected) }}</p><p>{{ locale === 'en' ? 'Assigned to' : '参与人' }} {{ participants(selected).map(personName).join(' + ') }}</p></template>
        <section class="rule-callout"><strong>{{ t.rule }}</strong><p class="group-rule">{{ rule(selected) }}</p></section>
        <p class="directory-note">{{ t.demo }}</p>
        <div v-if="editable" class="step-controls"><button type="button" class="secondary" :aria-label="ariaLabel('up', selectedIndex)" :disabled="busy || selectedIndex === 1" @click="move(-1)">↑ {{ t.up }}</button><button type="button" class="secondary" :aria-label="ariaLabel('down', selectedIndex)" :disabled="busy || selectedIndex === stages.length" @click="move(1)">↓ {{ t.down }}</button><button type="button" class="remove-step" :aria-label="ariaLabel('remove', selectedIndex)" :disabled="busy || stages.length <= 1" :title="stages.length <= 1 ? t.required : t.remove" @click="remove">{{ t.remove }}</button></div>
        <p v-if="editable && stages.length <= 1" class="inspector-limit">{{ t.required }}</p>
      </aside>
    </div>
    <div v-if="errors.length" class="validation-panel"><strong>{{ t.issues }}</strong><ul class="validation-list" :aria-label="locale === 'zh' ? '草稿校验' : 'Draft validation'"><li v-for="message in errors" :key="message"><button type="button" @click="focusIssue(message)">{{ issueText(message) }} <span aria-hidden="true">→</span></button></li></ul></div>
    <footer class="designer-footer"><p><span class="draft-storage" v-if="editable">{{ t.local }}</span>{{ t.snapshots }}<span v-if="editable && dirty && !stale && !busy && !errors.length" class="ready-indicator">✓ {{ t.ready }}</span></p><div v-if="editable"><button type="button" class="secondary" data-testid="reset-draft" :disabled="busy || (!dirty && !stale)" @click="reset">{{ t.reset }}</button><button type="button" class="primary" data-testid="publish" :disabled="busy || !dirty || !!errors.length || stale" @click="emit('publish')">{{ publishing ? t.publishing : t.publish }}</button></div></footer>
    <p class="designer-announcement sr-only" aria-live="polite">{{ announcement }}</p>
    <details class="designer-json"><summary>{{ t.preview }}</summary><pre>{{ JSON.stringify(modelValue, null, 2) }}</pre></details>
  </section>
</template>
