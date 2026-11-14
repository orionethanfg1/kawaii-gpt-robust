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
      json: async <T = unknown>() => ({
        choices: [{ message: { content: 'MENSAJE: Retomemos los bocetos pendientes.' } }]
      }) as T,
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

  it('uses only Ollama protocol for Ollama models', async () => {
    mockedLocalHttp.mockResolvedValue({
      ok: true,
      status: 200,
      json: async <T = unknown>() =>
        ({ message: { content: 'MENSAJE: ¿Cómo siguió tu proyecto?' } }) as T,
      text: async () => ''
    })

    const result = await generateInitiativeWithLocalLlm({
      baseUrl: 'http://127.0.0.1:11434',
      runtime: 'ollama',
      model: 'gemma3:latest',
      messages: [{ role: 'user', content: 'contexto' }]
    })

    expect(result).toBe('MENSAJE: ¿Cómo siguió tu proyecto?')
    expect(mockedLocalHttp).toHaveBeenCalledTimes(1)
    expect(mockedLocalHttp).toHaveBeenCalledWith(
      'http://127.0.0.1:11434/api/chat',
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('removes malformed UTF-16 from local initiative requests', async () => {
    mockedLocalHttp.mockResolvedValue({
      ok: true,
      status: 200,
      json: async <T = unknown>() => ({
        choices: [{ message: { content: 'MENSAJE: Hola, retomemos eso.' } }]
      }) as T,
      text: async () => ''
    })
    const malformed = `contexto${String.fromCharCode(0xd83d)}`

    await generateInitiativeWithLocalLlm({
      baseUrl: 'http://127.0.0.1:1234',
      runtime: 'openai-compatible',
      model: 'google/gemma-4',
      messages: [{ role: 'user', content: malformed }]
    })

    const request = mockedLocalHttp.mock.calls[0]?.[1]
    expect(request?.body).toBeDefined()
    const payload = JSON.parse(request?.body || '{}') as {
      messages: Array<{ content: string }>
    }
    expect(payload.messages[0]?.content).toBe('contexto')
  })

  it('does not cross-fallback between provider protocols', async () => {
    mockedLocalHttp.mockResolvedValue({
      ok: false,
      status: 404,
      json: async <T = unknown>() => ({}) as T,
      text: async () => ''
    })

    const result = await generateInitiativeWithLocalLlm({
      baseUrl: 'http://127.0.0.1:1234/v1',
      runtime: 'openai-compatible',
      model: 'google/gemma-4',
      messages: [{ role: 'user', content: 'contexto' }]
    })

    expect(result).toBeNull()
    expect(mockedLocalHttp).toHaveBeenCalledTimes(1)
    expect(mockedLocalHttp).toHaveBeenCalledWith(
      'http://127.0.0.1:1234/v1/chat/completions',
      expect.any(Object)
    )
  })
})
