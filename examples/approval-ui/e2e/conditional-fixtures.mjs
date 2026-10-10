import { paymentFixture, contractFixture, receivingFixture } from '../src/scenarios/scenario-fixtures.js'

// Fictional business records. Randomness is confined to references for isolation;
// titles and review comments read like ordinary work, in the capture's language.
export function businessFor(prefix, locale, variant, suffix) {
  const zh = locale === 'zh', reference = `${prefix.toUpperCase()}-${variant.toUpperCase()}-${locale.toUpperCase()}-${suffix}`
  if (prefix === 'payment') {
    const business = paymentFixture({ businessId: reference,
      title: zh ? (variant === 'high' ? '装配线零部件尾款申请' : variant === 'old' ? '包装材料补货款申请' : '车间耗材结算申请') : (variant === 'high' ? 'Assembly line component balance' : variant === 'old' ? 'Packaging replenishment payment' : 'Workshop supplies settlement'),
      reason: zh ? '按已验收数量核对发票与质量扣款，申请结算本期供应款项。' : 'Settle this delivery after checking accepted quantities, invoice allocations and quality deductions.',
      supplierRef: 'SUP-2048', requestedPaymentOn: '2026-10-20' })
    Object.assign(business.lines[0], { invoiceRef: 'INV-2026-1041', description: zh ? '装配线安装支架' : 'Assembly line mounting brackets', deductionReason: zh ? '扣除两件变形支架的返修费用。' : 'Deduct the rework cost for two bent brackets.' })
    Object.assign(business.lines[1], { invoiceRef: 'INV-2026-1042', description: zh ? '车间防护包装材料' : 'Protective workshop packaging' })
    if (variant === 'high') { Object.assign(business.lines[0], { allocationAmount: '6000', deductionAmount: '0', deductionReason: '' }); business.lines[1].allocationAmount = '4000' }
    return business
  }
  if (prefix === 'receiving') {
    const business = receivingFixture({ businessId: reference,
      title: zh ? (variant === 'clean' ? '仓库防护材料到货验收' : variant === 'rejected' ? '安装支架破损批次验收' : '装配线支架到货验收') : (variant === 'clean' ? 'Protective materials goods receipt' : variant === 'rejected' ? 'Damaged mounting bracket delivery' : 'Assembly line bracket receipt'),
      reason: zh ? '核对采购订单与实际到货，记录质检结果和不合格品处理意见。' : 'Reconcile the purchase order with delivered quantities and record inspection findings.', purchaseOrderRef: 'PO-2026-1048' })
    Object.assign(business.lines[0], { orderLineRef: 'PO-2026-1048-10', description: zh ? '装配线安装支架' : 'Assembly line mounting brackets', exceptionReason: zh ? '两件支架变形，已隔离并要求供应商补发。' : 'Two brackets are bent. Set them aside and request replacements.' })
    Object.assign(business.lines[1], { orderLineRef: 'PO-2026-1048-20', description: zh ? '防护包装材料' : 'Protective packaging' })
    if (variant === 'clean') Object.assign(business.lines[0], { accepted: 80, rejected: 0, exceptionReason: '' })
    return business
  }
  return contractFixture({ businessId: reference,
    title: zh ? (variant === 'standard' ? '设备巡检年度服务合同' : '产线改造项目交付合同') : (variant === 'standard' ? 'Annual equipment inspection agreement' : 'Production line upgrade delivery agreement'),
    reason: zh ? '核对交付范围、验收标准和分期款项后，提交内部审批。' : 'Review scope, acceptance criteria and staged fees before internal approval.',
    customerRef: 'CUS-3106', documentRef: variant === 'standard' ? 'CTR-2026-028' : 'CTR-2026-027', startOn: '2026-11-01', endOn: '2027-10-31',
    termsKind: variant === 'standard' ? 'STANDARD' : 'NONSTANDARD',
    deviationReason: variant === 'standard' ? '' : zh ? '客户要求将责任上限提高至合同金额的两倍，需商务与法务共同确认。' : 'The customer requests a liability cap of twice the contract value. Commercial and legal approval are required.',
    lines: [
      { lineId: 'contract-line-1', milestoneRef: 'M1', description: zh ? '方案评审' : 'Solution review', dueOn: '2026-11-15', amount: '30000.00', acceptanceCriteria: zh ? '双方确认实施方案与交付清单。' : 'Both parties confirm the implementation plan and deliverables.' },
      { lineId: 'contract-line-2', milestoneRef: 'M2', description: zh ? '现场交付' : 'On-site delivery', dueOn: '2027-04-30', amount: '40000.00', acceptanceCriteria: zh ? '完成安装调试并签署阶段验收记录。' : 'Complete installation and commissioning, with stage acceptance recorded.' },
      { lineId: 'contract-line-3', milestoneRef: 'M3', description: zh ? '最终验收' : 'Final acceptance', dueOn: '2027-10-15', amount: '30000.00', acceptanceCriteria: zh ? '遗留问题关闭，提交完整验收材料。' : 'Close outstanding issues and submit the final acceptance record.' },
    ] })
}

export const processNames = {
  payment: { en: ['Supplier payment review', 'Joint payment check', 'Final payment review'], zh: ['供应商付款审批', '财务与采购会签', '付款复核'] },
  receiving: { en: ['Goods receipt review', 'Warehouse and quality inspection', 'Procurement review'], zh: ['采购收货审批', '仓库与质量会签', '采购复核'] },
  contract: { en: ['Contract approval', 'Commercial review', 'Commercial and legal review'], zh: ['合同审批', '商务初审', '商务与法务会签'] },
}
export const comments = {
  paymentFirst: { en: 'Invoice allocations match the accepted delivery. No further deduction is required.', zh: '发票分配与已验收货物一致，无需追加扣款。' },
  paymentSecond: { en: 'Supplier balance and remaining invoice amounts checked.', zh: '已核对供应商余额及发票剩余可分配金额。' },
  paymentFinal: { en: 'The requested settlement amount is within the approved monthly budget.', zh: '本次申请结算金额在本月已批准预算内。' },
  receivingFirst: { en: 'Received quantities checked. The two damaged brackets have been isolated.', zh: '已核实收货数量，两件变形支架已隔离。' },
  receivingSecond: { en: 'Inspection is complete. Accept the conforming goods and replace the two damaged brackets.', zh: '质检完成，合格品可接收，两件不合格支架安排补发。' },
  receivingFinal: { en: 'Supplier replacement has been agreed. The receipt can be recorded.', zh: '已与供应商确认补发安排，可完成本次验收。' },
  receivingReject: { en: 'Damage affects the mounting surface. Return this batch for replacement.', zh: '破损影响安装接触面，该批次退回并要求更换。' },
  receivingClean: { en: 'All delivered quantities passed inspection and match the purchase order.', zh: '本批到货全部检验合格，与采购订单一致。' },
  contractCommercial: { en: 'Delivery scope, milestone amounts and acceptance responsibilities are confirmed.', zh: '交付范围、里程碑金额与验收责任已确认。' },
  contractFirst: { en: 'The revised liability cap is supported by the project margin and delivery plan.', zh: '项目毛利与交付计划可以覆盖调整后的责任上限。' },
  contractSecond: { en: 'The exception is acceptable with the agreed scope and acceptance clauses.', zh: '结合已确认的范围与验收条款，同意本次非标约定。' },
}
