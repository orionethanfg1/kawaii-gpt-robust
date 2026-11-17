/**
 * Automatic settings / character backups + transparent recovery.
 */
import type { Settings } from "../types/settings"
import { DEFAULT_SETTINGS } from "../types/settings"

const BACKUP_PREFIX = "kawaii-settings-backup-"
const BACKUP_META = "kawaii-settings-backup-meta"
const CHAR_BACKUP = "kawaii-character-backup-v1"
const LEGACY_KEYS = [
  "kawaii-settings-v1",
  "kawaii-settings-v2",
  "kawaii-gpt-settings-v1",
  "kawaii-gpt-character"
] as const

const MAX_BACKUPS = 8
const MIN_BACKUP_INTERVAL_MS = 45_000

export type SettingsRichness = {
  score: number
  hasCustomName: boolean
  hasAvatar: boolean
  hasGallery: boolean
  hasVisualDesc: boolean
  hasLocalModel: boolean
  galleryCount: number
}

export function scoreSettings(s: Settings | null | undefined): SettingsRichness {
  if (!s || typeof s !== "object") {
    return {
      score: 0,
      hasCustomName: false,
      hasAvatar: false,
      hasGallery: false,
      hasVisualDesc: false,
      hasLocalModel: false,
      galleryCount: 0
    }
  }
  const c = s.character || DEFAULT_SETTINGS.character
  const defName = (DEFAULT_SETTINGS.character?.name || "").trim()
  const name = (c.name || "").trim()
  const hasCustomName = Boolean(name && name !== defName)
  const hasAvatar = Boolean((c.visualImageUrl || "").trim())
  const galleryCount = Array.isArray(c.visualGallery) ? c.visualGallery.length : 0
  const hasGallery = galleryCount > 0
  const hasVisualDesc = Boolean((c.visualDescription || "").trim())
  const hasLocalModel = Boolean((s.localModel || "").trim())
  let score = 0
  if (hasCustomName) score += 30
  if (hasAvatar) score += 40
  if (hasGallery) score += 15 + Math.min(galleryCount, 6) * 3
  if (hasVisualDesc) score += 20
  if (hasLocalModel) score += 10
  if ((c.personality || "").trim().length > 40) score += 10
  if ((c.tagline || "").trim()) score += 5
  return {
    score,
    hasCustomName,
    hasAvatar,
    hasGallery,
    hasVisualDesc,
    hasLocalModel,
    galleryCount
  }
}

