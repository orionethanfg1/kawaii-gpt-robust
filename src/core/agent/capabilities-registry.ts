/**
 * App capabilities exposed to the chat as "plugins" / tools.
 * Keep in sync when adding executeAppTool cases or host commands.
 */
export type CapabilityPlugin = {
  id: string
  title: string
  category: 'chat' | 'modelos' | 'imagen' | 'audio' | 'sistema' | 'diagnostico' | 'archivos'
  summary: string
  /** Host tool names (executeAppTool) when applicable */
  tools?: string[]
  /** Example user phrases */
  phrases?: string[]
  /** true = runs on host without needing cloud */
  host?: boolean
}

export const CAPABILITY_PLUGINS: CapabilityPlugin[] = [
  {
    id: 'chat-hybrid',
    title: 'Chat híbrido local/cloud',
    category: 'chat',
    summary: 'Conversación con Ollama, LM Studio y/o cloud; failover y preferencia local.',
    phrases: ['hablar', 'chat']
  },
  {
    id: 'vision',
    title: 'Visión / fotos',
    category: 'archivos',
    summary:
      'Analiza fotos del chat; compara con galería multi-imagen del avatar para saber si eres tú en otra escena.',
    phrases: ['qué hay en la foto', '¿eres tú?']
  },
  {
    id: 'docs-text',
    title: 'Documentos de texto',
    category: 'archivos',
    summary: 'Lee .txt, .md, .json, código, etc. (aún no .docx/.pdf nativos).',
    phrases: ['lee este archivo']
  },
  {
    id: 'status-runtime',
    title: 'Estado Ollama / LM Studio / app',
    category: 'diagnostico',
    summary: 'Informe real del host (tablas), sin inventar inventarios.',
    tools: ['get_app_status', 'list_installed_models', 'check_local_runtime', 'run_diagnosis'],
    phrases: ['revisa Ollama', 'estado de LM Studio', 'estado de la app'],
    host: true
  },
  {
    id: 'models-smart',
    title: 'Modelos inteligentes',
    category: 'modelos',
    summary: 'Escaneo, scores, Auto por tarea (chat/visión/código), unload antes de Forge.',
    tools: ['scan_local_models', 'list_model_scores', 'auto_route_model', 'recommend_model', 'set_active_model'],
    phrases: ['rescanea modelos', 'recomienda modelo'],
    host: true
  },
  {
    id: 'forge-image',
    title: 'Imagen (Forge)',
    category: 'imagen',
    summary: 'Generación local, FaceID, ControlNet, autorretratos con identidad.',
    tools: ['start_forge', 'stop_forge', 'health_forge', 'probe_forge', 'ensure_faceid', 'check_faceid', 'ensure_controlnet', 'assess_image_stack', 'preview_scene'],
    phrases: ['arranca Forge', 'instala FaceID', 'foto tuya'],
    host: true
  },
  {
    id: 'music',
    title: 'Música (ACE)',
    category: 'audio',
    summary: 'Capa de música on-demand.',
    tools: ['start_music', 'stop_music'],
    phrases: ['pon música'],
    host: true
  },
  {
    id: 'voice',
    title: 'Voz TTS',
    category: 'audio',
    summary: 'Síntesis de voz edge-tts.',
    tools: ['voice_ensure'],
    phrases: ['prepara voz'],
    host: true
  },
  {
    id: 'logs-clean',
    title: 'Logs e informes',
    category: 'sistema',
    summary: 'Listar/limpiar logs e informes exportados.',
    tools: ['list_app_logs', 'clear_app_logs', 'clean_diagnostics_exports'],
    phrases: ['limpia informes exportados'],
    host: true
  },
  {
    id: 'host-commands',
    title: 'Catálogo de comandos host',
    category: 'sistema',
    summary: 'Lista frases cortas que la app ejecuta sin cloud.',
    tools: ['list_host_commands'],
    phrases: ['qué puedes hacer', 'comandos útiles', 'lista de capacidades'],
    host: true
  },
  {
    id: 'web-search',
    title: 'Búsqueda web',
    category: 'sistema',
    summary: 'Tool host web_search: Wikipedia, SearX, DDG, Bing. Pie web:N hits.',
    tools: ['web_search'],
    phrases: ['busca en la web', 'buscar en internet'],
    host: true
  },
  {
    id: 'face-score',
    title: 'Score facial / identidad',
    category: 'imagen',
    summary: 'Plugin Python face_similarity para rankear batch vs avatar.',
    tools: ['score_face_match'],
    phrases: ['compara cara', 'score face'],
    host: true
  },
  {
    id: 'identity-match',
    title: 'Identity match (pre + post)',
    category: 'imagen',
    summary: 'E4: analyze_identity_refs + score_identity_match. InsightFace opcional.',
    tools: ['analyze_identity_refs', 'score_identity_match'],
    phrases: ['analiza refs', 'score identidad'],
    host: true
  }

]

export function formatCapabilitiesForChat(): string {
  const byCat = new Map<string, CapabilityPlugin[]>()
  for (const p of CAPABILITY_PLUGINS) {
    const list = byCat.get(p.category) || []
    list.push(p)
    byCat.set(p.category, list)
  }
  const lines = [
    '**Capacidades de la app (plugins / herramientas)**',
    '',
    'Puedo usar estas capacidades en el host o en el chat. Las marcadas *host* no inventan datos: leen tu máquina.',
    ''
  ]
  for (const [cat, plugs] of byCat) {
    lines.push(`### ${cat}`)
    for (const p of plugs) {
      const host = p.host ? ' · *host*' : ''
      lines.push(`- **${p.title}**${host}: ${p.summary}`)
      if (p.phrases?.length) {
        lines.push(`  - Ej.: ${p.phrases.map((x) => `«${x}»`).join(', ')}`)
      }
    }
    lines.push('')
  }
  lines.push('_Si agregamos herramientas nuevas, aparecerán aquí automáticamente._')
  return lines.join('\n')
}

export function listAllToolNames(): string[] {
  const s = new Set<string>()
  for (const p of CAPABILITY_PLUGINS) {
    for (const t of p.tools || []) s.add(t)
  }
  return [...s].sort()
}
