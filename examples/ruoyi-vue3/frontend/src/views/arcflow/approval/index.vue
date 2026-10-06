<script setup name="ArcflowApproval">
import { computed, onMounted, ref, watch } from 'vue'
import { getMe, getPeople, getProcess, getRequests, publishProcess, submitRequest, decideRequest } from '@/api/arcflow/approval'
import { approvals, approvalMode, canVote, clone, modeLabel, modeRule, participantVotes, participants, pendingParticipants, setApprovalMode, stepState, validText, validateDefinition } from './process'
import { createSubmissionIntent, isRejectedSubmissionVersion } from './submission-intent'
import { validateSubmissionResponse } from './submission-response'

const me = ref(null), people = ref([]), process = ref(null), draft = ref(null), baseline = ref('')
const requests = ref([]), selectedId = ref(null), tab = ref('mine'), busy = ref(false)
const error = ref(''), notice = ref(''), refreshRequired = ref(false), publishUncertain = ref(false)
const title = ref(''), reason = ref(''), days = ref(1), comment = ref('')
const submissionIntent = createSubmissionIntent(), submissionAttempt = ref(null), submissionDefinition = ref(null)
let submissionVersionRejected = false
const submissionFields = () => ({ title: title.value, reason: reason.value, days: days.value })
function clearSubmission() { submissionIntent.clear(); submissionAttempt.value = null; submissionDefinition.value = null; submissionVersionRejected = false }
watch([() => me.value?.id, title, reason, days], () => {
  submissionIntent.invalidate(me.value?.id, submissionFields())
  if (!submissionIntent.current(me.value?.id, submissionFields())) clearSubmission()
}, { flush: 'sync' })
const submissionProcess = computed(() => submissionAttempt.value ? submissionDefinition.value : process.value)
const dirty = computed(() => draft.value && JSON.stringify(draft.value) !== baseline.value)
const draftSteps = computed(() => approvals(draft.value))
const draftError = computed(() => validateDefinition(draft.value, people.value))
const stale = computed(() => publishUncertain.value || draft.value?.version !== process.value?.version)
const inbox = computed(() => requests.value.filter(item => canVote(item, me.value?.id)))
const visible = computed(() => tab.value === 'inbox' ? inbox.value : tab.value === 'mine' ? requests.value.filter(item => item.applicantId === me.value?.id) : requests.value)
const selected = computed(() => requests.value.find(item => item.id === selectedId.value))
const canDecide = computed(() => canVote(selected.value, me.value?.id))
const selfAssigned = computed(() => approvals(submissionProcess.value).some(node => participants(node).includes(me.value?.id)))
const locked = computed(() => busy.value || refreshRequired.value || !me.value)
const person = id => people.value.find(person => String(person.id) === id)?.displayName || id || '—'
const date = value => value ? new Date(value).toLocaleString() : '—'
const status = value => ({ PENDING: '审批中', APPROVED: '已通过', REJECTED: '已拒绝' })[value] || value
const action = value => ({ SUBMIT: '提交', APPROVE: '通过', REJECT: '拒绝' })[value] || value
function resetDraft() {
  if (busy.value || !process.value) return
  draft.value = clone(process.value); baseline.value = JSON.stringify(draft.value); publishUncertain.value = false
}
async function refresh() {
  if (busy.value) return
  busy.value = true; error.value = ''; notice.value = ''
  const preserve = dirty.value, previousStep = selected.value?.currentStepId
  try {
    const [identity, persons, blueprint, items] = await Promise.all([getMe(), getPeople(), getProcess(), getRequests()])
    me.value = identity.data; people.value = persons.data; process.value = blueprint.data; requests.value = items.data
    if (submissionVersionRejected) clearSubmission()
    if (!preserve) { draft.value = clone(blueprint.data); baseline.value = JSON.stringify(draft.value) }
    if (previousStep !== selected.value?.currentStepId) comment.value = ''
    refreshRequired.value = false
    notice.value = preserve ? '已刷新。未发布的本地草稿已保留。' : '已加载最新数据。'
  } catch (e) {
    refreshRequired.value = true
    error.value = '加载失败或无访问权限。请检查若依登录状态和菜单权限，然后刷新。'
  } finally { busy.value = false }
}
function addStep() {
  if (locked.value || !me.value?.canPublish || draftSteps.value.length >= 8 || !draft.value) return
  let suffix = 1
  while (draft.value.nodes.some(node => node.id === `approval-${suffix}`)) suffix++
  draft.value.nodes.splice(-1, 0, { id: `approval-${suffix}`, type: 'approval', name: `审批 ${draftSteps.value.length + 1}`, assigneeId: people.value[0] ? String(people.value[0].id) : '' })
}
function changeMode(id, mode) {
  if (locked.value || !me.value?.canPublish) return
  draft.value = setApprovalMode(draft.value, id, mode)
}
function removeStep(id) {
  if (locked.value || !me.value?.canPublish || draftSteps.value.length <= 1) return
  draft.value.nodes = draft.value.nodes.filter(node => node.id !== id)
}
function moveStep(id, direction) {
  if (locked.value || !me.value?.canPublish) return
  const index = draft.value.nodes.findIndex(node => node.id === id), target = index + direction
  if (index < 1 || target < 1 || target >= draft.value.nodes.length - 1) return
  const [node] = draft.value.nodes.splice(index, 1); draft.value.nodes.splice(target, 0, node)
}
function mutationFailure(kind) {
  // The official RuoYi interceptor may discard AjaxResult error codes. Never
  // assume a failed response means a write did not happen, or retry blindly.
  refreshRequired.value = true
  if (kind === 'publish') publishUncertain.value = true
  error.value = '操作未能确认，可能因权限、版本冲突或网络异常。请先刷新核对最新状态，再重试；本地输入已保留。'
}
async function publish() {
  if (locked.value || !me.value?.canPublish || !dirty.value || stale.value) return
  if (draftError.value) { error.value = draftError.value; return }
  busy.value = true; error.value = ''; notice.value = ''
  const definition = clone(draft.value)
  definition.name = definition.name.trim()
  definition.nodes.forEach(node => { node.name = node.name.trim() })
  try {
    const response = await publishProcess({ expectedVersion: definition.version, definition })
    process.value = response.data; draft.value = clone(response.data); baseline.value = JSON.stringify(draft.value)
    notice.value = `已发布版本 v${response.data.version}。已有申请继续使用其提交时的流程快照。`
  } catch (e) { mutationFailure('publish') }
  finally { busy.value = false }
}
async function submit() {
  if (locked.value || !process.value || selfAssigned.value) return
  if (!validText(title.value, 120) || !reason.value.trim() || reason.value.length > 2000 || !Number.isInteger(days.value) || days.value < 1 || days.value > 365) {
    error.value = '请输入有效标题、请假原因和 1 至 365 的整数天数。'; return
  }
  busy.value = true; error.value = ''; notice.value = ''
  try {
    if (!submissionAttempt.value) submissionDefinition.value = clone(process.value)
    const attempt = submissionIntent.prepare(me.value.id, submissionFields(), process.value.version)
    submissionAttempt.value = attempt
    const { data } = await submitRequest(attempt.payload, attempt.key)
    validateSubmissionResponse(data, me.value.id, attempt.payload, submissionDefinition.value)
    clearSubmission()
    requests.value = [data, ...requests.value.filter(item => item.id !== data.id)]
    selectedId.value = data.id; tab.value = 'mine'; title.value = ''; reason.value = ''; days.value = 1; comment.value = ''
    notice.value = data.status === 'PENDING' ? '申请已提交。' : `申请${status(data.status)}。`
  } catch (e) { submissionVersionRejected = isRejectedSubmissionVersion(e); mutationFailure('submit') }
  finally { busy.value = false }
}
async function decide(decision) {
  if (locked.value || !canDecide.value || comment.value.length > 2000) return
  const id = selected.value.id, stepId = selected.value.currentStepId
  busy.value = true; error.value = ''; notice.value = ''
  try {
    const { data } = await decideRequest(id, { stepId, decision, comment: comment.value.trim() })
    requests.value = requests.value.map(item => item.id === data.id ? data : item); comment.value = ''
    notice.value = data.status !== 'PENDING' ? `申请${status(data.status)}。` : data.currentStepId === stepId ? '投票已记录，等待本组其他参与人。' : '本节点已通过，已流转至下一审批人。'
  } catch (e) { mutationFailure('decide') }
  finally { busy.value = false }
}
function select(row) { selectedId.value = row?.id || null; comment.value = '' }
onMounted(refresh)
</script>

