import { useEffect, useRef, useState } from 'react'
import { ImagePlus, Star, Trash2 } from 'lucide-react'
import { Button } from '@shared/ui/Button'
import type { CharacterProfile } from '@shared/types/settings'

type GalleryItem = NonNullable<CharacterProfile['visualGallery']>[number]

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

interface Props {
  character: CharacterProfile
  onChange: (next: CharacterProfile) => void
}

/**
 * Multi-image avatar references: primary face + optional scenes/outfits.
 */
export function AvatarGalleryPanel({ character, onChange }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [label, setLabel] = useState('')
  const gallery: GalleryItem[] = [...(character.visualGallery || [])]
  // Ensure primary avatar is always listed in multi-gallery (UI + persist once)
  if (
    character.visualImageUrl &&
    !gallery.some((g) => g.dataUrl === character.visualImageUrl || g.id === 'principal')
  ) {
    gallery.unshift({
      id: 'principal',
      dataUrl: character.visualImageUrl,
      label: 'Principal',
      scene: 'principal'
    })
  }
  const primary = (character.visualImageUrl || '').trim()

  // Persist principal into visualGallery so tests and image layer see galleryCount >= 1
  useEffect(() => {
    const url = (character.visualImageUrl || '').trim()
    if (!url) return
    const gal = character.visualGallery || []
    if (gal.some((g) => g.dataUrl === url || g.id === 'principal')) return
    onChange({
      ...character,
      visualGallery: [
        { id: 'principal', dataUrl: url, label: 'Principal', scene: 'principal' },
        ...gal
      ].slice(0, 12)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [character.visualImageUrl])

  const setPrimary = (dataUrl: string) => {
    onChange({
      ...character,
      visualImageUrl: dataUrl,
      visualFromAvatar: character.visualFromAvatar
    })
  }

  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return
    const next = [...gallery]
    for (const f of Array.from(files).slice(0, 6)) {
      if (!f.type.startsWith('image/')) continue
      if (f.size > 10 * 1024 * 1024) continue
      try {
        const dataUrl = await readFileAsDataUrl(f)
        const item: GalleryItem = {
          id: uid(),
          dataUrl,
          label: label.trim() || f.name.replace(/\.[^.]+$/, '').slice(0, 40),
          scene: label.trim() || undefined
        }
        next.push(item)
        // First image ever → also primary
        if (!primary && next.length === 1) {
          onChange({
            ...character,
            visualImageUrl: dataUrl,
            visualGallery: next.slice(0, 12)
          })
          setLabel('')
          return
        }
      } catch {
        /* skip */
      }
    }
    onChange({ ...character, visualGallery: next.slice(0, 12) })
    setLabel('')
  }

  const remove = (id: string) => {
    const next = gallery.filter((g) => g.id !== id)
    const removed = gallery.find((g) => g.id === id)
    let visualImageUrl = character.visualImageUrl
    if (removed && removed.dataUrl === visualImageUrl) {
      visualImageUrl = next[0]?.dataUrl || undefined
    }
    onChange({ ...character, visualGallery: next, visualImageUrl })
  }

  const allThumbs: Array<{ id: string; dataUrl: string; label?: string; isPrimary: boolean }> = []
  if (primary) {
    allThumbs.push({
      id: 'primary',
      dataUrl: primary,
      label: 'Principal (chat)',
      isPrimary: true
    })
  }
  for (const g of gallery) {
    if (g.dataUrl === primary) continue
    allThumbs.push({
      id: g.id,
      dataUrl: g.dataUrl,
      label: g.label || g.scene || 'Escena',
      isPrimary: false
    })
  }

  return (
    <div className="rounded-2xl border border-kawaii-pink-deep/20 bg-gradient-to-br from-white to-kawaii-pink-soft/20 p-3 space-y-2">
      <div>
        <h4 className="text-xs font-bold text-kawaii-text">Galería del avatar (multi-imagen)</h4>
        <p className="text-[10px] text-kawaii-text-muted leading-relaxed mt-0.5">
          Una foto principal para el chat y otras de referencia (otra ropa, pose, escenario). Al
          generar “fotos tuyas”, el modelo puede variar escena sin cambiar la identidad.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {allThumbs.length === 0 ? (
          <p className="text-[11px] text-kawaii-text-muted">Aún no hay imágenes. Sube al menos una.</p>
        ) : (
          allThumbs.map((t) => (
            <div
              key={t.id}
              className={`relative w-[72px] group ${
                t.isPrimary ? 'ring-2 ring-kawaii-pink-deep rounded-xl' : ''
              }`}
            >
              <img
                src={t.dataUrl}
                alt={t.label || 'avatar'}
                className="w-[72px] h-[72px] object-cover rounded-xl border border-kawaii-border"
              />
              <p className="text-[9px] text-center truncate mt-0.5 text-kawaii-text-muted">
                {t.isPrimary ? '★ Principal' : t.label}
              </p>
              <div className="absolute top-0.5 right-0.5 flex flex-col gap-0.5 opacity-0 group-hover:opacity-100 transition">
                {!t.isPrimary ? (
                  <button
                    type="button"
                    title="Usar como principal"
                    className="bg-black/65 text-white rounded p-0.5"
                    onClick={() => setPrimary(t.dataUrl)}
                  >
                    <Star className="w-3 h-3" />
                  </button>
                ) : null}
                {t.id !== 'primary' ? (
                  <button
                    type="button"
                    title="Quitar"
                    className="bg-black/65 text-white rounded p-0.5"
                    onClick={() => remove(t.id)}
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                ) : null}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex-1 min-w-[120px] text-[10px] font-semibold text-kawaii-text-muted">
          Etiqueta (opcional)
          <input
            className="mt-0.5 w-full rounded-lg border border-kawaii-border px-2 py-1 text-xs bg-white"
            placeholder="Ej. vestido rojo, oficina, playa…"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </label>
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
        <Button
          variant="ghost"
          className="text-[11px]"
          onClick={() => fileRef.current?.click()}
        >
          <ImagePlus className="w-3.5 h-3.5 mr-1 inline" />
          Añadir imagen(es)
        </Button>
      </div>
      <p className="text-[9px] text-kawaii-text-muted">
        Máx. 12 referencias · la marcada con ★ es la del chat. Tras subir, usa «Regenerar descripción
        desde avatar» para fijar rasgos físicos.
      </p>
    </div>
  )
}
