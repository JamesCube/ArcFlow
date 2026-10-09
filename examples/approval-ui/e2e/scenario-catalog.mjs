import { expect } from '@playwright/test'

// Match the combined backend's stable full-ID order, including the ERP prefix.
// UI selectors are explicit because the sealUse wire type is not its field prefix.
export const SCENARIO_CARDS = [
  { id: 'crm-contract', documentType: 'contractApproval', prefix: 'contract' },
  { id: 'erp-payment', documentType: 'paymentRequest', prefix: 'payment' },
  { id: 'erp-receiving', documentType: 'receiving', prefix: 'receiving' },
  { id: 'oa-expense', documentType: 'expense', prefix: 'expense' },
  { id: 'oa-seal-use', documentType: 'sealUse', prefix: 'seal' },
  { id: 'oa-travel', documentType: 'travel', prefix: 'travel' },
]

export function expectUnifiedCatalog(catalog) {
  expect(catalog.map(entry => entry.id)).toEqual(SCENARIO_CARDS.map(entry => entry.id))
  for (const { id, documentType } of SCENARIO_CARDS) {
    expect(catalog.find(entry => entry.id === id)).toMatchObject({ id, documentType, documentVersion: 1, formVersion: 1 })
  }
}

export async function expectCatalogCards(page, catalog, locale) {
  await expect(page.locator('.sf-template-card')).toHaveCount(SCENARIO_CARDS.length)
  for (const { id, prefix } of SCENARIO_CARDS) {
    const card = page.locator('.sf-template-card').filter({ has: page.getByTestId(`open-${prefix}`) })
    await expect(card.locator('.sf-template-info h2')).toHaveText(catalog.find(entry => entry.id === id).title[locale])
    await expect(card.getByTestId(`open-${prefix}`)).toBeVisible()
  }
}
