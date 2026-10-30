/**
 * W1 — Avatar wardrobe UI: per-image metadata, lightbox, role/tags presets.
 * Global label-before-upload removed; each item is editable after select/add.
 */
import { useEffect, useRef, useState } from 'react'
import { ImagePlus, Star, Trash2, X, ChevronLeft, ChevronRight, FolderOpen } from 'lucide-react'
import { Button } from '@shared/ui/Button'
import type { CharacterProfile } from '@shared/types/settings'
import {
  enrichVisualGallery,
  galleryNeedsEnrichment,
  dedupeGalleryItems
} from '@core/image/wardrobe'
import {
  filterGalleryByKind,
  type WardrobeKind,
  WARDROBE_KIND_LABELS,
  validateWardrobeUpload,
  classifyWardrobeHeuristic,
  kindToRole
} from '@core/image/wardrobe-classify'
import { persistWardrobeDataUrl, rememberChatPrimaryPath, openWardrobeFolder, loadDataUrlFromFilePath, listWardrobeOnDisk } from './services/wardrobeDisk'
import { isDataImageUrl, pathFromVisualRef, needsDiskHydrate, wardrobeMediaUrl } from '@core/image/visual-url'
import { resolveAvatarObjectPosition } from '@core/character/avatar-focus'

type GalleryItem = NonNullable<CharacterProfile['visualGallery']>[number]
type WardrobeRole = NonNullable<GalleryItem['role']>

const ROLE_OPTIONS: { id: WardrobeRole; label: string }[] = [
  { id: 'face', label: 'Cara / retrato' },
  { id: 'half', label: 'Medio cuerpo' },
  { id: 'full', label: 'Cuerpo entero' },
  { id: 'outfit', label: 'Outfit / ropa' },
  { id: 'scene', label: 'Escena / fondo' }
]

const TAG_PRESETS = [
  'outfit:casual',
  'outfit:formal',
  'outfit:vestido',
  'scene:interior',
  'scene:exterior',
  'scene:playa',
  'scene:noche',
  'scene:oficina',
  'mood:serio',
  'mood:juguetón',
  'mood:tierno',
  'framing:face',
  'framing:full'
]

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result || ''))
    r.onerror = () => reject(new Error('read failed'))
    r.readAsDataURL(file)
  })
}

