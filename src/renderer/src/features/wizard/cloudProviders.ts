export interface CloudProvider {
  id: string
  name: string
  emoji: string
  tagline: string
  description: string
  baseUrl: string
  freeModel: string
  badge: string
  keyUrl: string
}

export const CLOUD_PROVIDERS: CloudProvider[] = [
  {
    id: 'openrouter',
    name: 'OpenRouter',
    emoji: '🔮',
    tagline: 'Hub multi-modelo gratis',
    description: 'Muchos modelos free (Gemini, Llama, Qwen…) en una sola key.',
    baseUrl: 'https://openrouter.ai/api/v1',
    freeModel: 'openrouter/free',
    badge: '★ Más fácil',
    keyUrl: 'https://openrouter.ai/keys'
  },
  {
    id: 'groq',
    name: 'Groq',
    emoji: '⚡',
    tagline: 'El más rápido',
    description: 'Llama 3.3 70B con latencia muy baja. Tier gratuito generoso.',
    baseUrl: 'https://api.groq.com/openai/v1',
    freeModel: 'llama-3.1-8b-instant',
    badge: '🚀 Velocidad',
    keyUrl: 'https://console.groq.com/keys'
  },
  {
    id: 'gemini',
    name: 'Google AI Studio',
    emoji: '🤖',
    tagline: 'Cuota gratis de Google',
    description: 'Gemini Flash con contexto grande. Key desde AI Studio.',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    freeModel: 'gemini-2.0-flash',
    badge: '🔭 Contexto',
    keyUrl: 'https://aistudio.google.com/app/apikey'
  },
  {
    id: 'openai',
    name: 'OpenAI',
    emoji: '🧠',
    tagline: 'API oficial',
    description: 'GPT-4o mini y familia. Requiere créditos de pago.',
    baseUrl: 'https://api.openai.com/v1',
    freeModel: 'gpt-4o-mini',
    badge: '💼 De pago',
    keyUrl: 'https://platform.openai.com/api-keys'
  }
]
