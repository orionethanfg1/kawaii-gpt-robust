export type ImageProvider = 'pollinations' | 'a1111' | 'cloudflare' | 'openai' | 'smart'

type ImageProviderResult = {
  ok: boolean
  model?: string
}

type ImageGenerationFailure = {
  ok: false
  code: 'FACEID_UNAVAILABLE' | 'IMAGE_ALL_FAILED'
  error: string
  jobId: string
}

export async function runImageProviderSelection<T extends ImageProviderResult>(options: {
  provider?: ImageProvider
  requireFaceId?: boolean
  referenceImage?: string
  jobId: string
  sendProgress: (phase: string, percent: number, detail?: string) => void
  tryA1111: () => Promise<T>
  tryOpenAI: () => Promise<T>
  tryCloudflare: () => Promise<T>
  tryPollinations: () => Promise<T>
}): Promise<T | ImageGenerationFailure | (T & { model: string })> {
  const {
    provider = 'smart',
    requireFaceId,
    referenceImage,
    jobId,
    sendProgress,
    tryA1111,
    tryOpenAI,
    tryCloudflare,
    tryPollinations
  } = options

  if (provider === 'a1111') return tryA1111()
  if (provider === 'cloudflare') {
    try {
      return await tryCloudflare()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      sendProgress('cloud', 5, 'CF falló · Pollinations…')
      const result = await tryPollinations()
      if (result.ok) {
        return {
          ...result,
          model: `${result.model || 'pollinations'} (CF: ${message.slice(0, 80)})`
        }
      }
      return result
    }
  }
  if (provider === 'openai') return tryOpenAI()
  if (provider === 'pollinations') return tryPollinations()

  if (provider === 'smart') {
    const errors: string[] = []
    try {
      return await tryA1111()
    } catch (error) {
      errors.push(`Local: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (requireFaceId && referenceImage?.startsWith('data:image/')) {
      return {
        ok: false,
        code: 'FACEID_UNAVAILABLE',
        error:
          errors[0] ||
          'Forge no pudo aplicar FaceID a la referencia; se omitieron los proveedores de texto para proteger la identidad.',
        jobId
      }
    }
    try {
      return await tryOpenAI()
    } catch (error) {
      errors.push(`OpenAI: ${error instanceof Error ? error.message : String(error)}`)
    }
    try {
      return await tryCloudflare()
    } catch (error) {
      errors.push(`Cloudflare: ${error instanceof Error ? error.message : String(error)}`)
    }
    try {
      sendProgress('cloud', 5, 'Último recurso · Pollinations Flux…')
      const result = await tryPollinations()
      if (result.ok) {
        return {
          ...result,
          model: `${result.model || 'pollinations'} (fallback; ${errors.join(' | ')})`.slice(
            0,
            200
          )
        }
      }
      return result
    } catch (error) {
      errors.push(`Pollinations: ${error instanceof Error ? error.message : String(error)}`)
      return {
        ok: false,
        code: 'IMAGE_ALL_FAILED',
        error: errors.join(' · '),
        jobId
      }
    }
  }

  try {
    return await tryOpenAI()
  } catch {
    try {
      return await tryCloudflare()
    } catch {
      return tryPollinations()
    }
  }
}
