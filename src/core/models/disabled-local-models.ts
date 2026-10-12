/**
 * User-disabled local models — smart router must skip these.
 * Matching is conservative: exact / suffix only (no loose substring).
 */

export function isLocalModelDisabled(
  modelId: string,
  disabled?: string[] | null
): boolean {
  const id = String(modelId || '').trim().toLowerCase()
  if (!id || !disabled?.length) return false
  for (const raw of disabled) {
    const d = String(raw || '').trim().toLowerCase()
    if (!d) continue
    if (id === d) return true
    // publisher/name vs name:tag
    if (id.endsWith('/' + d) || id.endsWith(':' + d)) return true
    if (d.endsWith('/' + id) || d.endsWith(':' + id)) return true
    const idLast = (id.split('/').pop() || id).split(':')[0]
    const dLast = (d.split('/').pop() || d).split(':')[0]
    if (idLast && dLast && idLast === dLast && idLast.length >= 6) return true
    // Qwen3-14B-Q4_K_M vs qwen/qwen3-14b
    const flat = (s: string) =>
      s
        .replace(/[_-]/g, '')
        .replace(/q\d_k_m|q\d_k_s|gguf|instruct|chat/gi, '')
        .replace(/:\w+$/, '')
    const a = flat(idLast)
    const b = flat(dLast)
    if (a.length >= 8 && b.length >= 8 && (a === b || a.includes(b) || b.includes(a))) {
      // same family+size token
      const sizeA = id.match(/(\d+(?:\.\d+)?)b/i)?.[1]
      const sizeB = d.match(/(\d+(?:\.\d+)?)b/i)?.[1]
      if (sizeA && sizeB && sizeA === sizeB) return true
    }
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

export function toggleDisabledLocalModel(
  disabled: string[] | undefined,
  modelId: string,
  enable: boolean
): string[] {
  const id = String(modelId || '').trim()
  const cur = Array.isArray(disabled) ? [...disabled] : []
  const lower = id.toLowerCase()
  const next = cur.filter((x) => x.toLowerCase() !== lower)
  if (!enable) next.push(id)
  return next.slice(0, 64)
}

/** Prefer enabled ids when catalog is empty after filter (disk-only names). */
export function pickFirstEnabledFromDisabledList(
  catalogIds: string[],
  disabled?: string[] | null
): string | null {
  for (const id of catalogIds) {
    if (!isLocalModelDisabled(id, disabled)) return id
  }
  return null
}