function lsGet(key: string): string | null {
  try {
    if (typeof localStorage === "undefined") return null
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function lsSet(key: string, value: string): void {
  try {
    if (typeof localStorage === "undefined") return
    localStorage.setItem(key, value)
  } catch {
    /* quota */
  }
}

function parseMaybeSettings(raw: string | null): Settings | null {
  if (!raw) return null
  try {
    const j = JSON.parse(raw) as unknown
    if (!j || typeof j !== "object") return null
    const o = j as Record<string, unknown>
    if (o.state && typeof o.state === "object" && (o.state as { settings?: unknown }).settings) {
      return (o.state as { settings: Settings }).settings
    }
    if (o.settings && typeof o.settings === "object") return o.settings as Settings
    if (o.character || o.providerMode || o.localModel !== undefined) return o as unknown as Settings
    if (o.name && o.personality !== undefined) {
      return {
        ...DEFAULT_SETTINGS,
        character: { ...DEFAULT_SETTINGS.character, ...o }
      } as Settings
    }
    return null
  } catch {
    return null
  }
}

export function collectBackupCandidates(): Array<{
  source: string
  settings: Settings
  score: number
  at?: number
}> {
  const out: Array<{ source: string; settings: Settings; score: number; at?: number }> = []
  const seen = new Set<string>()

  const push = (source: string, s: Settings | null, at?: number) => {
    if (!s) return
    const sc = scoreSettings(s)
    if (sc.score < 5) return
    const img = (s.character?.visualImageUrl || "").slice(0, 48)
    const sig = [s.character?.name || "", img, s.localModel || "", String(sc.galleryCount)].join("|")
    if (seen.has(sig)) return
    seen.add(sig)
    const stamp = at || (typeof s.lastUserEditAt === "number" ? s.lastUserEditAt : undefined)
    out.push({ source, settings: s, score: sc.score, at: stamp })
  }

  for (const key of LEGACY_KEYS) {
    push(key, parseMaybeSettings(lsGet(key)))
  }

  try {
    const raw = lsGet(CHAR_BACKUP)
    if (raw) {
      const ch = JSON.parse(raw) as Record<string, unknown>
      if (ch && typeof ch === "object") {
        push(CHAR_BACKUP, {
          ...DEFAULT_SETTINGS,
          character: { ...DEFAULT_SETTINGS.character, ...ch }
        } as Settings)
      }
    }
  } catch {
    /* */
  }

  try {
    const metaRaw = lsGet(BACKUP_META)
    const meta = metaRaw ? (JSON.parse(metaRaw) as { ids?: string[] }) : null
    const ids = Array.isArray(meta?.ids) ? meta!.ids! : []
    const pushBackupRaw = (key: string, raw: string | null) => {
      if (!raw) return
      let at: number | undefined
      try {
        const j = JSON.parse(raw) as { at?: number; settings?: unknown }
        if (typeof j.at === "number") at = j.at
      } catch {
        /* */
      }
      push(key, parseMaybeSettings(raw), at)
    }
    for (const id of ids) {
      pushBackupRaw(BACKUP_PREFIX + id, lsGet(BACKUP_PREFIX + id))
    }
    if (typeof localStorage !== "undefined") {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (k && k.startsWith(BACKUP_PREFIX) && k !== BACKUP_META) {
          pushBackupRaw(k, lsGet(k))
        }
      }
    }
  } catch {
    /* */
  }

  out.sort((a, b) => (b.at || 0) - (a.at || 0) || b.score - a.score)
  return out
}

let lastBackupAt = 0
let lastMirroredCharacter: Settings["character"] | null = null


/** D1 — best-effort disk mirror (does not throttle as hard as rolling slots) */
function mirrorSettingsToDisk(settings: Settings, payload?: string): void {
  try {
    const now = Date.now()
    const body =
      payload ||
      JSON.stringify({ at: now, settings })
    const w = window as unknown as {
      kawaii?: {
        settingsBackupWrite?: (p: {
          fileName?: string
          content?: string
        }) => Promise<unknown>
      }
    }
    void w.kawaii?.settingsBackupWrite?.({ fileName: "latest.json", content: body })
    if (settings.character && settings.character !== lastMirroredCharacter) {
      lastMirroredCharacter = settings.character
      void w.kawaii?.settingsBackupWrite?.({
        fileName: "character-latest.json",
        content: JSON.stringify({ at: now, character: settings.character })
      })
    }
  } catch {
    /* */
  }
}


/** True when loaded settings look like a factory wipe, not a deliberate lean edit. */
export function isNearDefaultWipe(s: Settings | null | undefined): boolean {
  if (!s) return true
  const rich = scoreSettings(s)
  if (rich.score >= 25) return false
  const c = s.character || DEFAULT_SETTINGS.character
  const def = DEFAULT_SETTINGS.character
  const pers = (c.personality || "").trim()
  const style = (c.style || "").trim()
  const name = (c.name || "").trim()
  const defName = (def.name || "").trim()
  // User typed a custom personality/style — never treat as wipe
  if (pers.length > 20 && pers !== (def.personality || "").trim()) return false
  if (style.length > 10 && style !== (def.style || "").trim()) return false
  if (name && name !== defName) return false
  if ((s.localModel || "").trim()) return false
  return rich.score < 15
}

function editTimeOf(s: Settings | null | undefined, backupAt?: number): number {
  const u = typeof s?.lastUserEditAt === "number" ? s.lastUserEditAt : 0
  const b = typeof backupAt === "number" ? backupAt : 0
  return Math.max(u, b)
}

/** Prefer user text from `prefer` when present; keep visuals from `base` if stronger. */
export function mergeSettingsPreferRecent(
  current: Settings,
  candidate: Settings,
  opts?: { candidateAt?: number }
): Settings {
  const curT = editTimeOf(current)
  const candT = editTimeOf(candidate, opts?.candidateAt)
  // If candidate is strictly older and current is not a wipe → keep current as authority for text
  const currentWinsText = !isNearDefaultWipe(current) && curT >= candT
  const textKeys = [
    "personality",
    "style",
    "tagline",
    "relationshipRole",
    "relationshipReaction",
    "name",
    "visualDescription"
  ] as const
  const baseChar = { ...candidate.character, ...current.character }
  const prefer = currentWinsText ? current.character : candidate.character
  const other = currentWinsText ? candidate.character : current.character
  for (const k of textKeys) {
    const v = (prefer as Record<string, unknown>)?.[k]
    if (typeof v === "string" && v.trim()) {
      ;(baseChar as Record<string, unknown>)[k] = v
    } else {
      const o = (other as Record<string, unknown>)?.[k]
      if (typeof o === "string" && o.trim()) (baseChar as Record<string, unknown>)[k] = o
    }
  }
  if (Array.isArray(prefer?.traits) && prefer.traits.length) baseChar.traits = prefer.traits
  // Visuals: keep whichever has paths/gallery
  const curGal = current.character?.visualGallery || []
  const candGal = candidate.character?.visualGallery || []
  if (candGal.length > curGal.length) baseChar.visualGallery = candGal
  else if (curGal.length) baseChar.visualGallery = curGal
  const curUrl = (current.character?.visualImageUrl || "").trim()
  const candUrl = (candidate.character?.visualImageUrl || "").trim()
  if (curUrl) baseChar.visualImageUrl = curUrl
  else if (candUrl) baseChar.visualImageUrl = candUrl

  const lastUserEditAt = Math.max(curT, candT, current.lastUserEditAt || 0, candidate.lastUserEditAt || 0) || undefined
  return {
    ...candidate,
    ...current,
    character: baseChar,
    lastUserEditAt,
    // Prefer more recent non-default local model
    localModel: (current.localModel || "").trim() || candidate.localModel
  }
}

export function maybeBackupSettings(settings: Settings): void {
  const now = Date.now()
  // Keep the latest recoverable state current, but avoid rewriting rolling
  // snapshots and scanning localStorage on every field edit.
  mirrorSettingsToDisk(settings)
  const rich = scoreSettings(settings)
  if (rich.score < 20) return
  if (now - lastBackupAt < MIN_BACKUP_INTERVAL_MS) return
  lastBackupAt = now

  try {
    const id = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)
    const payload = JSON.stringify({ at: now, settings })
    lsSet(BACKUP_PREFIX + id, payload)
    if (settings.character) {
      lsSet(CHAR_BACKUP, JSON.stringify(settings.character))
      try {
        void import('./stores/characterStore').then((m) => {
          m.syncCharacterFromSettings(settings.character)
        })
      } catch {
        /* */
      }
    }

    let ids: string[] = []
    try {
      const meta = JSON.parse(lsGet(BACKUP_META) || "{}") as { ids?: string[] }
      ids = Array.isArray(meta.ids) ? meta.ids : []
    } catch {
      ids = []
    }
    ids = [id, ...ids.filter((x) => x !== id)].slice(0, MAX_BACKUPS)
    lsSet(BACKUP_META, JSON.stringify({ ids, updatedAt: now }))

    if (typeof localStorage !== "undefined") {
      const keep = new Set(ids.map((x) => BACKUP_PREFIX + x))
      const toRemove: string[] = []
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (k && k.startsWith(BACKUP_PREFIX) && k !== BACKUP_META && !keep.has(k)) {
          toRemove.push(k)
        }
      }
      for (const k of toRemove) {
        try {
          localStorage.removeItem(k)
        } catch {
          /* */
        }
      }
    }

    try {
      const w = window as unknown as {
        kawaii?: {
          settingsBackupWrite?: (p: {
            fileName?: string
            content?: string
          }) => Promise<unknown>
        }
      }
      void w.kawaii?.settingsBackupWrite?.({ fileName: id + ".json", content: payload })
    } catch {
      /* optional */
    }
  } catch {
    /* */
  }
}

