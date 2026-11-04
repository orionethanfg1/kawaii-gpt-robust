/**
 * File NL path (X6) — system guidance when the user talks about files/folders.
 * Tools still run via post-reply harness with approval; this only shapes the prompt.
 */
import type { DecisionPacket } from '@core/agent/decision-packet'

export const FILE_NL_TOOL_NAMES = [
  'list_library',
  'describe_file',
  'classify_file',
  'read_text_file',
  'show_in_folder',
  'copy_file',
  'move_file',
  'rename_file',
  'delete_file',
  'propose_file_edit',
  'apply_file_edit'
] as const

export function packetWantsFileNl(packet: DecisionPacket | null | undefined): boolean {
  if (!packet) return false
  return (
    packet.task === 'files' ||
    packet.task === 'mixed' ||
    packet.inject.library ||
    (packet.needsTools && /files|lib/i.test(packet.reason))
  )
}

export function buildFileNlSystemBlock(opts?: { characterName?: string }): string {
  const who = opts?.characterName?.trim() || 'el asistente'
  return (
    '[ARCHIVOS — NL → tools]\n' +
    `${who} puede ayudar con archivos **solo dentro del espacio de la app** (biblioteca, adjuntos, userData permitido).\n` +
    'Si el usuario pide listar, clasificar, mover, copiar, renombrar o borrar:\n' +
    '1) Responde breve en lenguaje natural.\n' +
    '2) Emite un bloque <<<APP_ACTION>>> con tools permitidas: ' +
    FILE_NL_TOOL_NAMES.join(', ') +
    '.\n' +
    '3) No inventes rutas absolutas del sistema del usuario fuera de la app.\n' +
    '4) delete_file / move_file / rename_file requieren confirmación de la UI; no digas «ya está borrado» hasta ver observación ok.\n' +
    '5) Si solo pregunta qué hay en la biblioteca, usa list_library.\n' +
    '6) Si pide abrir carpeta en el explorador, usa show_in_folder.'
  )
}
