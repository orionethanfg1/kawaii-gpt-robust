/**
 * Smoke E2E — requires app built + playwright.
 * Skip in CI if KAWAII_E2E is not set.
 *
 * Run: KAWAII_E2E=1 npx playwright test tests/e2e/smoke.spec.ts
 */
import { test, expect } from '@playwright/test'

const enabled = process.env.KAWAII_E2E === '1'

test.describe('KawaiiGPT smoke', () => {
  test.skip(!enabled, 'Set KAWAII_E2E=1 to run against a live Electron/Vite app')

  test('renderer health placeholder', async ({ page }) => {
    // When KAWAII_E2E_URL is set (e.g. http://localhost:5173), check shell loads
    const url = process.env.KAWAII_E2E_URL || 'http://localhost:5173'
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15_000 })
    await expect(page.locator('body')).toBeVisible()
  })
})