export function autoRecoverIfWiped(loaded: Settings): {
  settings: Settings
  recovered: boolean
  source?: string
} {
  // Never overwrite deliberate user edits with an older "richer" backup
  if (!isNearDefaultWipe(loaded)) {
    return { settings: loaded, recovered: false }
  }

  const cur = scoreSettings(loaded)
  const candidates = collectBackupCandidates()
  if (!candidates.length) return { settings: loaded, recovered: false }

  // Prefer most recent edit time, then score
  let best = candidates[0]
  let bestKey = editTimeOf(best.settings, (best as { at?: number }).at) * 1e6 + scoreSettings(best.settings).score
  for (const c of candidates) {
    const key = editTimeOf(c.settings, (c as { at?: number }).at) * 1e6 + scoreSettings(c.settings).score
    if (key > bestKey) {
      best = c
      bestKey = key
    }
  }

  if (scoreSettings(best.settings).score <= cur.score + 5) {
    return { settings: loaded, recovered: false }
  }

  const recovered = mergeSettingsPreferRecent(loaded, best.settings, {
    candidateAt: (best as { at?: number }).at
  })
  return { settings: recovered, recovered: true, source: best.source }
}


export type RecoveryReport = {
  ok: boolean
  recovered: boolean
  source?: string
  scoreBefore: number
  scoreAfter: number
  notes: string[]
  imageCandidates: number
}

