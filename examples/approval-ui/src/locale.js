// UI copy only. Names, comments, request content and saved definitions remain untouched.
export const appCopy = {
  en: {
    language: 'Workspace language', languageShort: 'Language', storyEyebrow: 'LEAVE APPROVAL DEMO', storyTitle: 'Try submitting', storyTitleSecond: 'a leave request.', storyDescription: 'Set up an approval process, submit a leave request, and follow its progress.', request: 'Request', reviews: 'Reviews', outcome: 'Outcome', storyFootnote: 'Approval prototype · sequential and parallel reviews',
    welcome: 'DEMO SIGN-IN', choosePerspective: 'Choose a demo account', signInDescription: 'Sign in with a demo account and its server-configured password.', demoAccount: 'Demo account', aliceAccount: 'Alice · process designer', bobAccount: 'Bob · approver', carolAccount: 'Carol · approver', password: 'Password', signingIn: 'Signing in…', enterWorkspace: 'Enter workspace →', credentialsNote: 'Credentials stay in this tab’s memory. This demonstration is localhost-only; use synthetic data.',
    workspace: 'Workspace', workspaceLabel: 'WORKSPACE', navigation: 'Main navigation', requests: 'Requests', needsMyReview: 'Needs my review', processDesigner: 'Process designer', signOut: 'Sign out', prototype: 'LOCAL DEMO', leaveApprovals: 'Leave approvals', keepMoving: 'LEAVE REQUESTS', needsReview: 'Needs your review', designerDescription: 'Arrange steps. Choose single, ALL, or ANY review. Publish when ready.', requestsDescription: 'Every request follows its own saved approval sequence.', working: 'Working…', refresh: '↻ Refresh',
    summary: 'Request summary', visibleRequests: 'Visible requests', pendingRequests: 'Awaiting a decision', completedRequests: 'Decisions complete', publishedVersion: 'Published template', reviewSteps: '{count} approval stages',
    startHere: 'START HERE', newRequest: 'New leave request', savedTemplate: 'The published template is saved with your request.', draftNotUsed: 'Your unpublished draft is not used.', selfAssignedWarning: 'You cannot submit: this template includes an approval assigned to you. Ask Alice to publish a sequence without you before submitting.', title: 'Title', titlePlaceholder: 'e.g. Annual leave · October', days: 'Days', reason: 'Reason', reasonPlaceholder: 'Add context for your approvers…', sentAs: 'Sent as {name}', submit: 'Submit request', pendingDecisions: 'Pending decisions', yourVisibleRequests: 'Your visible requests', caughtUp: 'You’re all caught up. No requests need your review.', noRequests: 'No requests yet. Start with the form above.', day: 'day', dayPlural: 'days', awaiting: 'Awaiting {names}',
    requestDetails: 'REQUEST DETAILS', applicant: 'Applicant', awaitingVotes: 'Awaiting votes from', lastVoter: 'Last voter', duration: 'Duration', savedProcess: 'Saved process', savedSequence: 'Saved approval sequence', readOnlySnapshot: 'Read-only snapshot from submission', participantVotes: '{name} participant votes', now: 'Now:', next: 'Next:', finalStep: 'Final approval step', activity: 'Activity', awaitingReview: 'Awaiting review', reviewing: 'Reviewing:', decisionComment: 'Decision comment', optional: '(optional)', rejectVote: 'Reject vote', rejectRequest: 'Reject request', approveVote: 'Approve vote', approveStep: 'Approve step', approveRequest: 'Approve request', whoCanDecide: 'Only the designated approver for the current step, or a group participant who has not yet voted, can record a decision.', inspectSnapshot: 'Inspect saved snapshot JSON', fullPicture: 'Select a request', selectRequest: 'Select a request to see its details, approval sequence, and activity.', footer: 'ArcFlow approval example', footerNote: 'Local JSON snapshot · synthetic data only',
    status_PENDING: 'pending', status_APPROVED: 'approved', status_REJECTED: 'rejected', vote_approved: 'Approved', vote_rejected: 'Rejected', vote_pending: 'Awaiting vote', vote_upcoming: 'Upcoming', 'vote_not-needed': 'Not required', vote_skipped: 'Not reached', state_completed: 'Completed', state_approved: 'Approved', state_rejected: 'Rejected', state_current: 'Awaiting review', state_upcoming: 'Upcoming', state_skipped: 'Not reached', state_pending: 'Awaiting vote', 'state_not-needed': 'Not required',
    allRule: 'ALL: every participant must approve. Any rejection ends the request.', anyRule: 'ANY: one approval completes this group. Rejection ends the request only after every participant rejects.', approvalStep: 'Approval step', submittedActivity: 'Request submitted', approvedActivity: 'approved', rejectedActivity: 'rejected', vote: 'vote ',
    refreshed: 'Requests and published template refreshed.', refreshedDraft: 'Requests and published template refreshed. Your local draft is preserved.', resetDone: 'Local draft reset to the latest loaded published template.', published: 'Template v{version} published. New requests will use it; existing request snapshots are unchanged.', submitted: 'Request submitted. {names} can now review the first step.', voteRecorded: 'Vote recorded. This group is still pending; awaiting {names}.', stepApproved: 'Step approved. The request is still pending; {names} reviews the next step.', requestApproved: 'Request approved.', requestRejected: 'Request rejected.',
    invalidFields: 'Enter a title, a reason, and a whole number of days between 1 and 365.', selfAssignedError: 'You cannot submit a request when the published template assigns an approval step to you.', validTemplateNeeded: 'Refresh to load a valid published template before submitting.', staleDraft: 'This draft is out of date. Refresh, then reset to the published template and reapply your changes.', invalidTemplate: 'Invalid process template. Refresh to load a usable template.',
    loginFailed: 'We couldn’t open the workspace.', refreshFailed: 'We couldn’t refresh the workspace. Your currently loaded data is still shown.', publishFailed: 'We couldn’t confirm that the template was published.', submitFailed: 'We couldn’t confirm that the request was submitted.', decisionFailed: 'We couldn’t confirm that your decision was recorded.', unauthorized: 'Sign-in wasn’t accepted. Check the demo account and its server-configured password, then try again.', sessionUnauthorized: 'Your credentials were not accepted. Sign out and sign in again to continue.', forbidden: 'This account isn’t allowed to perform this action.', notFound: 'The requested item could not be found. Refresh to check the latest data.', conflict: 'The server could not accept this change because it conflicts with its current state.', serverFailure: 'The service returned an error. Check that the local backend is available.', networkFailure: 'The browser could not reach the service. Check your connection and the local backend.', unknownFailure: 'The operation could not be completed. Please try again after checking the local backend.', serverDetail: 'Server detail (original):', technicalDetail: 'Error detail (original):', publishRecovery: 'Your draft is preserved. Refresh before retrying if the connection was interrupted.', publishConflictRecovery: 'Your draft is preserved. Refresh to load the latest template, then reset and reapply your changes before publishing.', submitRecovery: 'Refresh requests before retrying if the connection was interrupted or the template changed.', decisionRecovery: 'Refresh to check the latest status before retrying.',
  },
  zh: {
    language: '工作区语言', languageShort: '语言', storyEyebrow: '请假审批演示', storyTitle: '试着提交', storyTitleSecond: '一份请假申请', storyDescription: '设置审批流程，提交请假申请，再查看审批进度和处理记录。', request: '发起申请', reviews: '逐步审批', outcome: '查看结果', storyFootnote: '审批原型 · 顺序审批与多人审批',
    welcome: '登录演示', choosePerspective: '选择示例账号', signInDescription: '选择示例账号，并输入服务器为该账号配置的密码。', demoAccount: '示例账号', aliceAccount: 'Alice · 流程设计者', bobAccount: 'Bob · 审批人', carolAccount: 'Carol · 审批人', password: '密码', signingIn: '正在登录…', enterWorkspace: '进入工作区 →', credentialsNote: '凭据仅保存在当前标签页内存中。本演示仅限本机使用，请勿输入真实个人信息。',
    workspace: '工作区', workspaceLabel: '工作区', navigation: '主导航', requests: '申请列表', needsMyReview: '待我审批', processDesigner: '流程设计器', signOut: '退出登录', prototype: '本机演示', leaveApprovals: '请假审批', keepMoving: '请假申请', needsReview: '待你审批', designerDescription: '安排节点，选择单人、全员同意或任一同意，确认后发布。', requestsDescription: '每份申请都按提交时保存的审批流程运行。', working: '处理中…', refresh: '↻ 更新数据',
    summary: '工作区概览', visibleRequests: '可见申请', pendingRequests: '审批中', completedRequests: '已完成审批', publishedVersion: '已发布流程', reviewSteps: '{count} 个审批节点',
    startHere: '从这里开始', newRequest: '新建请假申请', savedTemplate: '提交时会保存已发布流程的快照。', draftNotUsed: '未发布的草稿不会用于申请。', selfAssignedWarning: '暂时无法提交：此流程包含由你审批的节点。请先让 Alice 发布不包含你的审批流程。', title: '标题', titlePlaceholder: '例如：十月年假', days: '天数', reason: '请假事由', reasonPlaceholder: '补充审批人需要了解的信息…', sentAs: '申请人：{name}', submit: '提交申请', pendingDecisions: '待处理审批', yourVisibleRequests: '你可查看的申请', caughtUp: '都处理好了，暂时没有待你审批的申请。', noRequests: '还没有申请，从上方表单发起第一份吧。', day: '天', dayPlural: '天', awaiting: '等待 {names}',
    requestDetails: '申请详情', applicant: '申请人', awaitingVotes: '等待以下人员审批', lastVoter: '最后决定人', duration: '请假时长', savedProcess: '保存的流程', savedSequence: '提交时的审批顺序', readOnlySnapshot: '提交时保存的只读快照', participantVotes: '{name} 的参与人决定', now: '当前：', next: '下一步：', finalStep: '最后一个审批节点', activity: '操作记录', awaitingReview: '等待审批', reviewing: '正在审批：', decisionComment: '审批意见', optional: '（选填）', rejectVote: '投拒绝票', rejectRequest: '驳回申请', approveVote: '投同意票', approveStep: '通过此节点', approveRequest: '通过申请', whoCanDecide: '只有当前节点的指定审批人，或该节点中尚未作出决定的参与人，才可以审批。', inspectSnapshot: '查看流程快照 JSON', fullPicture: '先选择一份申请', selectRequest: '选择一份申请，查看详细信息、审批顺序和操作记录。', footer: 'ArcFlow 审批示例', footerNote: '本地 JSON 快照 · 仅使用合成数据',
    status_PENDING: '审批中', status_APPROVED: '已通过', status_REJECTED: '已驳回', vote_approved: '已同意', vote_rejected: '已拒绝', vote_pending: '等待决定', vote_upcoming: '尚未开始', 'vote_not-needed': '无需决定', vote_skipped: '未执行', state_completed: '已完成', state_approved: '已通过', state_rejected: '已拒绝', state_current: '等待审批', state_upcoming: '尚未开始', state_skipped: '未执行', state_pending: '等待决定', 'state_not-needed': '无需决定',
    allRule: '全员同意（ALL）：所有参与人同意才通过，任一拒绝即驳回。', anyRule: '任一同意（ANY）：任一参与人同意即通过，全部拒绝才驳回。', approvalStep: '审批节点', submittedActivity: '已提交申请', approvedActivity: '已同意', rejectedActivity: '已拒绝', vote: '投票',
    refreshed: '已更新申请和已发布流程。', refreshedDraft: '已更新申请和已发布流程，你的本地草稿已保留。', resetDone: '本地草稿已重置为最近加载的已发布流程。', published: '流程 v{version} 已发布。新申请将使用此版本，已有申请的流程快照保持不变。', submitted: '申请已提交，{names} 现在可以审批第一个节点。', voteRecorded: '决定已记录。此节点仍在审批中，等待 {names}。', stepApproved: '当前节点已通过，申请仍在审批中，下一步由 {names} 审批。', requestApproved: '申请已通过。', requestRejected: '申请已驳回。',
    invalidFields: '请填写标题、请假事由，并输入 1 至 365 之间的整数天数。', selfAssignedError: '已发布流程包含由你审批的节点，因此你不能发起此申请。', validTemplateNeeded: '请先更新数据，加载有效的已发布流程后再提交。', staleDraft: '此草稿已过期。请先更新数据，再重置为已发布流程，重新应用修改后发布。', invalidTemplate: '流程模板无效，请更新数据以加载可用流程。',
    loginFailed: '暂时无法打开工作区。', refreshFailed: '暂时无法更新工作区，当前仍显示上次加载的数据。', publishFailed: '暂时无法确认流程是否已发布。', submitFailed: '暂时无法确认申请是否已提交。', decisionFailed: '暂时无法确认审批决定是否已记录。', unauthorized: '登录未通过，请检查示例账号及服务器为其配置的密码后重试。', sessionUnauthorized: '凭据未通过验证，请退出后重新登录。', forbidden: '此账号没有执行该操作的权限。', notFound: '找不到此项目，请更新数据以查看最新状态。', conflict: '本次修改与服务器当前状态冲突，暂时无法接受。', serverFailure: '服务返回了错误，请检查本机后端是否可用。', networkFailure: '浏览器无法连接服务，请检查网络连接和本机后端。', unknownFailure: '操作未能完成，请检查本机后端后重试。', serverDetail: '服务返回信息（原文）：', technicalDetail: '错误详情（原文）：', publishRecovery: '你的草稿已保留。若连接中断，请先更新数据再重试。', publishConflictRecovery: '你的草稿已保留。请先更新数据以加载最新流程，再重置并重新应用修改后发布。', submitRecovery: '若连接中断或流程已变更，请先更新申请列表再重试，避免重复提交。', decisionRecovery: '请先更新数据，确认最新审批状态后再重试。',
  },
}

