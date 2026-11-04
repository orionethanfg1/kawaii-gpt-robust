import { describe, it, expect } from 'vitest'
import { LOCAL_OPENAI_CANDIDATES } from './local-runtime-probe'

describe('local-runtime-probe', () => {
  it('exposes common desktop ports', () => {
    expect(LOCAL_OPENAI_CANDIDATES.some((c) => c.baseUrl.includes('1234'))).toBe(true)
    expect(LOCAL_OPENAI_CANDIDATES.some((c) => c.baseUrl.includes('8080'))).toBe(true)
  })
})
