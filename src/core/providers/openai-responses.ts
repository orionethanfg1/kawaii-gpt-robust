import { OpenAICompatibleProvider } from './openai-compatible'

/** Official OpenAI host detection */
export function isOfficialOpenAI(baseUrl: string): boolean {
  return /api\.openai\.com/i.test(baseUrl || '')
}

/** Prefer chat completions path via compatible provider; Responses API can be layered later. */
export class OpenAIResponsesProvider extends OpenAICompatibleProvider {
  constructor(opts: {
    id?: string
    displayName?: string
    baseUrl?: string
    apiKey?: string
    timeoutMs?: number
  }) {
    super({
      id: opts.id || 'openai',
      displayName: opts.displayName || 'OpenAI',
      baseUrl: opts.baseUrl || 'https://api.openai.com/v1',
      apiKey: opts.apiKey,
      timeoutMs: opts.timeoutMs
    })
  }
}
