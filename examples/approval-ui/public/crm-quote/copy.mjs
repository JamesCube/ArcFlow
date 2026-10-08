export const copy = {
  zh: {
    title: '报价折扣审批', subtitle: '本地合成案例 · 固定两步人工审批', scope: '使用演示客户 A 的合成报价。审批通过后，发信、签约和更新 CRM 仍需另行处理。',
    signIn: '登录演示账号', username: '账号', password: '密码', login: '登录', logout: '退出', refresh: '更新列表',
    roles: 'Alice 发起报价申请；Bob 作为销售经理审核；Carol 作为财务复核。角色对应预设账号。',
    source: '报价来源', choose: '选择报价版本', reference: '报价单号', revision: '报价版本', customer: '客户引用', item: '物品或服务', quantity: '数量', listPrice: '目录单价', validUntil: '报价有效期（UTC）',
    create: '申请折扣', titleLabel: '申请标题', reason: '降价原因', requestedPrice: '申请单价', submit: '提交折扣申请',
    defaultTitle: '设备报价折扣申请', defaultReason: '十套设备的合成报价，申请单价为 CNY 850.00。',
    help: '金额按数量乘单价计算，未计税费和运费。同一报价版本只绑定一笔申请；修改报价后请用新版本提交。',
    listTotal: '目录总额', requestedTotal: '申请总额', reductionTotal: '减少金额', discount: '折扣率', requests: '报价审批记录', empty: '目前没有你可查看的报价申请。',
    approve: '同意', reject: '驳回', comment: '审批意见（选填）', pending: '审批中', approved: '已通过', rejected: '已驳回',
    updated: '报价已更新，请重新提交审批。此记录仅适用于提交时的报价版本。', expired: '报价有效期已过，请人工核对后再处理。',
    rule: '金额核对：按提交内容整理；达到示例阈值 10% 时仅作提示，不改变审批步骤。', notConnected: '尚未接入预算、历史价格或 CRM 回写。',
    readonly: '窄屏仅查看和审批。请在桌面窗口发起报价申请。', loading: '正在更新…', saved: '申请已保存。', decisionSaved: '审批意见已保存。',
    uncertain: '暂时无法确认操作是否成功。先更新列表，查看已保存的状态。', error: '暂时无法读取数据。请更新列表后再处理。',
    conflict: '报价版本、申请内容或审批状态已变化。请核对更新后的记录。', forbidden: '当前账号无权执行此操作。请核对报价归属与审批人。', invalid: '提交内容未通过校验，请核对金额和报价字段。', loginError: '无法登录，请检查账号和密码。', price: '单价须大于 0、不超过 1,000,000,000，最多保留两位小数。', jpy: '日元单价请填写整数。', discountError: '申请单价须低于目录单价。', text: '请填写标题和降价原因。',
    awaiting: '当前步骤', submittedBy: '申请人', process: '审批流程', ruleLabel: '规则核对', quoteSource: '来源：本地预设报价版本；客户名称为“演示客户 A”。'
  },
  en: {
    title: 'Quote discount approval', subtitle: 'Local synthetic example · Two fixed human review steps', scope: 'This example uses a synthetic quote for Demo customer A. Approval does not send a customer message, sign a contract or update a CRM.',
    signIn: 'Sign in to the demo', username: 'Username', password: 'Password', login: 'Sign in', logout: 'Sign out', refresh: 'Refresh list',
    roles: 'Alice submits; Bob reviews as sales manager; Carol reviews as finance. These roles map to preset accounts.',
    source: 'Quote source', choose: 'Choose a quote revision', reference: 'Quote reference', revision: 'Quote revision', customer: 'Customer reference', item: 'Item or service', quantity: 'Quantity', listPrice: 'List unit price', validUntil: 'Valid until (UTC)',
    create: 'Request a discount', titleLabel: 'Request title', reason: 'Reason for discount', requestedPrice: 'Requested unit price', submit: 'Submit discount request',
    defaultTitle: 'Equipment quote discount', defaultReason: 'Synthetic quote for ten equipment sets at a requested unit price of CNY 850.00.',
    help: 'Quantity × unit price. Tax and shipping are not included. Each quote revision is bound to one request. Submit a new revision when the quote changes.',
    listTotal: 'List total', requestedTotal: 'Requested total', reductionTotal: 'Reduction', discount: 'Discount', requests: 'Quote approval records', empty: 'There are no quote requests you can view.',
    approve: 'Approve', reject: 'Reject', comment: 'Review comment (optional)', pending: 'Pending', approved: 'Approved', rejected: 'Rejected',
    updated: 'The quote has changed. Submit the new revision for approval. This record applies only to the submitted revision.', expired: 'This quote has expired. Check its validity before reviewing.',
    rule: 'Amount check: calculated from submitted fields. The example 10% threshold is informational and never changes the review steps.', notConnected: 'Budget, historical prices and CRM writeback are not connected.',
    readonly: 'Small screens support viewing and review. Use a desktop window to submit a quote request.', loading: 'Refreshing…', saved: 'Request saved.', decisionSaved: 'Your review is saved.',
    uncertain: 'The result could not be confirmed. Refresh the list to check the saved state.', error: 'Data could not be loaded. Refresh the list before reviewing.',
    conflict: 'The quote, request or review state changed. Check the refreshed record.', forbidden: 'This account cannot perform that action. Check quote ownership and the assigned reviewer.', invalid: 'The submission did not pass validation. Check the amounts and quote fields.', loginError: 'Could not sign in. Check your username and password.', price: 'Enter a price greater than zero and no more than 1,000,000,000, with up to two decimal places.', jpy: 'Enter a whole-number price for JPY.', discountError: 'Requested unit price must be below list unit price.', text: 'Enter a title and a reason for the discount.',
    awaiting: 'Current step', submittedBy: 'Applicant', process: 'Review process', ruleLabel: 'Rule check', quoteSource: 'Source: a preset local quote revision for Demo customer A.'
  }
};