<template>
  <div class="app-container arcflow-approval">
    <div class="page-header">
      <div><h2>ArcFlow 请假审批</h2><p>当前用户：{{ me?.displayName || '加载中' }} · 已发布流程 v{{ process?.version || '—' }}</p></div>
      <el-button v-hasPermi="['arcflow:request:read']" :loading="busy" @click="refresh">刷新</el-button>
    </div>
    <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon class="message" />
    <el-alert v-if="notice" :title="notice" type="success" :closable="false" show-icon class="message" />
    <el-tabs v-model="tab">
      <el-tab-pane label="我的申请" name="mine" />
      <el-tab-pane :label="`待我审批 (${inbox.length})`" name="inbox" />
      <el-tab-pane label="我参与的申请" name="all" />
      <el-tab-pane label="流程设计" name="process" />
    </el-tabs>
    <template v-if="tab === 'process'">
      <el-alert title="有序阶段：开始 → 1–8 个单人 / ALL / ANY 节点 → 结束。分组同时开放投票，完成后进入下一阶段；发布仅影响新申请。" type="info" :closable="false" class="message" />
      <el-alert v-if="stale" title="草稿版本已过期或发布结果未确认。请刷新后重置草稿，再重新应用需要的修改。" type="warning" :closable="false" class="message" />
      <el-card v-if="draft" shadow="never">
        <el-form label-width="100px" :disabled="locked || !me?.canPublish">
          <el-form-item label="流程名称"><el-input v-model="draft.name" maxlength="120" show-word-limit /></el-form-item>
          <div class="fixed-node">开始</div>
          <div v-for="(node, index) in draftSteps" :key="node.id" class="approval-node">
            <strong>审批 {{ index + 1 }}</strong>
            <el-input v-model="node.name" maxlength="120" :aria-label="`审批 ${index + 1} 名称`" placeholder="节点名称" />
            <el-select :model-value="approvalMode(node)" @update:model-value="changeMode(node.id, $event)" :aria-label="`审批 ${index + 1} 完成方式`">
              <el-option label="单人审批" value="SINGLE" />
              <el-option label="全员同意（ALL）" value="ALL" />
              <el-option label="任一同意（ANY）" value="ANY" />
            </el-select>
            <el-select v-if="node.type === 'approval'" v-model="node.assigneeId" filterable placeholder="选择审批人" :aria-label="`审批 ${index + 1} 审批人`">
              <el-option v-for="user in people" :key="user.id" :label="`${user.displayName} (${user.id})`" :value="String(user.id)" />
            </el-select>
            <el-select v-else v-model="node.assigneeIds" multiple filterable :multiple-limit="16" placeholder="选择 2 至 16 个参与人" :aria-label="`审批 ${index + 1} 参与人`">
              <el-option v-for="user in people" :key="user.id" :label="`${user.displayName} (${user.id})`" :value="String(user.id)" />
            </el-select>
            <p class="group-rule">{{ modeRule(node) }}</p>
            <div class="node-actions" v-hasPermi="['arcflow:process:publish']">
              <el-button :disabled="index === 0" @click="moveStep(node.id, -1)" :aria-label="`上移审批 ${index + 1}`">上移</el-button>
              <el-button :disabled="index === draftSteps.length - 1" @click="moveStep(node.id, 1)" :aria-label="`下移审批 ${index + 1}`">下移</el-button>
              <el-button type="danger" plain :disabled="draftSteps.length <= 1" @click="removeStep(node.id)">删除</el-button>
            </div>
          </div>
          <div class="fixed-node">结束</div>
          <el-form-item v-hasPermi="['arcflow:process:publish']">
            <el-button :disabled="draftSteps.length >= 8" @click="addStep">添加审批节点</el-button>
            <el-button type="primary" :loading="busy" :disabled="!dirty || !!draftError || stale" @click="publish">发布新版本</el-button>
          </el-form-item>
        </el-form>
        <p v-if="draftError" class="validation" role="alert">{{ draftError }}</p>
        <el-button v-if="me?.canPublish" v-hasPermi="['arcflow:process:publish']" :disabled="busy || refreshRequired" @click="resetDraft">放弃本地修改并载入已发布版本</el-button>
        <p v-if="!me?.canPublish">当前账号仅可查看流程，发布需要流程管理权限。</p>
      </el-card>
    </template>
    <el-row v-else :gutter="20">
      <el-col :xs="24" :lg="14">
        <el-card v-if="tab === 'mine'" v-hasPermi="['arcflow:request:submit']" shadow="never" class="message">
          <template #header>提交请假申请</template>
          <el-alert v-if="selfAssigned" title="当前流程包含由您审批的节点，不能提交由自己审批的申请。" type="warning" :closable="false" class="message" />
          <el-form label-width="80px" :disabled="locked || selfAssigned" @submit.prevent="submit">
            <el-form-item label="标题" required><el-input v-model="title" maxlength="120" show-word-limit /></el-form-item>
            <el-form-item label="天数" required><el-input-number v-model="days" :min="1" :max="365" :precision="0" /></el-form-item>
            <el-form-item label="原因" required><el-input v-model="reason" type="textarea" :rows="3" maxlength="2000" show-word-limit /></el-form-item>
            <el-form-item><el-button type="primary" :loading="busy" :disabled="!process" @click="submit">提交申请 · v{{ submissionProcess?.version || '—' }}</el-button></el-form-item>
          </el-form>
        </el-card>
        <el-table :data="visible" v-loading="busy" row-key="id" highlight-current-row @row-click="select" empty-text="暂无申请">
          <el-table-column prop="title" label="标题" min-width="150" show-overflow-tooltip />
          <el-table-column label="申请人" min-width="100"><template #default="{ row }">{{ person(row.applicantId) }}</template></el-table-column>
          <el-table-column label="状态" width="100"><template #default="{ row }"><el-tag :type="row.status === 'REJECTED' ? 'danger' : row.status === 'APPROVED' ? 'success' : 'warning'">{{ status(row.status) }}</el-tag></template></el-table-column>
          <el-table-column label="操作" width="80"><template #default="{ row }"><el-button link type="primary" @click.stop="select(row)">详情</el-button></template></el-table-column>
        </el-table>
      </el-col>
      <el-col :xs="24" :lg="10">
        <el-card v-if="selected" shadow="never" class="detail">
          <template #header>{{ selected.title }}</template>
          <el-descriptions :column="1" border>
            <el-descriptions-item label="申请人">{{ person(selected.applicantId) }}</el-descriptions-item>
            <el-descriptions-item label="天数">{{ selected.days }}</el-descriptions-item>
            <el-descriptions-item label="原因"><span class="prewrap">{{ selected.reason }}</span></el-descriptions-item>
            <el-descriptions-item label="状态">{{ status(selected.status) }}</el-descriptions-item>
            <el-descriptions-item label="当前审批人">{{ pendingParticipants(selected).map(person).join('、') || '—' }}</el-descriptions-item>
            <el-descriptions-item label="流程快照">{{ selected.definition?.name }} · v{{ selected.processVersion }}</el-descriptions-item>
          </el-descriptions>
          <h3>提交时的流程快照</h3>
          <ol class="snapshot">
            <li v-for="node in selected.definition?.nodes || []" :key="node.id">
              <strong>{{ node.name }}</strong> · {{ stepState(selected, node) }}
              <template v-if="participants(node).length">
                <span> · {{ modeLabel(node) }}</span>
                <p class="snapshot-rule">{{ modeRule(node) }}</p>
                <ul class="participant-votes">
                  <li v-for="vote in participantVotes(selected, node)" :key="vote.actorId">{{ person(vote.actorId) }} · {{ vote.state }}<span v-if="vote.comment" class="prewrap"> · {{ vote.comment }}</span></li>
                </ul>
              </template>
            </li>
          </ol>
          <div v-if="canDecide" v-hasPermi="['arcflow:request:decide']" class="decision">
            <el-input v-model="comment" type="textarea" :rows="2" maxlength="2000" show-word-limit :disabled="locked" placeholder="审批意见（选填）" aria-label="审批意见" />
            <div class="decision-actions"><el-button type="success" :loading="busy" :disabled="locked" @click="decide('APPROVE')">投同意票</el-button><el-button type="danger" :disabled="locked" @click="decide('REJECT')">投拒绝票</el-button></div>
          </div>
          <h3>审批记录</h3>
          <el-timeline>
            <el-timeline-item v-for="(entry, index) in selected.history || []" :key="`${entry.at}-${index}`" :timestamp="date(entry.at)">
              {{ person(entry.actorId) }} · {{ action(entry.action) }}<span v-if="entry.stepId"> · {{ selected.definition?.nodes.find(node => node.id === entry.stepId)?.name || entry.stepId }}</span>
              <p v-if="entry.comment" class="prewrap">{{ entry.comment }}</p>
            </el-timeline-item>
          </el-timeline>
        </el-card>
        <el-empty v-else description="选择申请查看流程快照和审批记录" />
      </el-col>
    </el-row>
  </div>
