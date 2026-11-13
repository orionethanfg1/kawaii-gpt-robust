import { beforeEach, describe, expect, it, vi } from 'vitest'

const fakeStore = vi.hoisted(() => ({
  settings: {
    assistantMemory: {
      preferredNames: [],
      rejectedNames: [],
      growthNotes: [],
      likes: [],
      favorites: [],
      dislikes: [],
      habits: [],
      boundaries: [],
      voiceNotes: [],
      relational: []
    } as Record<string, unknown>,
    assistantMemoryTurnReceipts: [] as string[]
  },
  patches: [] as Array<Record<string, unknown>>
}))

vi.mock('@shared/lib/stores/settingsStore', () => ({
  useSettingsStore: {
    getState: () => ({
      settings: fakeStore.settings,
      update: (patch: Record<string, unknown>) => {
        fakeStore.patches.push(patch)
        fakeStore.settings = { ...fakeStore.settings, ...patch }
        try {
          localStorage.setItem(
            'kawaii-settings-v2',
            JSON.stringify({ state: { settings: fakeStore.settings } })
          )
        } catch {
          // Mirrors the production storage adapter, which contains quota errors.
        }
      }
    })
  }
}))

class TestStorage implements Storage {
  private readonly values = new Map<string, string>()
  failWrites = false
  get length(): number {
    return this.values.size
  }
  clear(): void {
    this.values.clear()
  }
  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }
  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null
  }
  removeItem(key: string): void {
    this.values.delete(key)
  }
  setItem(key: string, value: string): void {
    if (this.failWrites) throw new DOMException('Quota exceeded', 'QuotaExceededError')
    this.values.set(key, String(value))
  }
}

describe('assistant memory turn receipt persistence', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', new TestStorage())
    fakeStore.settings = {
      assistantMemory: {
        preferredNames: [],
        rejectedNames: [],
        growthNotes: [],
        likes: [],
        favorites: [],
        dislikes: [],
        habits: [],
        boundaries: [],
        voiceNotes: [],
        relational: []
      },
      assistantMemoryTurnReceipts: []
    }
    fakeStore.patches = []
  })

  it('commits memory and its idempotency receipt in the same settings update', async () => {
    const { forcePersistAssistantMemory } = await import('./assistantMemoryCollector')
    const receipt = 'assistant-memory:v1:conversation-1:turn-1'

    expect(
      forcePersistAssistantMemory(
        {
          ...fakeStore.settings.assistantMemory,
          likes: ['el café de olla']
        } as never,
        receipt
      )
    ).toBe(true)

    expect(fakeStore.patches).toHaveLength(1)
    expect(fakeStore.patches[0]).toHaveProperty('assistantMemory')
    expect(fakeStore.patches[0]).toHaveProperty('assistantMemoryTurnReceipts', [receipt])
    const persisted = JSON.parse(localStorage.getItem('kawaii-settings-v2') || '{}')
    expect(persisted.state.settings.assistantMemory.likes).toEqual(['el café de olla'])
    expect(persisted.state.settings.assistantMemoryTurnReceipts).toEqual([receipt])
  })

  it('reports failure when settings persistence cannot be read back', async () => {
    const { persistAssistantMemoryTurnReceipt } = await import('./assistantMemoryCollector')
    ;(localStorage as TestStorage).failWrites = true

    expect(persistAssistantMemoryTurnReceipt('assistant-memory:v1:conversation-1:turn-2')).toBe(
      false
    )
  })

  it('does not collect the same completed turn twice', async () => {
    const { runAssistantMemoryCollector } = await import('./assistantMemoryCollector')
    const options = {
      userText: '¿Qué te gusta tomar?',
      turnReceipt: 'assistant-memory:v1:conversation-1:turn-3'
    }

    const first = runAssistantMemoryCollector('Me gusta el café de olla por las mañanas.', options)
    const second = runAssistantMemoryCollector('Me gusta el café de olla por las mañanas.', options)

    expect(first?.changed).toBe(true)
    expect(first?.persisted).toBe(true)
    expect(second).toBeNull()
    expect(fakeStore.settings.assistantMemoryTurnReceipts).toEqual([options.turnReceipt])
    expect(fakeStore.patches).toHaveLength(1)
  })
})
