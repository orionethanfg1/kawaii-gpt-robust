/**
 * Smoke E2E — requires app built + playwright.
 * Skip in CI if KAWAII_E2E is not set.
 *
 * Run: KAWAII_E2E=1 KAWAII_E2E_URL=http://localhost:5173 npx playwright test tests/e2e/smoke.spec.ts
 */
import { test, expect } from '@playwright/test'

const enabled = process.env.KAWAII_E2E === '1'
const url = process.env.KAWAII_E2E_URL || 'http://localhost:5173'

test.describe('KawaiiGPT smoke', () => {
  test.skip(!enabled, 'Set KAWAII_E2E=1 to run against a live Electron/Vite app')

  test('shell loads body', async ({ page }) => {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20_000 })
    await expect(page.locator('body')).toBeVisible()
  })

  test('chat input or wizard is present', async ({ page }) => {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20_000 })
    const wizard = page.getByRole('button', { name: /Empezar configuración|Empezar/i })
    const input = page.locator('textarea, input[placeholder*="Escribe"], [data-primary-send]')
    const any = wizard.or(input.first())
    await expect(any.first()).toBeVisible({ timeout: 15_000 })
  })

  test('no fatal renderer banner', async ({ page }) => {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20_000 })
    const fatal = page.getByText(/Something went wrong|ErrorBoundary|Cannot read propert/i)
    await expect(fatal).toHaveCount(0)
  })
})
