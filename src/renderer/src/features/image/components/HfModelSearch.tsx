import { useState } from 'react'
import { activityInfo, activityError } from '@shared/lib/stores/activityStore'

type HfHit = {
  id: string
  label: string
  repo: string
  downloads: number
  likes: number
  tags: string[]
  pageUrl: string
}

/** Search HF text-to-image models; open repo so user can grab .safetensors (or future direct file pick). */
export function HfModelSearch({ onRefreshInstalled }: { onRefreshInstalled?: () => void }) {
  const [q, setQ] = useState('realistic vision')
  const [busy, setBusy] = useState(false)
  const [hits, setHits] = useState<HfHit[]>([])
  const [err, setErr] = useState<string | null>(null)

  const search = async () => {
    setBusy(true)
    setErr(null)
    try {
      const r = await window.kawaii?.sdSearchHuggingFace?.(q, 12)
      if (!r?.ok) {
        setErr(r?.error || 'Búsqueda fallida')
        setHits([])
      } else {
        setHits((r.results || []) as HfHit[])
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-xl border border-kawaii-border p-3 space-y-2 bg-white/70">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-xs font-semibold text-kawaii-text">Buscar en Hugging Face</h4>
        <button
          type="button"
          className="text-[10px] text-kawaii-pink-deep underline"
          onClick={() => onRefreshInstalled?.()}
        >
          Actualizar instalados
        </button>
      </div>
      <p className="text-[10px] text-kawaii-text-muted">
        Catálogo orientativo (diffusers / checkpoints). Abre el repo y descarga un{" "}
        <code>.safetensors</code> a la carpeta Stable-diffusion de Forge; luego sincroniza.
      </p>
      <div className="flex gap-1.5">
        <input
          className="flex-1 text-xs rounded-lg border border-kawaii-border px-2 py-1.5"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="ej. anime, photoreal, dreamshaper…"
          onKeyDown={(e) => {
            if (e.key === 'Enter') void search()
          }}
        />
        <button
          type="button"
          disabled={busy || q.trim().length < 2}
          className="text-xs px-2.5 py-1.5 rounded-lg bg-kawaii-pink text-white disabled:opacity-40"
          onClick={() => void search()}
        >
          {busy ? '…' : 'Buscar'}
        </button>
      </div>
      {err ? <p className="text-[10px] text-red-600">{err}</p> : null}
      <ul className="max-h-40 overflow-y-auto space-y-1">
        {hits.map((h) => (
          <li
            key={h.id}
            className="flex items-start justify-between gap-2 text-[11px] border-b border-kawaii-border/40 py-1"
          >
            <div className="min-w-0">
              <p className="font-medium truncate">{h.label}</p>
              <p className="text-[10px] text-kawaii-text-muted truncate">
                {h.repo} · ↓{h.downloads} · ♥{h.likes}
              </p>
            </div>
            <a
              className="shrink-0 text-kawaii-pink-deep underline"
              href={h.pageUrl}
              target="_blank"
              rel="noreferrer"
              onClick={() => activityInfo('Hugging Face', 'Descarga el .safetensors y ponlo en models/Stable-diffusion')}
            >
              Repo
            </a>
          </li>
        ))}
      </ul>
    </div>
  )
}
