import { describe, expect, it } from 'vitest'
import {
  markAssistantStreamDone,
  getAssistantStreamDoneAt,
  _resetAssistantStreamDoneMap
} from './turn-initiative-hooks'

describe('turn-initiative-hooks X7', () => {
  it('stores stream done timestamp', () => {
    _resetAssistantStreamDoneMap()
    markAssistantStreamDone('c1', 1000)
    expect(getAssistantStreamDoneAt('c1')).toBe(1000)
    expect(getAssistantStreamDoneAt('other')).toBe(0)
  })
})
