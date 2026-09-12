import { useEffect, useState } from 'react'
import { X, RefreshCw, Info, Monitor, Sparkles } from 'lucide-react'
import { Button } from '@shared/ui/Button'
import { APP_LABEL, APP_VERSION, APP_NAME } from '@shared/version'
import {
  buildSystemCapabilityReport,
  levelEmoji,
  levelLabelEs,
  type SystemCapabilityReport,
  type HwSnapshot
} from '@core/system/capabilityReport'

interface Props {
  open: boolean
  onClose: () => void
}

export function AboutSystemModal({ open, onClose }: Props) {
  const [hw, setHw] = useState<HwSnapshot | null>(null)
  const [report, setReport] = useState<SystemCapabilityReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [tab, setTab] = useState<'equipo' | 'pcs' | 'acerca'>('equipo')

  const load = async () => {
    setLoading(true)
    setErr(null)
    try {
      const profile = await window.kawaii?.getHardwareProfile?.()
      const snap: HwSnapshot = profile
        ? {
            totalMemoryGB: profile.totalMemoryGB,
            cpuCores: profile.cpuCores,
            architecture: profile.architecture,
            gpuName: profile.gpuName,
            vramGB: profile.vramGB,
            hasDiscreteGpu: profile.hasDiscreteGpu
          }
        : {
            totalMemoryGB: 0,
            cpuCores: 0,
            architecture: 'unknown'
          }
      setHw(snap)
      setReport(buildSystemCapabilityReport(snap))
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!open) return
    void load()
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-black/35 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-label="Acerca de y tu equipo"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="w-full max-w-lg max-h-[min(90vh,640px)] overflow-hidden flex flex-col rounded-2xl border border-kawaii-border bg-white shadow-xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-kawaii-border bg-gradient-to-r from-kawaii-pink-soft/40 to-white">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xl" aria-hidden>
              🌸
            </span>
            <div className="min-w-0">
              <p className="font-semibold text-sm text-kawaii-text truncate">Tu equipo y la app</p>
              <p className="text-[11px] text-kawaii-text-muted truncate">{APP_LABEL}</p>
            </div>
          </div>
          <button
            type="button"
            className="p-1.5 rounded-lg hover:bg-black/5"
            aria-label="Cerrar"
            onClick={onClose}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex gap-1 px-3 pt-2">
          <button
            type="button"
            className={`flex-1 text-xs py-1.5 rounded-lg border ${
              tab === 'equipo'
                ? 'bg-kawaii-pink-soft border-kawaii-pink-deep/30 font-semibold'
                : 'border-transparent text-kawaii-text-muted hover:bg-black/[0.03]'
            }`}
            onClick={() => setTab('equipo')}
          >
            <Monitor className="w-3.5 h-3.5 inline mr-1 -mt-0.5" />
            Tu PC
          </button>
          <button
            type="button"
            className={`flex-1 text-xs py-1.5 rounded-lg border ${
              tab === 'pcs'
                ? 'bg-kawaii-pink-soft border-kawaii-pink-deep/30 font-semibold'
                : 'border-transparent text-kawaii-text-muted hover:bg-black/[0.03]'
            }`}
            onClick={() => setTab('pcs')}
          >
            PCs recomendados
          </button>
          <button
            type="button"
            className={`flex-1 text-xs py-1.5 rounded-lg border ${
              tab === 'acerca'
                ? 'bg-kawaii-pink-soft border-kawaii-pink-deep/30 font-semibold'
                : 'border-transparent text-kawaii-text-muted hover:bg-black/[0.03]'
            }`}
            onClick={() => setTab('acerca')}
          >
            <Info className="w-3.5 h-3.5 inline mr-1 -mt-0.5" />
            Acerca de
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 text-sm">
          
          {tab === 'pcs' && report && (
            <div className="space-y-3">
              <p className="text-xs text-kawaii-text leading-relaxed">
                Estas son <strong>combinaciones de piezas de PC de casa</strong> pensadas para
                KawaiiGPT. No hace falta un servidor: elige un nivel y procura que GPU y RAM
                vayan a la par (una GPU potente con poca RAM se queda corta, y al revés).
              </p>
              {report.hardwareBuilds.map((b) => (
                <div
                  key={b.id}
                  className={`rounded-xl border px-3 py-2.5 ${
                    b.id === 'recommended'
                      ? 'border-kawaii-pink-deep/40 bg-kawaii-pink-soft/25'
                      : 'border-kawaii-border bg-white'
                  }`}
                >
                  <p className="text-xs font-semibold">
                    {b.id === 'recommended' ? '★ ' : ''}
                    {b.title}
                  </p>
                  <p className="text-[11px] text-kawaii-text-muted mt-0.5">{b.tagline}</p>
                  <p className="text-xs mt-1.5 leading-relaxed">{b.appExperience}</p>
                  <ul className="mt-2 space-y-1.5">
                    {b.parts.map((part) => (
                      <li key={part.role} className="text-[11px] leading-snug">
                        <span className="font-semibold">{part.role}:</span> {part.suggestion}
                        <span className="block text-kawaii-text-muted pl-0 mt-0.5">{part.why}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="text-[11px] mt-2 leading-relaxed border-t border-kawaii-border/60 pt-1.5">
                    <strong>Por qué encajan:</strong> {b.fitsTogether}
                  </p>
                </div>
              ))}
              <p className="text-[11px] text-kawaii-text-muted leading-relaxed">
                Marcas concretas (NVIDIA/AMD, Intel/AMD CPU) son orientativas: lo importante es la{' '}
                <strong>memoria de la GPU (VRAM)</strong>, la <strong>RAM del sistema</strong> y un{' '}
                <strong>SSD</strong>. La app detecta tu equipo en la pestaña «Tu PC».
              </p>
            </div>
          )}

          {tab === 'acerca' && (
            <div className="space-y-3 text-kawaii-text">
              <p className="text-sm leading-relaxed">
                <strong>{APP_NAME}</strong> es un compañero de IA para Windows: chat con
                personalidad, imágenes y música cuando tu PC lo permite. Prioriza que todo sea
                automático y comprensible, sin tener que ser técnico.
              </p>
              <ul className="text-xs text-kawaii-text-muted space-y-1.5 list-disc pl-4">
                <li>Versión: <strong className="text-kawaii-text">{APP_VERSION}</strong></li>
                <li>Chat local (Ollama) y/o nubes (Groq, OpenRouter, Gemini…)</li>
                <li>Imágenes locales (Forge) o en la nube</li>
                <li>Música local (ACE-Step) cuando hay GPU suficiente</li>
                <li>Las capas pesadas se turnan para no saturar la tarjeta gráfica</li>
              </ul>
              <p className="text-[11px] text-kawaii-text-muted leading-relaxed">
                Esta ventana resume qué puede hacer <em>tu</em> equipo con la app. No sustituye al
                Asistente de configuración: úsalo la primera vez para instalar lo básico.
              </p>
            </div>
          )}

          {tab === 'equipo' && (
            <>
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] text-kawaii-text-muted">
                  Datos leídos de este PC (no se envían a internet).
                </p>
                <Button
                  variant="ghost"
                  className="!text-xs !py-1"
                  disabled={loading}
                  onClick={() => void load()}
                >
                  <RefreshCw className={`w-3.5 h-3.5 mr-1 ${loading ? 'animate-spin' : ''}`} />
                  Actualizar
                </Button>
              </div>

              {err && (
                <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5">
                  {err}
                </p>
              )}

              {report && (
                <>
                  <div className="rounded-xl border border-kawaii-border bg-kawaii-pink-soft/30 px-3 py-2.5">
                    <p className="font-semibold text-sm flex items-center gap-1.5">
                      <Sparkles className="w-4 h-4 text-kawaii-pink-deep" />
                      {report.headline}
                    </p>
                    <p className="text-xs text-kawaii-text-muted mt-1 leading-relaxed">
                      {report.overallBlurb}
                    </p>
                    <p className="text-[11px] mt-1.5">
                      Nivel general:{' '}
                      <strong>
                        {levelEmoji(report.overallLevel)} {levelLabelEs(report.overallLevel)}
                      </strong>
                    </p>
                    <p className="text-[11px] mt-2 leading-relaxed text-kawaii-text">
                      <strong>Respecto al PC recomendado:</strong> {report.vsRecommended}
                    </p>
                    <p className="text-[11px] mt-1 leading-relaxed text-kawaii-text-muted">
                      <strong>Respecto al máximo:</strong> {report.vsMax}
                    </p>
                  </div>

                  <section>
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-kawaii-text-muted mb-1.5">
                      Lo que vemos en tu equipo
                    </h3>
                    <ul className="text-xs space-y-1 bg-white border border-kawaii-border rounded-xl px-3 py-2">
                      {report.hardwareLines.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  </section>

                  <section>
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-kawaii-text-muted mb-1.5">
                      Qué puedes hacer aquí
                    </h3>
                    <div className="space-y-2">
                      {report.capabilities.map((c) => (
                        <div
                          key={c.id}
                          className="rounded-xl border border-kawaii-border px-3 py-2 bg-white"
                        >
                          <p className="text-xs font-semibold">
                            {levelEmoji(c.level)} {c.title}{' '}
                            <span className="font-normal text-kawaii-text-muted">
                              · {levelLabelEs(c.level)}
                            </span>
                          </p>
                          <p className="text-xs mt-0.5 leading-relaxed">{c.summary}</p>
                          {c.tip && (
                            <p className="text-[11px] text-kawaii-text-muted mt-1 leading-relaxed">
                              Consejo: {c.tip}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </section>

                  <section>
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-kawaii-text-muted mb-1.5">
                      Programas que encajan entre sí
                    </h3>
                    <div className="space-y-2">
                      {report.productStack.map((p) => (
                        <div
                          key={p.name}
                          className="rounded-xl border border-kawaii-border px-3 py-2 bg-white text-xs"
                        >
                          <p className="font-semibold">{p.name}</p>
                          <p className="text-kawaii-text-muted">{p.role}</p>
                          <p className="mt-0.5 leading-relaxed">{p.note}</p>
                        </div>
                      ))}
                    </div>
                  </section>

                  <section>
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-kawaii-text-muted mb-1.5">
                      Consejos simples
                    </h3>
                    <ul className="text-xs space-y-1.5 list-disc pl-4 text-kawaii-text">
                      {report.tips.map((tip) => (
                        <li key={tip} className="leading-relaxed">
                          {tip}
                        </li>
                      ))}
                    </ul>
                  </section>
                </>
              )}

              {!report && loading && (
                <p className="text-xs text-kawaii-text-muted">Leyendo tu equipo…</p>
              )}
            </>
          )}
        </div>

        <div className="px-4 py-2.5 border-t border-kawaii-border flex justify-end">
          <Button variant="secondary" className="text-xs" onClick={onClose}>
            Cerrar
          </Button>
        </div>
      </div>
    </div>
  )
}
