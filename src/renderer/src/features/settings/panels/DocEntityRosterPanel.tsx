/**
 * D3 — Visible document character rosters (read-only + clear index).
 * Data comes from DocReadingState.entityIndex (hidden structure stays in reading store).
 */
import { useCallback, useEffect, useState } from 'react'
import { BookOpen, Trash2, RefreshCw } from 'lucide-react'
import {
  listDocEntityRosters,
  clearDocEntityIndex,
  type DocEntityRosterSummary
} from '@features/chat/services/documentReadingStore'

export function DocEntityRosterPanel() {
  const [rows, setRows] = useState<DocEntityRosterSummary[]>([])

  const refresh = useCallback(() => {
    try {
      setRows(listDocEntityRosters())
    } catch {
      setRows([])
    }
  }, [])

  useEffect(() => {
    refresh()
    const onChange = () => refresh()
    try {
      window.addEventListener('kawaii:doc-reading-changed', onChange)
    } catch {
      /* */
    }
    return () => {
      try {
        window.removeEventListener('kawaii:doc-reading-changed', onChange)
      } catch {
        /* */
      }
    }
  }, [refresh])

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[12px] font-semibold text-kawaii-text flex items-center gap-1.5">
            <BookOpen className="w-3.5 h-3.5" />
            Personajes de documentos
          </p>
          <p className="text-[10px] text-kawaii-text-muted mt-0.5">
            Elenco indexado al leer (no es la memoria de personas reales). Solo lectura; puedes borrar el índice de un archivo sin borrar el progreso de capítulos.</p>
        </div>
        <button
          type="button"
          className="text-[10px] px-2 py-1 rounded-full border border-kawaii-border bg-white hover:bg-violet-50 text-kawaii-text inline-flex items-center gap-1"
          onClick={() => refresh()}
        >
          <RefreshCw className="w-3 h-3" />
          Actualizar
        </button>
      </div>

      {!rows.length ? (
        <p className="text-[10px] text-kawaii-text-muted italic">
          Aún no hay elencos. Aparecen al avanzar la lectura de un documento (D1/D2).
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li
              key={r.key}
              className="rounded-lg border border-kawaii-border bg-white/80 p-2.5 space-y-1.5"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-[11px] font-medium text-kawaii-text">
                    «{r.fileName}»
                    {r.readingComplete ? (
                      <span className="ml-1 text-[9px] text-emerald-700">· lectura completa</span>
                    ) : (
                      <span className="ml-1 text-[9px] text-amber-700">· en curso</span>
                    )}
                  </p>
                  <p className="text-[9px] text-kawaii-text-muted">
                    {r.characterCount} personaje(s)
                    {r.updatedAt
                      ? ` · ${new Date(r.updatedAt).toLocaleString()}`
                      : ''}
                  </p>
                </div>
                <button
                  type="button"
                  title="Olvidar elenco de este archivo"
                  className="text-[10px] px-2 py-1 rounded-full border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-800 inline-flex items-center gap-1"
                  onClick={() => {
                    if (
                      !window.confirm(
                        `¿Borrar el índice de personajes de «${r.fileName}»? El progreso de capítulos se conserva.`
                      )
                    ) {
                      return
                    }
                    clearDocEntityIndex(r.key)
                    refresh()
                  }}
                >
                  <Trash2 className="w-3 h-3" />
                  Olvidar elenco
                </button>
              </div>
              {r.characterNames.length ? (
                <p className="text-[10px] text-kawaii-text leading-relaxed">
                  <span className="text-kawaii-text-muted">Personajes: </span>
                  {r.characterNames.join(' · ')}
                </p>
              ) : null}
              {r.placeNames.length ? (
                <p className="text-[10px] text-kawaii-text-muted">
                  Lugares: {r.placeNames.join(' · ')}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
