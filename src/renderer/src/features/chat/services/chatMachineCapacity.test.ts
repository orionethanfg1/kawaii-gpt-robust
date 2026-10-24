import { describe, expect, it } from 'vitest'
import { parseChatMachineCapacity } from './chatMachineCapacity'

describe('chat machine capacity', () => {
  it('reads only finite positive RAM and VRAM values from a stored profile', () => {
    expect(
      parseChatMachineCapacity({ totalMemoryGB: 64, vramGB: 12 })
    ).toEqual({ ramGB: 64, vramGB: 12 })
    expect(parseChatMachineCapacity({ totalMemoryGB: 0, vramGB: -1 })).toBeNull()
    expect(parseChatMachineCapacity({ totalMemoryGB: Infinity })).toBeNull()
    expect(parseChatMachineCapacity(null)).toBeNull()
  })

  it('does not mistake unrelated IPC wrapper fields for machine capacity', () => {
    expect(
      parseChatMachineCapacity({ profile: { totalMemoryGB: 64, vramGB: 12 } })
    ).toBeNull()
  })
})