/**
 * Aggressive multi-source recovery. Apply result with applyRecoveredSettings.
 */

/** Explicit backup snapshot (B2) */
export function backupSettingsNow(settings: Settings): void {
  try {
    const now = Date.now()
    const id = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)
    const payload = JSON.stringify({ at: now, settings })
    const key = BACKUP_PREFIX + id
    lsSet(key, payload)
    if (settings.character) {
      lsSet(CHAR_BACKUP, JSON.stringify(settings.character))
    }
    try {
      const keys = Object.keys(localStorage)
        .filter((k) => k.startsWith(BACKUP_PREFIX))
        .sort()
      while (keys.length > MAX_BACKUPS) {
        const drop = keys.shift()
        if (drop) localStorage.removeItem(drop)
      }
    } catch {
      /* */
    }
    // D1: always mirror to disk (userData/settings-backups)
    try {
      const w = window as unknown as {
        kawaii?: {
          settingsBackupWrite?: (p: {
            fileName?: string
            content?: string
          }) => Promise<unknown>
        }
      }
      void w.kawaii?.settingsBackupWrite?.({ fileName: "latest.json", content: payload })
      void w.kawaii?.settingsBackupWrite?.({ fileName: id + ".json", content: payload })
      if (settings.character) {
        void w.kawaii?.settingsBackupWrite?.({
          fileName: "character-latest.json",
          content: JSON.stringify({ at: now, character: settings.character })
        })
      }
    } catch {
      /* */
    }
  } catch {
    /* quota */
  }
}

