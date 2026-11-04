/**
 * Smoke tests for v0.9.31–0.9.32 surfaces: backend abstraction, cleanup, routing.
 */
import { describe, it, expect } from 'vitest'
import { decideRoute } from '@core/routing/engine'
import { canAdmit, buildLedger, estimateModelWeightGB } from '@core/resources/governor'
import { isObsoleteDiagnosticsKey, isProtectedKey } from '@core/agent/data-cleanup'
import { filterCatalogRows } from '@features/models/model-catalog-helpers'
import { APP_VERSION } from '../../src/shared/version'

describe('v0.9.32 smoke', () => {
  it('exports a semver app version', () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+/)
  })

  it('local-first routing stays local when online with local available', () => {
    const d = decideRoute({
      prompt: 'hola',
      promptLength: 4,
      hasAttachments: false,
      localAvailable: true,
      cloudAvailable: true,
      webSearchEnabled: true,
      longPromptThreshold: 1500,
      localMaxTokens: 1024,
      cloudMaxTokens: 2048,
      networkOnline: true,
      preferLocal: true
    })
    expect(d.target).toBe('local')
  })

  it('governor estimates large qwen and admits forge on free card', () => {
    expect(estimateModelWeightGB('qwen/qwen3.8-27b')).toBeGreaterThan(10)
    const ledger = buildLedger({
      ramGB: 32,
      vramGB: 16,
      hasDiscreteGpu: true,
      forgeState: 'stopped',
      musicRunning: false,
      localModel: 'qwen2.5:7b'
    })
    expect(canAdmit(ledger, { layer: 'forge', estimateGB: 6 }).ok).toBe(true)
  })

  it('smart cleanup classification', () => {
    expect(isObsoleteDiagnosticsKey('kawaii_test_runs_v1')).toBe(true)
    expect(isProtectedKey('kawaii-gpt-settings-v1')).toBe(true)
  })

  it('UI catalog filter installed', () => {
    const rows = filterCatalogRows(
      [
        { key: 'a', pullName: 'a', label: 'A', installed: true, source: 'ollama' },
        { key: 'b', pullName: 'b', label: 'B', installed: false, source: 'hf' }
      ],
      { installFilter: 'installed' }
    )
    expect(rows).toHaveLength(1)
  })
})
