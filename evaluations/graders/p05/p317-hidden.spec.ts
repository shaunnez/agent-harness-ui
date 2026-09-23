import { test, expect, type Page } from '@playwright/test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { login } from './helpers'
import { drainConstructionPricing, importConstructionCatalogue } from './constructionPricingFixture'

const ROOT = resolve(__dirname, '../..')
const REGISTER = JSON.parse(readFileSync(resolve(ROOT, 'evidence/qcc19/cleanroom/claim_register.json'), 'utf8'))
const CATALOGUE = JSON.parse(readFileSync(resolve(ROOT, 'tests/fixtures/construction_catalogue.json'), 'utf8'))

async function api<T>(page: Page, method: string, path: string, data?: unknown, accountId?: string): Promise<T> {
  const token = await page.evaluate(() => sessionStorage.getItem('eversor_access_token'))
  const response = await page.request.fetch(`/api${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(accountId ? { 'X-Account-Id': accountId } : {}) },
    data,
  })
  expect(response.ok(), `${method} ${path}: ${response.status()} ${await response.text()}`).toBe(true)
  return response.json() as Promise<T>
}

test('Review shows withheld ambiguous and refused scenarios, then saves an explicit choice', async ({ page }) => {
  await login(page)
  const account = await api<{ id: string }>(page, 'POST', '/accounts', { name: `P317 synthetic ${Date.now()}` })
  await page.evaluate(id => sessionStorage.setItem('eversor_acting_account', id), account.id)
  const tender = await api<{ id: number }>(page, 'POST', '/tenders', {
    name: `P317 synthetic ${Date.now()}`, site_address: '1 Synthetic Road, Auckland',
  }, account.id)
  const document = structuredClone(REGISTER)
  document.corpus.reference_line = `P317 synthetic tender ${tender.id}`
  document.claims = document.claims.slice(0, 3)
  document.claims[0].claim = 'Hardfill excavation quantity is undefined.'
  document.claims[0].verification = 'UNVERIFIED'
  document.claims[1].claim = 'Contaminated hardfill excavation quantity is undefined.'
  document.claims[1].verification = 'UNVERIFIED'
  document.claims[2].claim = 'Contract particulars are incomplete.'

  const catalogue = structuredClone(CATALOGUE)
  catalogue.scenarios.push({ ...catalogue.scenarios[0], id: 'other-ground', title: 'Other ground scope' })
  const temp = mkdtempSync(join(tmpdir(), 'p317-checker-'))
  try {
    const cataloguePath = join(temp, 'catalogue.json')
    writeFileSync(cataloguePath, JSON.stringify(catalogue))
    importConstructionCatalogue(account.id, cataloguePath)
    const register = await api<{ id: number }>(page, 'POST', '/claim-registers', {
      tender_id: tender.id, origin: 'upload', label: 'P317 synthetic register', document,
    }, account.id)
    drainConstructionPricing()
    const costs = await api<{ summary: { amount: unknown }; claims: { claim_id: string; candidates?: string[]; amount: unknown }[] }>(
      page, 'GET', `/variation-costs/registers/${register.id}`, undefined, account.id,
    )
    expect(costs.summary.amount).toBeNull()
    expect(costs.claims[0].candidates).toEqual(['ground', 'other-ground'])
    expect(costs.claims[1].candidates).toEqual(['ground', 'other-ground'])

    await page.evaluate(() => localStorage.setItem('eversor_feature_flags', JSON.stringify({ variation_costs: true })))
    await page.goto(`/tender-assessment/${tender.id}/review`)
    const ambiguous = page.getByTestId(`claim-card-${document.claims[0].id}`)
    await expect(ambiguous.getByTestId(`variation-summary-${document.claims[0].id}`)).toContainText('2 scenarios fit this claim, needs review')
    await expect(ambiguous.getByText('No amount from these scenarios is included in the variation subtotal until you choose one.')).toBeVisible()
    await expect(ambiguous.getByRole('button', { name: 'Use Ground replacement' })).toBeVisible()
    const incompatible = page.getByTestId(`claim-card-${document.claims[1].id}`)
    await expect(incompatible.getByText('Ground replacement was refused.')).toBeVisible()
    await expect(incompatible.getByText('Contaminated ground', { exact: true }).first()).toBeVisible()

    await ambiguous.getByRole('button', { name: 'Use Ground replacement' }).click()
    await expect.poll(async () => {
      const after = await api<{ claims: { claim_id: string; link?: { revision: number }; estimate?: { origin: string }; amount: unknown }[] }>(
        page, 'GET', `/variation-costs/registers/${register.id}`, undefined, account.id,
      )
      const chosen = after.claims.find(row => row.claim_id === document.claims[0].id)
      return { revision: chosen?.link?.revision, origin: chosen?.estimate?.origin, hasAmount: chosen?.amount !== null }
    }).toEqual({ revision: 1, origin: 'user', hasAmount: true })
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
})
