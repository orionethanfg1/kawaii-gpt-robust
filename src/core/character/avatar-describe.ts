/**
 * Derive a visual description from the avatar image when possible.
 * Uses OpenRouter vision if a key is available; otherwise a stable placeholder
 * that still locks identity to the avatar.
 */

export async function describeAvatarFromDataUrl(
  dataUrl: string,
  opts?: {
    apiKey?: string
    baseUrl?: string
    model?: string
    characterName?: string
  }
): Promise<{ description: string; source: 'vision' | 'fallback' }> {
  const key = (opts?.apiKey || '').trim()
  const name = opts?.characterName || 'el personaje'

  if (key.length >= 8) {
    try {
      const base = (opts?.baseUrl || 'https://openrouter.ai/api/v1').replace(/\/$/, '')
      // Free-friendly vision models on OpenRouter (may rotate)
      const models = [
        opts?.model,
        'google/gemini-2.0-flash-exp:free',
        'google/gemini-flash-1.5:free',
        'openrouter/free'
      ].filter(Boolean) as string[]

      let lastErr = ''
      for (const model of models) {
        try {
          const res = await fetch(`${base}/chat/completions`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${key}`,
              'HTTP-Referer': 'https://kawaii-gpt.local',
              'X-Title': 'KawaiiGPT Robust'
            },
            body: JSON.stringify({
              model,
              max_tokens: 220,
              messages: [
                {
                  role: 'user',
                  content: [
                    {
                      type: 'text',
                      text:
                        `Describe en español, en 2-4 frases, la apariencia física del personaje de este avatar (cabello, ojos, piel, ropa, expresión, estilo artístico). ` +
                        `Sé concreto y estable; no digas que es una IA ni una foto real. Personaje: ${name}.`
                    },
                    { type: 'image_url', image_url: { url: dataUrl } }
                  ]
                }
              ]
            })
          })
          if (!res.ok) {
            lastErr = await res.text()
            continue
          }
          const data = (await res.json()) as {
            choices?: Array<{ message?: { content?: string } }>
          }
          const text = data.choices?.[0]?.message?.content?.trim()
          if (text && text.length > 20) {
            return { description: text.slice(0, 600), source: 'vision' }
          }
        } catch (e) {
          lastErr = e instanceof Error ? e.message : String(e)
        }
      }
      console.warn('[avatar-describe] vision failed', lastErr.slice(0, 120))
    } catch {
      /* fall through */
    }
  }

  return {
    description:
      `Aspecto definido por el avatar de imagen configurado para ${name}: retrato de personaje con rasgos coherentes con esa imagen (cabello, ojos, expresión y estilo visual del avatar). Mantén siempre el mismo look.`,
    source: 'fallback'
  }
}