export function translate(locale, key, values = {}) {
  const template = (appCopy[locale] || appCopy.en)[key] ?? appCopy.en[key] ?? key
  return template.replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? ''))
}

export function validationText(message, locale = 'en') {
  if (locale !== 'zh') return message
  const exact = {
    'The process template is unavailable. Refresh to load it.': '流程模板不可用，请更新数据后重试。',
    'The process contains unsupported fields.': '流程包含不受支持的字段。',
    'Use schema 2 or 3, the leave-approval process, and a positive whole-number version.': '请使用架构版本 2 或 3、leave-approval 流程及正整数版本号。',
    'Give the process a name.': '请填写流程名称。',
    'The process name cannot contain control characters.': '流程名称不能包含控制字符。',
    'Keep the process name to 120 characters.': '流程名称不能超过 120 个字符。',
    'The process must contain an ordered sequence of nodes.': '流程必须包含按顺序排列的节点。',
    'Every process node must have an identifier, type, name, and assignment.': '每个流程节点都必须包含标识、类型、名称和人员分配字段。',
    'The sequence must have a fixed start, approval steps, and a fixed end.': '流程必须由固定发起节点、审批节点和固定结束节点组成。',
    'Use between 1 and 8 approval steps.': '请设置 1 至 8 个审批节点。',
    'Each step must have a unique identifier.': '每个节点必须具有唯一标识。',
    'Step identifiers must start with a letter and use at most 64 letters, numbers, underscores, or hyphens.': '节点标识必须以字母开头，仅包含字母、数字、下划线或连字符，且不超过 64 个字符。',
    'Start and end must have no assigned approver.': '发起和结束节点不能分配审批人。',
  }
  if (exact[message]) return exact[message]
  const node = /approval step (\d+)/i.exec(message)
  const label = node ? `审批节点 ${node[1]}` : /start node/i.test(message) ? '发起节点' : /end node/i.test(message) ? '结束节点' : '流程节点'
  if (/^Give .+ a name\.$/.test(message)) return `请填写${label}名称。`
  if (/name cannot contain control characters\.$/.test(message)) return `${label}名称不能包含控制字符。`
  if (/^Keep .+'s name to 120 characters\.$/.test(message)) return `${label}名称不能超过 120 个字符。`
  if (/^Use the supported fields for /.test(message)) return `请为${label}使用受支持的字段。`
  if (/^Use schema 3 and ALL or ANY/.test(message)) return `${label}须使用架构版本 3 及 ALL 或 ANY 规则，且不能设置单人审批人。`
  if (/^Choose at least two distinct participants/.test(message)) return `${label}请选择至少两位不同的参与人（Bob 和 Carol）。`
  if (/^Choose Bob or Carol/.test(message)) return `${label}请选择 Bob 或 Carol。`
  // Unknown server/validation text remains explicitly identified as original text.
  return `校验信息（原文）：${message}`
}

const knownApiErrors = {
  'Authentication required': ['Sign in with an accepted demo account and password.', '请使用有效的示例账号和密码登录。'],
  'Forbidden': ['This account is not permitted to perform this action.', '此账号没有执行该操作的权限。'],
  'Origin or client header rejected': ['The server rejected this browser request’s origin or client header. Check that you are using the configured local demo address.', '服务器拒绝了此浏览器请求的来源或客户端标识，请确认使用的是已配置的本机演示地址。'],
  'Invalid request body or fields': ['Some request data was not accepted. Review the form before trying again.', '部分申请数据未通过验证，请检查表单后重试。'],
  'Storage unavailable; no change confirmed. Refresh before retrying.': ['Storage is unavailable, so no change can be confirmed. Refresh before retrying.', '存储暂不可用，无法确认修改是否成功，请先更新数据再重试。'],
  'You cannot submit to a process that assigns you any approval step': ['You cannot submit a request when any approval step is assigned to you.', '此流程包含由你审批的节点，因此你不能发起申请。'],
  'Invalid leave submission': ['The leave request was not accepted. Check the title, reason, and number of days.', '请假申请未通过验证，请检查标题、事由和天数。'],
  'Invalid decision': ['The approval decision was not accepted.', '审批决定未通过验证。'],
  'Comment must be at most 2000 characters': ['Keep your decision comment to 2,000 characters.', '审批意见不能超过 2,000 个字符。'],
  'Every approval participant must be an active eligible user': ['Choose active, eligible participants for every approval step.', '请为每个审批节点选择已启用且符合条件的参与人。'],
  'The published process changed; reload before publishing': ['The published template changed. Refresh before publishing.', '已发布流程发生变更，请先更新数据再发布。'],
  'The published process changed; reload before submitting': ['The published template changed. Refresh before submitting.', '已发布流程发生变更，请先更新数据再提交。'],
  'Process version limit reached': ['The process has reached its version limit.', '流程已达到版本数量上限。'],
  'Request not found': ['This request could not be found.', '找不到这份申请。'],
  'Step does not belong to this request': ['This step does not belong to the selected request.', '此节点不属于所选申请。'],
  "Only this step's assigned participants may decide": ['Only the assigned participants can decide this step.', '只有此节点的指定参与人可以审批。'],
  'This step already has a different decision': ['A different decision has already been recorded for this step.', '此节点已记录另一项决定。'],
  'Request is already terminal': ['This request has already been completed.', '这份申请已结束。'],
  'This approval step is not current': ['This is not the request’s current approval step.', '此节点已不是当前审批节点。'],
  'The request changed concurrently; retry the decision': ['The request was updated while you were reviewing it.', '你审批期间，这份申请已被更新。'],
  'Process publication is not permitted': ['This account cannot publish templates.', '此账号不能发布流程。'],
  'Unknown or inactive user': ['This account is unknown or inactive.', '此账号不存在或未启用。'],
}

export function apiFailure(cause, operation, locale = 'en') {
  const tr = (key, values) => translate(locale, key, values)
  if (cause?.validationErrors) {
    const parts = [tr('invalidTemplate'), ...cause.validationErrors.map(message => validationText(message, locale))]
    if (operation === 'publish') parts.push(tr('publishRecovery'))
    return parts.join(' ')
  }
  const status = Number(cause?.status), raw = typeof cause?.message === 'string' ? cause.message.trim() : ''
  let explanation
  if (status === 401 || /^unauthorized$/i.test(raw)) explanation = tr(operation === 'login' ? 'unauthorized' : 'sessionUnauthorized')
  else if (knownApiErrors[raw]) explanation = knownApiErrors[raw][locale === 'zh' ? 1 : 0]
  else if (status === 403) explanation = tr('forbidden')
  else if (status === 404) explanation = tr('notFound')
  else if (status === 409) explanation = tr('conflict')
  else if (status >= 500) explanation = tr('serverFailure')
  else if (/^(Failed to fetch|NetworkError when attempting to fetch resource\.?|Load failed)$/i.test(raw)) explanation = tr('networkFailure')
  else explanation = tr('unknownFailure')
  const parts = [tr(`${operation}Failed`), explanation]
  // A returned error is not proof a mutation failed. Recovery always asks for a refresh first.
  if (operation === 'publish') parts.push(tr(status === 409 ? 'publishConflictRecovery' : 'publishRecovery'))
  if (operation === 'submit') parts.push(tr('submitRecovery'))
  if (operation === 'decision') parts.push(tr('decisionRecovery'))
  if (raw && !knownApiErrors[raw] && !/^unauthorized$|^Request failed \(\d+\)$|^Failed to fetch$|^NetworkError when attempting to fetch resource\.?$|^Load failed$/i.test(raw)) parts.push(`${tr(status ? 'serverDetail' : 'technicalDetail')}${locale === 'zh' ? '' : ' '}${raw}`)
  return parts.join(' ')
}