function uid() {
  return `av_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
}

function inferRoleFromText(text: string): WardrobeRole {
  const t = text.toLowerCase()
  if (/face|rostro|portrait|cara|selfie|primer|avatar/.test(t)) return 'face'
  if (/full|cuerpo|entero|wide/.test(t)) return 'full'
  if (/half|medio|torso/.test(t)) return 'half'
  if (/playa|oficina|noche|fondo|escena|interior|exterior/.test(t)) return 'scene'
  if (/vestido|ropa|outfit|casual|formal/.test(t)) return 'outfit'
  return 'outfit'
}

function displayTitle(g: GalleryItem): string {
  return (g.label || g.scene || 'Sin título').trim() || 'Sin título'
}

interface Props {
  character: CharacterProfile
  onChange: (next: CharacterProfile) => void
}

export function AvatarGalleryPanel({ character, onChange }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [lightboxId, setLightboxId] = useState<string | null>(null)
  const [draftTitle, setDraftTitle] = useState('')
  const [draftRole, setDraftRole] = useState<WardrobeRole>('outfit')
  const [draftTags, setDraftTags] = useState<string[]>([])

  const toggleTag = (tag: string) => {
    const t = String(tag || '').trim()
    if (!t) return
    setDraftTags((prev) => {
      if (prev.includes(t)) return prev.filter((x) => x !== t)
      return [...new Set([...prev, t])].slice(0, 12)
    })
  }
  const [draftIntimacy, setDraftIntimacy] = useState<0 | 1 | 2 | 3>(0)
  const [customTag, setCustomTag] = useState('')
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [saveHint, setSaveHint] = useState<string | null>(null)
  const [kindFilter, setKindFilter] = useState<WardrobeKind | 'all'>('all')
  /** Display-only data URLs from disk (CSP-safe; not required in settings). */
  const [resolvedSrc, setResolvedSrc] = useState<Record<string, string>>({})

  // Dedupe + strip illegal kawaii-file:/file: dataUrls
  const galleryBase = dedupeGalleryItems([...(character.visualGallery || [])]) as GalleryItem[]
  const primary = (character.visualImageUrl || '').trim()
  const primaryPath = pathFromVisualRef(primary) || (/^[A-Za-z]:/.test(primary) ? primary : '')
  const primaryCovered = galleryBase.some((g) => {
    if (g.id === 'principal') return true
    if (primary && g.dataUrl === primary) return true
    const fp = String(g.filePath || '').replace(/\\/g, '/').toLowerCase()
    const pp = String(primaryPath || '').replace(/\\/g, '/').toLowerCase()
    if (fp && pp && (fp === pp || pp.endsWith(fp.split('/').pop() || '___'))) return true
    return false
  })
  const gallery: GalleryItem[] = [...galleryBase]
  // Synthetic principal chip only when needed for UI (not written to settings here)
  if (primary && !primaryCovered) {
    gallery.unshift({
      id: 'principal',
      dataUrl: primary.startsWith('data:image/') ? primary : '',
      filePath: primaryPath || undefined,
      label: 'Principal',
      scene: 'principal',
      role: 'face',
      tags: ['framing:face']
    })
  }

  // One-shot: disk is source of truth — drop ghosts, fix paths, add missing files
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const raw = character.visualGallery || []
      let cleaned = dedupeGalleryItems(raw) as GalleryItem[]
      try {
        const disk = await listWardrobeOnDisk()
        if (cancelled) return
        const byName = new Map(disk.map((d) => [d.name.toLowerCase(), d]))
        const diskNames = new Set(byName.keys())

        // Keep only items that still exist on disk OR still have inline data:
        cleaned = cleaned.filter((g) => {
          if (isDataImageUrl(g.dataUrl)) return true
          const base = String(g.filePath || pathFromVisualRef(g.dataUrl) || '')
            .split(/[/\\]/)
            .pop()
            ?.toLowerCase()
          if (base && diskNames.has(base)) return true
          // label sometimes equals filename without extension
          const labelGuess = String(g.label || '')
            .toLowerCase()
            .replace(/\s+/g, '_')
          for (const n of diskNames) {
            if (n.replace(/\.[a-z0-9]+$/, '') === labelGuess) return true
          }
          return false // ghost — file gone
        })

        // Normalize filePath to absolute path from disk list
        cleaned = cleaned.map((g) => {
          const base = String(g.filePath || pathFromVisualRef(g.dataUrl) || '')
            .split(/[/\\]/)
            .pop()
            ?.toLowerCase()
          if (base && byName.has(base)) {
            const hit = byName.get(base)!
            return {
              ...g,
              filePath: hit.path,
              dataUrl: isDataImageUrl(g.dataUrl) ? g.dataUrl : ''
            }
          }
          return g
        })

        // Add disk files not yet in gallery
        const covered = new Set(
          cleaned
            .map((g) =>
              String(g.filePath || '')
                .split(/[/\\]/)
                .pop()
                ?.toLowerCase()
            )
            .filter(Boolean) as string[]
        )
        for (const d of disk) {
          const n = d.name.toLowerCase()
          if (covered.has(n)) continue
          cleaned.push({
            id: `disk_${d.name}`.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 48),
            dataUrl: '',
            filePath: d.path,
            label: d.name.replace(/\.[a-z0-9]+$/i, '').slice(0, 48),
            role: /face|avatar/i.test(d.name) ? 'face' : 'outfit',
            tags: []
          })
          covered.add(n)
        }
        cleaned = dedupeGalleryItems(cleaned) as GalleryItem[]
      } catch {
        /* */
      }
      if (cancelled) return

      // If primary points to a missing file, point to first face / first gallery item
      let visualImageUrl = character.visualImageUrl
      let facePrimaryUrl = character.facePrimaryUrl
      const primaryBase = String(visualImageUrl || pathFromVisualRef(visualImageUrl) || '')
        .split(/[/\\]/)
        .pop()
        ?.toLowerCase()
      const disk = await listWardrobeOnDisk().catch(() => [])
      const diskSet = new Set(disk.map((d) => d.name.toLowerCase()))
      const primaryOk =
        isDataImageUrl(visualImageUrl) ||
        (primaryBase && diskSet.has(primaryBase))
      if (!primaryOk) {
        const face =
          cleaned.find((g) => g.role === 'face' && g.filePath) || cleaned[0]
        if (face?.filePath) {
          visualImageUrl = face.filePath
        } else if (face && isDataImageUrl(face.dataUrl)) {
          visualImageUrl = face.dataUrl
        } else {
          visualImageUrl = undefined
        }
      }
      const faceBase = String(facePrimaryUrl || '')
        .split(/[/\\]/)
        .pop()
        ?.toLowerCase()
      const faceOk =
        isDataImageUrl(facePrimaryUrl) || (faceBase && diskSet.has(faceBase))
      if (!faceOk) {
        const face = cleaned.find((g) => g.role === 'face' && g.filePath) || cleaned[0]
        facePrimaryUrl = face?.filePath || (isDataImageUrl(face?.dataUrl) ? face?.dataUrl : undefined)
      }

      const changed =
        cleaned.length !== raw.length ||
        cleaned.some((g, i) => g.filePath !== raw[i]?.filePath) ||
        visualImageUrl !== character.visualImageUrl ||
        facePrimaryUrl !== character.facePrimaryUrl ||
        raw.some(
          (g) =>
            String(g.dataUrl || '').startsWith('kawaii-file:') ||
            String(g.dataUrl || '').startsWith('file:')
        )
      if (changed) {
        onChange({
          ...character,
          visualGallery: cleaned.slice(0, 48),
          visualImageUrl,
          facePrimaryUrl
        })
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // W2: one-shot enrich missing role/tags (non-destructive)
  useEffect(() => {
    const gal = character.visualGallery
    if (!galleryNeedsEnrichment(gal) && !(character.visualImageUrl && !(gal || []).length)) return
    const next = enrichVisualGallery(gal, character.visualImageUrl)
    const same =
      next.length === (gal || []).length &&
      next.every((n, i) => {
        const o = (gal || [])[i]
        return (
          o &&
          n.id === o.id &&
          n.role === o.role &&
          JSON.stringify(n.tags || []) === JSON.stringify(o.tags || [])
        )
      })
    if (same) return
    onChange({ ...character, visualGallery: next.slice(0, 48) as CharacterProfile['visualGallery'] })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const itemsAll: GalleryItem[] = gallery.filter((g) => g.dataUrl || g.filePath)
  const items: GalleryItem[] =
    kindFilter === 'all' ? itemsAll : filterGalleryByKind(itemsAll, kindFilter)
  const selected = itemsAll.find((g) => g.id === selectedId) || items.find((g) => g.id === selectedId) || null

  // Load disk paths → data: for <img> (CSP blocks file:// and kawaii-file:)
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const gal = character.visualGallery || []
      const nextMap: Record<string, string> = { ...resolvedSrc }
      let mapChanged = false
      for (const g of gal) {
        const id = String(g.id || g.filePath || g.label || '')
        if (!id) continue
        if (isDataImageUrl(g.dataUrl)) {
          if (nextMap[id] !== g.dataUrl) {
            nextMap[id] = g.dataUrl as string
            mapChanged = true
          }
          continue
        }
        if (nextMap[id]?.startsWith('data:image/')) continue
        const path = g.filePath || pathFromVisualRef(g.dataUrl)
        if (!path) continue
        try {
          const url = await loadDataUrlFromFilePath(path)
          if (url && !cancelled) {
            nextMap[id] = url
            mapChanged = true
          }
        } catch {
          /* */
        }
      }
      // Principal may live only on character.visualImageUrl
      const prim = (character.visualImageUrl || '').trim()
      if (prim && !isDataImageUrl(prim)) {
        const path = pathFromVisualRef(prim) || (prim.match(/^[A-Za-z]:/) ? prim : undefined)
        if (path) {
          try {
            const url = await loadDataUrlFromFilePath(path)
            if (url && !cancelled) {
              nextMap['principal'] = url
              nextMap['__visualImageUrl'] = url
              mapChanged = true
            }
          } catch {
            /* */
          }
        }
      } else if (isDataImageUrl(prim)) {
        nextMap['principal'] = prim
        nextMap['__visualImageUrl'] = prim
        mapChanged = true
      }
      if (mapChanged && !cancelled) setResolvedSrc(nextMap)
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [(character.visualGallery || []).map((g) => g.id + ':' + (g.filePath || '') + ':' + String(g.dataUrl || '').slice(0, 32)).join('|') + '|' + String(character.visualImageUrl || '').slice(0, 48)])

  const srcFor = (g: GalleryItem): string | undefined => {
    if (isDataImageUrl(g.dataUrl)) return g.dataUrl
    // Prefer protocol (no base64, CSP-safe, works offline from userData/wardrobe)
    const media =
      wardrobeMediaUrl(g.filePath) ||
      wardrobeMediaUrl(pathFromVisualRef(g.dataUrl)) ||
      wardrobeMediaUrl(g.label)
    if (media) return media
    const id = String(g.id || g.filePath || g.label || '')
    if (id && resolvedSrc[id]) return resolvedSrc[id]
    if (g.id === 'principal' && resolvedSrc['__visualImageUrl']) return resolvedSrc['__visualImageUrl']
    // Primary path may only live on character.visualImageUrl
    if (g.id === 'principal') {
      return wardrobeMediaUrl(primaryPath) || wardrobeMediaUrl(primary)
    }
    return undefined
  }

  const lightbox = items.find((g) => g.id === lightboxId) || null
  const lightboxIndex = lightbox ? items.findIndex((g) => g.id === lightboxId) : -1

  useEffect(() => {
    if (!selected) return
    setDraftTitle(displayTitle(selected))
    setDraftRole(
      selected.role ||
        inferRoleFromText(`${selected.label || ''} ${selected.scene || ''}`)
    )
    setDraftTags([...(selected.tags || [])])
    setDraftIntimacy((selected.intimacy as 0 | 1 | 2 | 3) ?? 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])

  const reclasificarSeleccion = () => {
    if (!selected) return
    const cls = classifyWardrobeHeuristic({
      fileName: String(selected.label || selected.filePath || ''),
      userText: [selected.label, selected.scene, ...(selected.tags || [])].filter(Boolean).join(' '),
      caption: selected.label || selected.scene
    })
    const role = kindToRole(cls.kind)
    const tags = [`kind:${cls.kind}`, ...cls.suggestedTags].slice(0, 12)
    setDraftRole(role)
    setDraftTags(tags)
    // patch in place — no new gallery row
    onChange({
      ...character,
      visualGallery: (character.visualGallery || []).map((g) =>
        g.id === selected.id
          ? {
              ...g,
              role,
              tags,
              label: g.label || cls.kind
            }
          : g
      )
    })
  }

  // Auto-save title/role/tags/intimacy (no explicit button required)
  useEffect(() => {
    if (!selectedId || !selected) return
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
    autoSaveTimer.current = setTimeout(() => {
      const title = draftTitle.trim().slice(0, 48) || 'Sin título'
      const same =
        displayTitle(selected) === title &&
        (selected.role || 'outfit') === draftRole &&
        JSON.stringify(selected.tags || []) === JSON.stringify(draftTags) &&
        (selected.intimacy ?? 0) === draftIntimacy
      if (same) return
      updateItem(selectedId, {
        label: title,
        scene: selected.scene === 'principal' ? 'principal' : title,
        role: draftRole,
        tags: draftTags.slice(0, 12),
        intimacy: draftIntimacy
      })
      setSaveHint('Guardado')
      window.setTimeout(() => setSaveHint(null), 1200)
    }, 450)
    return () => {
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftTitle, draftRole, draftTags, draftIntimacy, selectedId])

  const patchGallery = (next: GalleryItem[]) => {
    onChange({ ...character, visualGallery: next.slice(0, 48) })
  }

  const updateItem = (id: string, patch: Partial<GalleryItem>) => {
    const next = items.map((g) => (g.id === id ? { ...g, ...patch } : g))
    const full = [...(character.visualGallery || [])]
    const byId = new Map(next.map((g) => [g.id, g]))
    const merged = full.map((g) => byId.get(g.id) || g)
    for (const g of next) {
      if (!merged.some((x) => x.id === g.id)) merged.push(g)
    }
    patchGallery(merged.filter((g) => g.dataUrl))
  }

  const setPrimary = (ref: string) => {
    void (async () => {
      let primary = ref
      const item = (character.visualGallery || []).find(
        (g) => g.dataUrl === ref || g.filePath === ref || g.id === ref
      )
      if (item?.filePath) {
        primary = item.filePath
      } else if (ref.startsWith('data:image/')) {
        try {
          const p = await persistWardrobeDataUrl(ref, 'chat_primary')
          if (p.filePath) primary = p.filePath
        } catch {
          /* */
        }
      }
      if (primary && !primary.startsWith('data:')) {
        try {
          rememberChatPrimaryPath(primary)
        } catch {
          /* */
        }
      }
      onChange({
        ...character,
        visualImageUrl: primary
      })
    })()
  }

  const setFacePrimary = (ref: string) => {
    void (async () => {
      let primary = ref
      const item = (character.visualGallery || []).find(
        (g) => g.dataUrl === ref || g.filePath === ref || g.id === ref
      )
      if (item?.filePath) {
        primary = item.filePath
      } else if (ref.startsWith('data:image/')) {
        try {
          const p = await persistWardrobeDataUrl(ref, 'face_primary')
          if (p.filePath) primary = p.filePath
        } catch {
          /* */
        }
      }
      onChange({
        ...character,
        facePrimaryUrl: primary
      })
    })()
  }

  const facePrimary = (character.facePrimaryUrl || character.visualImageUrl || '').trim()


  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return
    const next = [...itemsAll]
    let firstNewId: string | null = null
    for (const f of Array.from(files).slice(0, 12)) {
      const val = validateWardrobeUpload({
        mimeType: f.type,
        byteLength: f.size,
        fileName: f.name
      })
      if (!val.ok) {
        setSaveHint(val.reason)
        window.setTimeout(() => setSaveHint(null), 2500)
        continue
      }
      try {
        const dataUrl = await readFileAsDataUrl(f)
        const baseName = f.name.replace(/\.[^.]+$/, '').slice(0, 40)
        const id = uid()
        if (!firstNewId) firstNewId = id
        const persisted = await persistWardrobeDataUrl(
          dataUrl,
          (baseName || 'look').replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 40) + '.png'
        )
        let displayUrl = persisted.dataUrl || dataUrl
        if (persisted.purged && persisted.filePath) {
          const reloaded = await loadDataUrlFromFilePath(persisted.filePath)
          if (reloaded) displayUrl = reloaded
        }
        const cls = classifyWardrobeHeuristic({ fileName: f.name, userText: baseName })
        const item: GalleryItem = {
          id,
          dataUrl: displayUrl,
          filePath: persisted.filePath,
          label: baseName || 'Nueva imagen',
          role: kindToRole(cls.kind),
          tags: [`kind:${cls.kind}`, ...cls.suggestedTags].slice(0, 12),
          intimacy: 0
        }
        next.push(item)
        if (!primary && next.length === 1) {
          onChange({
            ...character,
            visualImageUrl: persisted.dataUrl,
            facePrimaryUrl: character.facePrimaryUrl || persisted.dataUrl,
            visualGallery: next.slice(0, 48)
          })
          setSelectedId(id)
          return
        }
      } catch {
        /* skip */
      }
    }
    patchGallery(next)
    if (firstNewId) setSelectedId(firstNewId)
  }

  const remove = (id: string) => {
    const removed = itemsAll.find((g) => g.id === id)
    // Synthetic principal row is not a real gallery entry
    if (id === 'principal') {
      onChange({
        ...character,
        visualImageUrl: undefined,
        facePrimaryUrl:
          character.facePrimaryUrl === character.visualImageUrl
            ? undefined
            : character.facePrimaryUrl
      })
      if (selectedId === id) setSelectedId(null)
      if (lightboxId === id) setLightboxId(null)
      return
    }
    const next = (character.visualGallery || []).filter((g) => g.id !== id)
    let visualImageUrl = character.visualImageUrl
    let facePrimaryUrl = character.facePrimaryUrl
    if (removed) {
      const matchUrl = (u?: string) =>
        Boolean(
          u &&
            ((removed.dataUrl && u === removed.dataUrl) ||
              (removed.filePath && u.includes(String(removed.filePath).slice(-20))))
        )
      if (matchUrl(visualImageUrl)) visualImageUrl = undefined
      if (matchUrl(facePrimaryUrl)) facePrimaryUrl = undefined
      // Delete durable file so it cannot reappear after hydrate / restart
      if (removed.filePath) {
        void (async () => {
          try {
            await window.kawaii?.filesDeleteWardrobeImage?.(removed.filePath)
          } catch {
            try {
              await window.kawaii?.filesDelete?.(removed.filePath)
            } catch {
              /* best effort */
            }
          }
        })()
      }
    }
    onChange({
      ...character,
      visualGallery: next,
      visualImageUrl,
      facePrimaryUrl
    })
    if (selectedId === id) setSelectedId(null)
    if (lightboxId === id) setLightboxId(null)
  }

  const openLightbox = (id: string) => {
    setLightboxId(id)
    setSelectedId(id)
  }

  const navLightbox = (dir: -1 | 1) => {
    if (lightboxIndex < 0 || !items.length) return
    const i = (lightboxIndex + dir + items.length) % items.length
    setLightboxId(items[i].id)
    setSelectedId(items[i].id)
  }

  return (
    <div className="rounded-2xl border border-kawaii-pink-deep/20 bg-gradient-to-br from-white to-kawaii-pink-soft/20 p-3 space-y-3">
      <div>
        <h4 className="text-xs font-bold text-kawaii-text">Guardarropa del avatar</h4>
        <p className="text-[10px] text-kawaii-text-muted leading-relaxed mt-0.5">
          Cada foto: título/rol/tags (auto-guardado). ★ chat · ◎ FaceID. Clic = editar · doble
          clic = ver en grande. Secciones: prenda ≠ escena ≠ look.
        </p>
      </div>


      <div className="rounded-lg border border-kawaii-border bg-white/80 p-2.5 space-y-2">
        <p className="text-xs font-semibold text-kawaii-text">Encuadre en el chat (cara)</p>
        <p className="text-[10px] text-kawaii-text-muted leading-relaxed">
          La foto del chat es redonda. <strong>Auto</strong> prioriza la zona de la cara según el
          tipo de foto; <strong>Manual</strong> deja mover el recorte.
        </p>
        <div className="flex flex-wrap gap-2 text-xs">
          <button
            type="button"
            className={
              'px-2 py-1 rounded-md border ' +
              ((character as { avatarFocusMode?: string }).avatarFocusMode !== 'manual'
                ? 'bg-kawaii-pink-soft border-kawaii-pink-deep/40 font-medium'
                : 'border-kawaii-border')
            }
            onClick={() => onChange({ ...character, avatarFocusMode: 'auto' } as CharacterProfile)}
          >
            Auto (cara)
          </button>
          <button
            type="button"
            className={
              'px-2 py-1 rounded-md border ' +
              ((character as { avatarFocusMode?: string }).avatarFocusMode === 'manual'
                ? 'bg-kawaii-pink-soft border-kawaii-pink-deep/40 font-medium'
                : 'border-kawaii-border')
            }
            onClick={() =>
              onChange({
                ...character,
                avatarFocusMode: 'manual',
                avatarFocusX: (character as { avatarFocusX?: number }).avatarFocusX ?? 50,
                avatarFocusY: (character as { avatarFocusY?: number }).avatarFocusY ?? 22
              } as CharacterProfile)
            }
          >
            Manual
          </button>
        </div>
        {(character as { avatarFocusMode?: string }).avatarFocusMode === 'manual' && (
          <div className="space-y-1.5 text-[11px]">
            <label className="flex items-center gap-2">
              <span className="w-16 shrink-0">Horizontal</span>
              <input
                type="range"
                min={0}
                max={100}
                value={(character as { avatarFocusX?: number }).avatarFocusX ?? 50}
                onChange={(e) =>
                  onChange({
                    ...character,
                    avatarFocusMode: 'manual',
                    avatarFocusX: Number(e.target.value)
                  } as CharacterProfile)
                }
                className="flex-1"
              />
              <span className="w-8 tabular-nums text-right">
                {(character as { avatarFocusX?: number }).avatarFocusX ?? 50}
              </span>
            </label>
            <label className="flex items-center gap-2">
              <span className="w-16 shrink-0">Vertical</span>
              <input
                type="range"
                min={0}
                max={100}
                value={(character as { avatarFocusY?: number }).avatarFocusY ?? 22}
                onChange={(e) =>
                  onChange({
                    ...character,
                    avatarFocusMode: 'manual',
                    avatarFocusY: Number(e.target.value)
                  } as CharacterProfile)
                }
                className="flex-1"
              />
              <span className="w-8 tabular-nums text-right">
                {(character as { avatarFocusY?: number }).avatarFocusY ?? 22}
              </span>
            </label>
            <p className="text-[10px] text-kawaii-text-muted">
              Vertical bajo (≈0–30) muestra más la cara; 50 el centro; alto las piernas.
            </p>
          </div>
        )}
        <div className="flex justify-center pt-1">
          <div className="w-20 h-20 rounded-full overflow-hidden border-2 border-kawaii-border shadow-sm bg-kawaii-pink-soft/40">
            {(() => {
              const src =
                resolvedSrc['__visualImageUrl'] ||
                (items[0] && (resolvedSrc[items[0].id] || items[0].dataUrl)) ||
                ''
              if (!src || typeof src !== 'string') {
                return (
                  <span className="text-2xl flex items-center justify-center h-full">
                    {character.visualEmoji || '🌸'}
                  </span>
                )
              }
              const pos = resolveAvatarObjectPosition({
                avatarFocusMode: (character as { avatarFocusMode?: string }).avatarFocusMode,
                avatarFocusX: (character as { avatarFocusX?: number }).avatarFocusX,
                avatarFocusY: (character as { avatarFocusY?: number }).avatarFocusY
              })
              return (
                <img
                  src={src}
                  alt="Vista previa encuadre"
                  className="w-full h-full object-cover"
                  style={{ objectPosition: pos }}
                />
              )
            })()}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-1">
        {(
          [
            'all',
            'portrait_identity',
            'full_look',
            'garment',
            'accessory',
            'scene'
          ] as const
        ).map((k) => (
          <button
            key={k}
            type="button"
            className={`text-[9px] px-2 py-0.5 rounded-full border ${
              kindFilter === k
                ? 'bg-kawaii-pink-deep text-white border-kawaii-pink-deep'
                : 'border-kawaii-border text-kawaii-text-muted bg-white/80'
            }`}
            onClick={() => setKindFilter(k)}
          >
            {k === 'all' ? 'Todas' : WARDROBE_KIND_LABELS[k]}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        {items.length === 0 ? (
          <p className="text-[11px] text-kawaii-text-muted">
            {kindFilter === 'all'
              ? 'Aún no hay imágenes. Sube al menos una.'
              : 'Nada en esta sección.'}
          </p>
        ) : (
          items.map((g) => {
            const isChat = Boolean(primary && g.dataUrl === primary)
            const isFace = Boolean(facePrimary && g.dataUrl === facePrimary)
            return (
              <button
                key={g.id}
                type="button"
                className={`relative w-[76px] text-left rounded-xl transition ${
                  selectedId === g.id ? 'ring-2 ring-kawaii-pink-deep' : ''
                } ${isChat ? 'ring-2 ring-amber-400' : isFace ? 'ring-2 ring-sky-400' : ''}`}
                onClick={() => setSelectedId(g.id)}
                onDoubleClick={() => openLightbox(g.id)}
              >
                <img
                  src={srcFor(g) || undefined}
                  alt={displayTitle(g)}
                  className="w-[76px] h-[76px] object-cover rounded-xl border border-kawaii-border"
                />
                <p className="text-[9px] text-center truncate mt-0.5 text-kawaii-text-muted px-0.5">
                  {isChat ? '★ ' : isFace ? '◎ ' : ''}
                  {displayTitle(g)}
                </p>
                <span className="absolute bottom-5 left-0.5 text-[8px] px-1 rounded bg-black/55 text-white">
                  {g.role || inferRoleFromText(displayTitle(g))}
                </span>
              </button>
            )
          })
        )}
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            void addFiles(e.target.files)
            e.target.value = ''
          }}
        />
        <Button variant="ghost" className="text-[11px]" onClick={() => fileRef.current?.click()}>
          <ImagePlus className="w-3.5 h-3.5 mr-1 inline" />
          Añadir imagen(es)
        </Button>
        <Button
          variant="ghost"
          className="text-[11px]"
          onClick={() => void openWardrobeFolder()}
          title="Abre la carpeta del guardarropa en el explorador (userData/wardrobe)"
        >
          <FolderOpen className="w-3.5 h-3.5 mr-1 inline" />
          Abrir carpeta del guardarropa
        </Button>
        <p className="text-[9px] text-kawaii-text-muted">
          Máx. 48 · tras subir, edita título/tags de la seleccionada.{' '}
          <button
            type="button"
            className="underline text-rose-700/90 hover:text-rose-900 disabled:opacity-40"
            disabled={!selected}
            onClick={reclasificarSeleccion}
            title="Recalcula rol/tags con heurística; no crea otra ficha"
          >
            Reclasificar
          </button>
        </p>
      </div>

      {selected ? (
        <div className="rounded-xl border border-kawaii-border bg-white/90 p-3 space-y-2">
          <div className="flex gap-3">
            <button type="button" className="shrink-0" onClick={() => openLightbox(selected.id)}>
              <img
                src={selected ? srcFor(selected) : undefined}
                alt=""
                className="w-20 h-20 object-cover rounded-lg border border-kawaii-border bg-kawaii-pink-soft/30"
              />
              <span className="text-[9px] text-kawaii-pink-deep block text-center mt-0.5">Ampliar</span>
            </button>
            <div className="flex-1 space-y-2 min-w-0">
              <label className="block text-[10px] font-semibold text-kawaii-text-muted">
                Título de esta imagen
                <input
                  className="mt-0.5 w-full rounded-lg border border-kawaii-border px-2 py-1 text-xs bg-white"
                  value={draftTitle}
                  onChange={(e) => setDraftTitle(e.target.value)}
                  placeholder="Ej. vestido rojo, oficina…"
                />
              </label>
              <label className="block text-[10px] font-semibold text-kawaii-text-muted">
                Rol
                <select
                  className="mt-0.5 w-full rounded-lg border border-kawaii-border px-2 py-1 text-xs bg-white"
                  value={draftRole}
                  onChange={(e) => setDraftRole(e.target.value as WardrobeRole)}
                >
                  {ROLE_OPTIONS.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          <div>
            <p className="text-[10px] font-semibold text-kawaii-text-muted mb-1">
              Etiquetas (de esta foto)
            </p>
            <div className="flex flex-wrap gap-1">
              {TAG_PRESETS.map((tag) => {
                const on = draftTags.includes(tag)
                return (
                  <button
                    key={tag}
                    type="button"
                    className={
                      'text-[9px] px-1.5 py-0.5 rounded-full border ' +
                      (on
                        ? 'bg-kawaii-pink-soft border-kawaii-pink-deep text-kawaii-text'
                        : 'border-kawaii-border text-kawaii-text-muted hover:bg-kawaii-pink-soft/40')
                    }
                    onClick={() => toggleTag(tag)}
                  >
                    {tag}
                  </button>
                )
              })}
            </div>
            <div className="flex gap-1 mt-1.5">
              <input
                className="flex-1 rounded-lg border border-kawaii-border px-2 py-1 text-[10px]"
                placeholder="Tag custom (ej. outfit:abrigo)"
                value={customTag}
                onChange={(e) => setCustomTag(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const v = customTag.trim().slice(0, 32)
                    if (v) {
                      setDraftTags((p) => [...new Set([...p, v])].slice(0, 12))
                      setCustomTag('')
                    }
                  }
                }}
              />
              <Button
                variant="ghost"
                className="text-[10px]"
                onClick={() => {
                  const v = customTag.trim().slice(0, 32)
                  if (v) {
                    setDraftTags((p) => [...new Set([...p, v])].slice(0, 12))
                    setCustomTag('')
                  }
                }}
              >
                +
              </Button>
            </div>
            {draftTags.length > 0 ? (
              <p className="text-[9px] text-kawaii-text-muted mt-1">
                Activas: {draftTags.join(' · ')}
              </p>
            ) : null}
          </div>

          <label className="block text-[10px] font-semibold text-kawaii-text-muted">
            Intimidad (0 público – 3 reservado)
            <input
              type="range"
              min={0}
              max={3}
              step={1}
              className="w-full"
              value={draftIntimacy}
              onChange={(e) => setDraftIntimacy(Number(e.target.value) as 0 | 1 | 2 | 3)}
            />
          </label>

          <div className="flex flex-wrap gap-2 pt-1 items-center">
            {saveHint ? (
              <span className="text-[10px] text-emerald-700">{saveHint}</span>
            ) : (
              <span className="text-[10px] text-kawaii-text-muted">
                Los cambios se guardan solos
              </span>
            )}
            <Button
              variant="ghost"
              className="text-[11px]"
              onClick={() => setPrimary(selected.dataUrl)}
              title="Foto del bubble / header del chat"
            >
              <Star className="w-3 h-3 mr-1 inline" />
              Principal del chat
            </Button>
            <Button
              variant="ghost"
              className="text-[11px]"
              onClick={() => setFacePrimary(selected.dataUrl)}
              title="Ancla FaceID (rostro); puede ser distinta del chat"
            >
              ◎ Ancla FaceID
            </Button>
            <Button
              variant="ghost"
              className="text-[11px]"
              onClick={() => void openWardrobeFolder()}
              title="Abrir userData/wardrobe en el explorador"
            >
              <FolderOpen className="w-3 h-3 mr-1 inline" />
              Carpeta en disco
            </Button>
            <Button
              variant="ghost"
              className="text-[11px] text-red-600"
              onClick={() => remove(selected.id)}
            >
              <Trash2 className="w-3 h-3 mr-1 inline" />
              Quitar
            </Button>
          </div>
          <p className="text-[9px] text-kawaii-text-muted">
            ★ chat · ◎ FaceID (identidad). Pueden ser fotos distintas.
            {selected.filePath ? ` · en disco: …${String(selected.filePath).slice(-32)}` : ''}
          </p>
        </div>
      ) : items.length > 0 ? (
        <p className="text-[10px] text-kawaii-text-muted">
          Selecciona una miniatura para editar sus datos.
        </p>
      ) : null}

      <p className="text-[9px] text-kawaii-text-muted">
        Tras definir el look, usa «Regenerar descripción desde avatar» para fijar rasgos físicos.
      </p>

      {lightbox ? (
        <div
          className="fixed inset-0 z-[80] bg-black/70 flex items-center justify-center p-4"
          onClick={() => setLightboxId(null)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="relative max-w-[min(96vw,720px)] max-h-[90vh] flex flex-col gap-2"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between text-white text-xs px-1">
              <span className="truncate font-medium">{displayTitle(lightbox)}</span>
              <button
                type="button"
                className="p-1 rounded hover:bg-white/10"
                onClick={() => setLightboxId(null)}
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="relative flex items-center gap-2">
              <button
                type="button"
                className="p-2 rounded-full bg-black/40 text-white hover:bg-black/60"
                onClick={() => navLightbox(-1)}
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <img
                src={lightbox ? srcFor(lightbox) || undefined : undefined}
                alt={displayTitle(lightbox)}
                className="max-h-[75vh] max-w-full object-contain rounded-lg bg-black/30"
              />
              <button
                type="button"
                className="p-2 rounded-full bg-black/40 text-white hover:bg-black/60"
                onClick={() => navLightbox(1)}
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>
            <p className="text-[10px] text-white/80 text-center">
              {(lightbox.role || '—') +
                (lightbox.tags?.length ? ' · ' + lightbox.tags.join(', ') : '')}
            </p>
          </div>
        </div>
      ) : null}
    </div>
  )
}
