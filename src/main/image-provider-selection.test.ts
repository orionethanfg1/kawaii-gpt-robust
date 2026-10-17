import { describe, expect, it, vi } from 'vitest'
import { runImageProviderSelection } from './image-provider-selection'

const success = (model: string) => async () => ({ ok: true, model })
const failure = (message: string) => async (): Promise<never> => {
  throw new Error(message)
}

describe('image provider selection', () => {
  it('protects requested identity when the local FaceID path fails', async () => {
    const tryOpenAI = vi.fn(success('openai'))
    const result = await runImageProviderSelection({
      provider: 'smart',
      requireFaceId: true,
      referenceImage: 'data:image/png;base64,abc',
      jobId: 'job-1',
      sendProgress: vi.fn(),
      tryA1111: failure('FaceID unavailable'),
      tryOpenAI,
      tryCloudflare: success('cloudflare'),
      tryPollinations: success('pollinations')
    })

    expect(result).toMatchObject({
      ok: false,
      code: 'FACEID_UNAVAILABLE',
      jobId: 'job-1',
      error: 'Local: FaceID unavailable'
    })
    expect(tryOpenAI).not.toHaveBeenCalled()
  })

  it('tries local, OpenAI, Cloudflare, then Pollinations in smart mode', async () => {
    const calls: string[] = []
    const result = await runImageProviderSelection({
      provider: 'smart',
      jobId: 'job-2',
      sendProgress: vi.fn(),
      tryA1111: async () => {
        calls.push('local')
        throw new Error('local offline')
      },
      tryOpenAI: async () => {
        calls.push('openai')
        throw new Error('no key')
      },
      tryCloudflare: async () => {
        calls.push('cloudflare')
        throw new Error('no credentials')
      },
      tryPollinations: async () => {
        calls.push('pollinations')
        return { ok: true, model: 'flux' }
      }
    })

    expect(calls).toEqual(['local', 'openai', 'cloudflare', 'pollinations'])
    expect(result).toMatchObject({ ok: true, model: 'flux (fallback; Local: local offline | OpenAI: no key | Cloudflare: no credentials)' })
  })

  it('uses Pollinations when an explicitly selected Cloudflare provider fails', async () => {
    const sendProgress = vi.fn()
    const result = await runImageProviderSelection({
      provider: 'cloudflare',
      jobId: 'job-3',
      sendProgress,
      tryA1111: success('local'),
      tryOpenAI: success('openai'),
      tryCloudflare: failure('bad credentials'),
      tryPollinations: success('flux')
    })

    expect(result).toMatchObject({
      ok: true,
      model: 'flux (CF: bad credentials)'
    })
    expect(sendProgress).toHaveBeenCalledWith('cloud', 5, 'CF falló · Pollinations…')
  })
})