export async function runFullSettingsRecovery(
  current: Settings
): Promise<{ settings: Settings; report: RecoveryReport }> {
  const notes: string[] = []
  const before = scoreSettings(current)
  let best = current
  let bestScore = before.score
  let bestTime = editTimeOf(current)
  let source = "current"

  // User has real edits → never replace whole settings with an older rich snapshot.
  // Only fill missing visuals from candidates via mergeSettingsPreferRecent at the end.
  const protectUserEdits = !isNearDefaultWipe(current)

  const consider = (label: string, s: Settings | null | undefined, at?: number) => {
    if (!s) return
    const sc = scoreSettings(s)
    const tEdit = editTimeOf(s, at)
    if (protectUserEdits) {
      // Only note richer candidates; do not switch "best" away from current
      if (sc.score > bestScore) {
        notes.push("Candidato más rico (no aplica: hay ediciones de usuario): " + label + " score " + sc.score)
      }
      return
    }
    // Wipe path: prefer recency, then score
    const better =
      tEdit > bestTime || (tEdit === bestTime && sc.score > bestScore)
    if (better) {
      best = s
      bestScore = sc.score
      bestTime = tEdit
      source = label
      notes.push("Mejor candidato: " + label + " (t=" + tEdit + ", score " + sc.score + ")")
    } else if (sc.score >= 25) {
      notes.push("Candidato " + label + " score " + sc.score + " (no supera al actual)")
    }
  }

  // 1) localStorage backups + legacy
  for (const c of collectBackupCandidates()) {
    consider(c.source, c.settings, (c as { at?: number }).at)
  }

  // 2) disk backups via main
  try {
    const w = window as unknown as {
      kawaii?: {
        settingsBackupList?: () => Promise<{
          ok: boolean
          files?: Array<{ name: string }>
        }>
        settingsBackupRead?: (
          fileName?: string
        ) => Promise<{ ok: boolean; content?: string }>
      }
    }
    const list = await w.kawaii?.settingsBackupList?.()
    if (list?.ok && list.files?.length) {
      notes.push("Backups en disco: " + list.files.length)
      for (const f of list.files.slice(0, 12)) {
        const read = await w.kawaii?.settingsBackupRead?.(f.name)
        if (read?.ok && read.content) {
          consider("disk:" + f.name, parseMaybeSettings(read.content))
        }
      }
    } else {
      notes.push("Sin backups en disco (aún)")
    }
  } catch (e) {
    notes.push("Disco: " + (e instanceof Error ? e.message : String(e)))
  }

  // 3) Merge character-only strengths into best
  const charOnly = parseMaybeSettings(lsGet(CHAR_BACKUP))
  if (charOnly?.character) {
    const merged: Settings = {
      ...best,
      character: { ...best.character, ...charOnly.character }
    }
    consider("character-backup-merge", merged)
  }

  // 4) Image files on disk — note count (re-attach is manual / optional dataUrl load)
  let imageCandidates = 0
  try {
    const w = window as unknown as {
      kawaii?: {
        settingsBackupListImages?: () => Promise<{
          ok: boolean
          files?: Array<{ path: string; name: string }>
        }>
        filesToDataUrl?: (path: string) => Promise<{ ok?: boolean; dataUrl?: string }>
      }
    }
    const imgs = await w.kawaii?.settingsBackupListImages?.()
    imageCandidates = imgs?.files?.length || 0
    if (imageCandidates > 0) {
      notes.push(
        "Imágenes en disco: " +
          imageCandidates +
          " (puedes reasignar la principal en Ajustes si falta avatar)"
      )
      // If no avatar but images exist, try first image as visualImageUrl
      const needAvatar = !(best.character?.visualImageUrl || "").trim()
      if (needAvatar && imgs?.files?.[0]?.path && w.kawaii?.filesToDataUrl) {
        try {
          const d = await w.kawaii.filesToDataUrl(imgs.files[0].path)
          if (d?.dataUrl) {
            const withImg: Settings = {
              ...best,
              character: {
                ...best.character,
                visualImageUrl: d.dataUrl
              }
            }
            consider("disk-image:" + imgs.files[0].name, withImg)
            notes.push("Avatar tentativo desde " + imgs.files[0].name)
          }
        } catch {
          notes.push("No se pudo incrustar imagen de disco (tamaño o permisos)")
        }
      }
    }
  } catch {
    /* */
  }

  const recovered = bestScore > before.score + 5 || (
    before.score < 25 && bestScore >= 25
  )

  if (recovered) {
    notes.push("Recuperación aplicada desde: " + source)
    try {
      maybeBackupSettings(best)
      void import("./stores/characterStore").then((m) => {
        if (best.character) m.syncCharacterFromSettings(best.character)
      })
    } catch {
      /* */
    }
  } else {
    // Still pull identity store if richer than current
    try {
      const m = await import("./stores/characterStore")
      const id = m.readIdentityCharacter()
      const merged = {
        ...best,
        character: m.pickRicherCharacter(best.character, id)
      }
      if (scoreSettings(merged).score > scoreSettings(best).score) {
        best = merged
        source = "kawaii-character-v1"
        notes.push("Identidad reforzada desde almacén de personaje separado")
        return {
          settings: best,
          report: {
            ok: true,
            recovered: true,
            source,
            scoreBefore: before.score,
            scoreAfter: scoreSettings(best).score,
            notes,
            imageCandidates
          }
        }
      }
    } catch {
      /* */
    }
    notes.push(
      before.score >= 40
        ? "No hacía falta recuperar: los ajustes actuales ya son ricos."
        : "No se encontró un backup mejor. Reconfigura ficha; a partir de ahora habrá respaldos."
    )
  }

  return {
    settings: recovered ? best : current,
    report: {
      ok: true,
      recovered,
      source: recovered ? source : undefined,
      scoreBefore: before.score,
      scoreAfter: scoreSettings(recovered ? best : current).score,
      notes,
      imageCandidates
    }
  }
}