</template>

<style scoped>
.page-header { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.page-header h2 { margin-top: 0; }
.page-header p { color: #606266; }
.message { margin-bottom: 16px; }
.approval-node { display: grid; grid-template-columns: 80px minmax(100px, 1fr) minmax(160px, 1fr) minmax(180px, 1fr); align-items: center; gap: 12px; padding: 16px; margin: 12px 0; border: 1px solid #dcdfe6; border-radius: 6px; }
.group-rule { grid-column: 2 / -1; margin: 0; color: #606266; }
.snapshot-rule { margin: 6px 0; color: #606266; }
.participant-votes { padding-left: 20px; }
.approval-node .node-actions { grid-column: 2 / -1; }
.fixed-node { text-align: center; padding: 12px; background: #f5f7fa; border-radius: 6px; margin-bottom: 16px; }
.node-actions { display: flex; flex-wrap: wrap; gap: 6px; }
.node-actions .el-button { margin-left: 0; }
.validation { color: #c45656; }
.snapshot { padding-left: 22px; }
.snapshot li { padding: 8px 0; overflow-wrap: anywhere; }
.prewrap { white-space: pre-wrap; overflow-wrap: anywhere; }
.decision-actions { margin-top: 16px; }
@media (max-width: 1200px) { .approval-node { grid-template-columns: 1fr; } .group-rule, .approval-node .node-actions { grid-column: auto; } .detail { margin-top: 20px; } }
</style>
