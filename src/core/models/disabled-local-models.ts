/**
 * User-disabled local models — smart router and load paths must skip these.
 *
 * Matching:
 * - exact (case-insensitive)
 * - same core id after stripping publisher (`qwen/`), path, `.gguf`, quant (`-Q6_K`)
 * Does NOT match different sizes (14b vs 8b vs 32b).
 */

function coreModelKey(modelId: string): string {
  let s = String(modelId || '')
    .trim()
    .toLowerCase()
  if (!s) return ''
  s = s.replace(/\\/g, '/').split('/').pop() || s
  s = s.replace(/\.gguf$/i, '')
  s = s
    .replace(/[-_]q[2-8](_?k)(_?[msxl])?$/i, '')
    .replace(/[-_]q[2-8]k[msxl]?$/i, '')
    .replace(/[-_]iq[1-4][_xsml]*$/i, '')
    .replace(/[-_]f16$/i, '')
    .replace(/[-_]fp16$/i, '')
  return s.replace(/[^a-z0-9]+/g, '')
}

export function isLocalModelDisabled(
  modelId: string,
  disabled?: string[] | null
): boolean {
  const id = String(modelId || '').trim()
  if (!id || !disabled?.length) return false
  const idLower = id.toLowerCase()
  const idCore = coreModelKey(id)
  for (const raw of disabled) {
    const d = String(raw || '').trim()
    if (!d) continue
    const dLower = d.toLowerCase()
    if (idLower === dLower) return true
    if (idLower.endsWith('/' + dLower) || dLower.endsWith('/' + idLower)) return true
    if (idLower.endsWith(dLower) && dLower.length >= 8) return true
    if (dLower.endsWith(idLower) && idLower.length >= 8) return true
    const dCore = coreModelKey(d)
    if (idCore && dCore && idCore === dCore) return true
  }
  return false
}

export function filterEnabledLocalModels<T extends { id: string }>(
  models: T[],
  disabled?: string[] | null
): T[] {
  if (!disabled?.length) return models
  return models.filter((m) => !isLocalModelDisabled(m.id, disabled))
}

export function filterEnabledIds(
  ids: string[],
  disabled?: string[] | null
): string[] {
  if (!disabled?.length) return ids
  return ids.filter((id) => !isLocalModelDisabled(id, disabled))
}

export function toggleDisabledLocalModel(
  disabled: string[] | undefined,
  modelId: string,
  enable: boolean
): string[] {
  const id = String(modelId || '').trim()
  if (!id) return Array.isArray(disabled) ? [...disabled] : []
  const cur = Array.isArray(disabled) ? [...disabled] : []
  const next = cur.filter(
    (x) => !isLocalModelDisabled(id, [x]) && !isLocalModelDisabled(x, [id])
  )
  if (!enable) next.push(id)
  return next.slice(0, 128)
}

export function pickFirstEnabledFromDisabledList(
  catalogIds: string[],
  disabled?: string[] | null
): string | null {
  for (const id of catalogIds) {
    if (!isLocalModelDisabled(id, disabled)) return id
  }
  return null
}
