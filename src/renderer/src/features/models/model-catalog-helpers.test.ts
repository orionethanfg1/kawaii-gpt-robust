/**
 * UI logic tests for model catalog filters (no React mount required).
 */
import { describe, it, expect } from 'vitest'
import {
  filterCatalogRows,
  mergeCatalogSources,
  matchesInstallFilter,
  isNameInstalled
} from './model-catalog-helpers'

describe('model-catalog UI helpers', () => {
  const rows = [
    {
      key: '1',
      pullName: 'qwen2.5:7b',
      label: 'Qwen 7B',
      installed: true,
      source: 'ollama'
    },
    {
      key: '2',
      pullName: 'qwen/qwen3.8-27b',
      label: 'Qwen3.8 27B',
      installed: true,
      source: 'openai-compatible'
    },
    {
      key: '3',
      pullName: 'llama3.2:3b',
      label: 'Llama 3.2',
      installed: false,
      source: 'ollama-library'
    }
  ]

  it('filters installed only', () => {
    const f = filterCatalogRows(rows, { installFilter: 'installed' })
    expect(f).toHaveLength(2)
    expect(f.every((r) => r.installed)).toBe(true)
  })

  it('filters not-installed only', () => {
    const f = filterCatalogRows(rows, { installFilter: 'not-installed' })
    expect(f).toHaveLength(1)
    expect(f[0].pullName).toBe('llama3.2:3b')
  })

  it('filters by query across label and pullName', () => {
    const f = filterCatalogRows(rows, { query: '27b', installFilter: 'all' })
    expect(f).toHaveLength(1)
    expect(f[0].pullName).toContain('27b')
  })

  it('matchesInstallFilter edge cases', () => {
    expect(matchesInstallFilter({ installed: true }, 'all')).toBe(true)
    expect(matchesInstallFilter({ installed: false }, 'installed')).toBe(false)
  })

  it('mergeCatalogSources puts installed first and dedupes', () => {
    const merged = mergeCatalogSources(
      [
        { id: 'qwen2.5:7b', source: 'ollama' },
        { id: 'qwen/qwen3.8-27b', source: 'openai-compatible' }
      ],
      [
        {
          id: 'r1',
          pullName: 'qwen2.5:7b',
          label: 'dup',
          source: 'ollama-library'
        },
        {
          id: 'r2',
          pullName: 'mistral:7b',
          label: 'Mistral',
          source: 'ollama-library'
        }
      ]
    )
    expect(merged[0].installed).toBe(true)
    expect(merged.some((m) => m.pullName === 'mistral:7b' && !m.installed)).toBe(true)
    expect(merged.filter((m) => m.pullName === 'qwen2.5:7b')).toHaveLength(1)
  })

  it('isNameInstalled fuzzy match', () => {
    expect(isNameInstalled('qwen2.5:7b', ['qwen2.5:7b-instruct'])).toBe(true)
    expect(isNameInstalled('nope', ['qwen2.5:7b'])).toBe(false)
  })
})
