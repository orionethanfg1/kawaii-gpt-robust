
/**
 * Useful host commands the chat can run without cloud LLM.
 * Keep phrases short so isHostOnlyToolQuery can match them.
 */
export type HostCommand = {
  id: string
  phrases: string[]
  tools: string[]
  why: string
  category: 'imagen' | 'modelos' | 'sistema' | 'diagnostico'
}

export const HOST_COMMAND_CATALOG: HostCommand[] = [
  {
    id: 'web_search',
    phrases: ['busca en la web', 'buscar en internet', 'web search', 'busca en internet'],
    tools: ['web_search'],
    why: 'Búsqueda web multi-backend',
  },
  {
    id: 'que_falta',
    phrases: ['qué falta', 'diagnóstico imagen'],
    tools: ['assess_image_stack', 'probe_forge'],
    why: 'Ver qué piezas del stack de imagen faltan',
    category: 'diagnostico'
  },
  {
    id: 'instala_faceid',
    phrases: ['instala FaceID', 'descargar faceid'],
    tools: ['ensure_faceid', 'assess_identity_stack'],
    why: 'Descargar identidad facial para autorretratos',
    category: 'imagen'
  },
  {
    id: 'instala_controlnet',
    phrases: ['instala ControlNet'],
    tools: ['ensure_controlnet'],
    why: 'Modelos openpose/canny básicos',
    category: 'imagen'
  },
  {
    id: 'revisa_forge',
    phrases: ['revisa Forge', 'probe forge'],
    tools: ['probe_forge', 'check_faceid'],
    why: 'Estado de Forge, checkpoints y FaceID',
    category: 'imagen'
  },
  {
    id: 'estado_app',
    phrases: [
      'estado de la app',
      'lista modelos',
      'revisa Ollama',
      'revisa LM Studio',
      'estado ollama',
      'cómo está Ollama'
    ],
    tools: ['get_app_status', 'list_installed_models'],
    why: 'Estado general y modelos locales (Ollama / LM Studio)',
    category: 'sistema'
  },
  {
    id: 'arranca_forge',
    phrases: ['arranca Forge', 'start forge', 'iniciar Forge'],
    tools: ['start_forge', 'health_forge'],
    why: 'Arrancar capa de imagen local (no es Ollama)',
    category: 'imagen'
  },
  {
    id: 'preview_escena',
    phrases: ['preview escena: …'],
    tools: ['preview_scene'],
    why: 'Ver tags SD de una descripción',
    category: 'imagen'
  },
  {
    id: 'limpia_exports',
    phrases: ['limpia informes exportados'],
    tools: ['clean_diagnostics_exports'],
    why: 'Borrar informes en disco',
    category: 'sistema'
  },
  {
    id: 'rescanea_modelos',
    phrases: ['rescanea modelos', 'qué modelos hay'],
    tools: ['scan_local_models', 'list_model_scores'],
    why: 'Inventario Ollama/LM Studio con scores (caché en app DB)',
    category: 'modelos'
  },
  {
    id: 'comandos',
    phrases: ['comandos útiles', 'qué puedo pedirte de la app'],
    tools: ['list_host_commands'],
    why: 'Catálogo de comandos host',
    category: 'sistema'
  },
  {
    id: 'capacidades',
    phrases: ['qué puedes hacer', 'qué sabes hacer', 'lista de capacidades', 'tus plugins', 'herramientas disponibles'],
    tools: ['list_host_commands'],
    why: 'Lista de capacidades / plugins de la app',
    category: 'sistema'
  },
  {
    id: 'score_face',
    phrases: ['similitud facial', 'compara caras', 'score face'],
    tools: ['score_face_match'],
    why: 'Compara ref vs generada (plugin Python opcional)',
    category: 'imagen'
  },

  {
    id: 'identity_match',
    phrases: ['analiza refs', 'score identidad', 'valida cara', 'similitud identidad'],
    tools: ['analyze_identity_refs', 'score_identity_match'],
    why: 'E4 identity-match: pre calidad de refs + post score',
    category: 'imagen'
  },

  {
    id: 'recover_settings',
    phrases: ['recupera ajustes', 'recuperar datos', 'restaurar configuración'],
    tools: ['recover_settings'],
    why: 'Restaurar personalidad/avatar desde backups',
    category: 'sistema'
  },
  {
    id: 'self_check',
    phrases: ['self-check', 'autodiagnóstico chat', 'corre tests', 'test interno'],
    tools: ['run_chat_self_check'],
    why: 'Prueba interna rápida del chat/host',
    category: 'diagnostico'
  }
]

export function formatCommandCatalogForChat(): string {
  const lines = [
    '**Comandos que puedo ejecutar en la app** (sin cloud):',
    ''
  ]
  for (const c of HOST_COMMAND_CATALOG) {
    const sample = c.phrases[0]
    lines.push(`- *«${sample}»* — ${c.why}`)
  }
  lines.push('')
  lines.push('_Si algo falla, te lo digo en claro y te sugiero el siguiente paso._')
  return lines.join('\n')
}
