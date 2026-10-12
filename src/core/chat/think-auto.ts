/**
 * Think Auto: when to enable model reasoning (preferThinkingOff = false).
 * Keeps short chat snappy; turns thinking on for hard / tool / doc work.
 * Note: JS \b is ASCII-only — never put \b after accented letters.
 */

export type ThinkMode = 'off' | 'on' | 'auto'

export function shouldEnableThinking(opts: {
  mode: ThinkMode | string | undefined
  userContent: string
  hasDocAttach?: boolean
  useWebSearch?: boolean
  profileAlreadyWantsThink?: boolean
}): boolean {
  const mode = (opts.mode || 'off') as ThinkMode
  if (mode === 'on') return true
  if (mode === 'off') {
    return Boolean(opts.hasDocAttach)
  }

  if (opts.profileAlreadyWantsThink) return true
  if (opts.hasDocAttach) return true
  if (opts.useWebSearch) return true

  const t = opts.userContent || ''
  if (!t.trim()) return false

  // Explicit ask to think / step-by-step
  if (
    /\b(razona|piensa|razonamiento|step by step|paso a paso)\b/i.test(t) ||
    /expl[i\u00ed]ca con detalle/i.test(t) ||
    /an[a\u00e1]lisis profundo/i.test(t)
  ) {
    return true
  }

  // Code / debug
  if (
    /\b(typescript|javascript|python|refactor|bug|compile|error TS)\b/i.test(t) ||
    /c[o\u00f3]digo/i.test(t) ||
    /stack\s*trace/i.test(t) ||
    t.indexOf(String.fromCharCode(96, 96, 96)) >= 0
  ) {
    return true
  }

  // Hard / multi-hop (no word-boundary after accents)
  if (
    /por\s+qu[e\u00e9]/i.test(t) ||
    /c[o\u00f3]mo funciona/i.test(t) ||
    /\b(compara|diferencia entre|ventajas y desventajas|demuestra|pros y contras|trade-?offs?)\b/i.test(
      t
    ) ||
    /eval[u\u00fa]a/i.test(t) ||
    /cr[i\u00ed]tica/i.test(t)
  ) {
    return true
  }

  if (t.length > 900) return true

  if (
    /ecuaci[o\u00f3]n/i.test(t) ||
    /\b(integral|derivada|algoritmo|complejidad)\b/i.test(t) ||
    /demostraci[o\u00f3]n/i.test(t)
  ) {
    return true
  }

  return false
}

