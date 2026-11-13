import { beforeEach, describe, expect, it, vi } from 'vitest'
import { generateInitiativeWithLocalLlm } from './initiative'
import { localHttp } from '../providers/local-http'

vi.mock('../providers/local-http', () => ({
  localHttp: vi.fn()
}))

const mockedLocalHttp = vi.mocked(localHttp)

describe('initiative local transport', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses the local IPC HTTP helper for OpenAI-compatible requests', async () => {
    mockedLocalHttp.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: 'MENSAJE: Retomemos los bocetos pendientes.' } }]
      }),
      text: async () => ''
    })

    const result = await generateInitiativeWithLocalLlm({
      baseUrl: 'http://127.0.0.1:1234',
      model: 'google/gemma-4-26b-a4b-qat',
      messages: [{ role: 'user', content: 'contexto' }],
      timeoutMs: 18_000
    })

    expect(result).toBe('MENSAJE: Retomemos los bocetos pendientes.')
    expect(mockedLocalHttp).toHaveBeenCalledTimes(1)
    expect(mockedLocalHttp).toHaveBeenCalledWith(
      'http://127.0.0.1:1234/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        timeoutMs: 18_000,
        body: expect.stringContaining('"messages"')
      })
    )
  })
})
