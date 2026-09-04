import { ForgeConsole } from '@features/settings/ForgeConsole'
import { ModelsStatusPanel } from '@features/models/ModelsStatusPanel'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  FolderOpen,
  Download,
  HardDrive,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  MapPin
} from 'lucide-react'
import {
  activitySuccess,
  activityError,
  activityProgress,
  activityInfo
} from '@shared/lib/stores/activityStore'
import { Button } from '@shared/ui/Button'

type DriveInfo = {
  letter: string
  freeGB: number
  totalGB: number
  isSystem: boolean
}

type Profile = {
  preferredDataRoot: string
  forgeInstallPath: string
  sdModelsPath: string
  localImageEligible: boolean
  gpuName: string | null
  vramGB: number | null
  lastPreflight: {
    ok: boolean
    reasons: string[]
    warnings: string[]
    at: string
  }
  userOverrides: {
    neverInstallOnSystemDrive: boolean
    lockDataRoot: boolean
  }
}

/**
 * Phase 2a: machine profile + preflight + data root on preferred disk.
 * Checkpoint download still uses app workspace helpers where available.
 */
export function SdWorkspacePanel({ compact = false }: { compact?: boolean }) {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [drives, setDrives] = useState<DriveInfo[]>([])
  const [forgePresent, setForgePresent] = useState(false)
  const [busy, setBusy] = useState<'scan' | 'prepare' | 'download' | 'ensure' | 'forge' | null>(null)
  const [forgePct, setForgePct] = useState<number | null>(null)
  const [forgePhaseMsg, setForgePhaseMsg] = useState('')
  const [recoveryJobs, setRecoveryJobs] = useState<
    Array<{ id: string; received: number; total: number | null; status: string; label?: string }>
  >([])
  const [runtime, setRuntime] = useState<{
    state: string
    port: number | null
    baseUrl: string | null
    message: string
    pid?: number | null
  } | null>(null)
  const [portHint, setPortHint] = useState<string>('')
  const [progress, setProgress] = useState<number | null>(null)
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')
  const [customRoot, setCustomRoot] = useState('')
  const [checkpoints, setCheckpoints] = useState<string[]>([])
  /** Toast id while Forge is booting — updated live from forge:boot-progress */
  const bootActIdRef = useRef<string | null>(null)

  const refreshCheckpoints = useCallback(async () => {
    try {
      const list = (await window.kawaii?.sdListCheckpoints?.()) ?? []
      setCheckpoints(list)
    } catch {
      setCheckpoints([])
    }
  }, [])

  const scan = useCallback(async () => {
    setBusy('scan')
    setError('')
    setMsg('')
    try {
      // Warm hardware cache in main
      await window.kawaii?.getHardwareProfile?.()
      const res = await window.kawaii?.machineEnsureProfile?.()
      if (!res?.profile) {
        setError('No se pudo leer el perfil de máquina.')
        return
      }
      setProfile(res.profile as Profile)
      setDrives((res.drives as DriveInfo[]) || [])
      setForgePresent(!!res.forgePresent)
      setCustomRoot((res.profile as Profile).preferredDataRoot)
      setMsg(
        res.created
          ? 'Perfil de máquina creado (se guarda en datos de la app).'
          : 'Perfil de máquina actualizado.'
      )
      try {
        const jobs =
          (await (
            window.kawaii as {
              forgeListRecovery?: () => Promise<
                Array<{
                  id: string
                  received: number
                  total: number | null
                  status: string
                  label?: string
                }>
              >
            }
          ).forgeListRecovery?.()) || []
        setRecoveryJobs(jobs)
        if (jobs.length > 0) {
          const j = jobs[0]
          const pct =
            j.total && j.total > 0 ? Math.round((j.received / j.total) * 100) : 0
          setMsg(
            `Recovery: descarga pendiente "${j.label || j.id}" (${j.status}${pct ? ` · ${pct}%` : ''}). Pulsa Instalar Forge o SD 1.5 para reanudar.`
          )
        }
      } catch {
        setRecoveryJobs([])
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }, [])

  useEffect(() => {
    void scan()
    void refreshCheckpoints()
    const offBoot = window.kawaii?.onForgeBootProgress?.((p) => {
      setRuntime((prev) => ({
        state: p.state || prev?.state || 'starting',
        port: p.port ?? prev?.port ?? null,
        baseUrl: p.baseUrl ?? prev?.baseUrl ?? null,
        message: p.message,
        bootProgress: p.bootProgress,
        lastLogLine: p.lastLogLine,
        elapsedMs: p.elapsedMs,
        pid: prev?.pid
      }))
      if (p.state === 'starting') {
        setMsg(p.message)
        setError('')
      }
      const actId = bootActIdRef.current
      if (actId) {
        void import('@shared/lib/stores/activityStore').then(({ useActivityStore }) => {
          const pct =
            typeof p.bootProgress === 'number'
              ? Math.max(5, Math.min(99, p.bootProgress))
              : undefined
          if (p.state === 'running') {
            useActivityStore.getState().update(actId, {
              kind: 'success',
              title: 'Forge listo',
              detail: p.baseUrl || p.message,
              progress: 100
            })
            bootActIdRef.current = null
            window.setTimeout(() => useActivityStore.getState().dismiss(actId), 5000)
          } else if (p.state === 'error') {
            useActivityStore.getState().update(actId, {
              kind: 'error',
              title: 'Forge',
              detail: p.message
            })
            bootActIdRef.current = null
          } else {
            useActivityStore.getState().update(actId, {
              kind: 'progress',
              title: 'Arrancando Forge',
              detail: p.message,
              progress: pct
            })
          }
        })
      }
    })
    const off = window.kawaii?.onSdDownloadProgress?.((p) => {
      if (p.total && p.total > 0) setProgress(Math.round(p.pct))
      else setProgress(null)
    })
    const offF = window.kawaii?.onForgeInstallProgress?.((fp) => {
      setForgePct(Math.round(fp.pct))
      setForgePhaseMsg(fp.message)
    })
    return () => {
      try {
        offBoot?.()
      } catch {
        /* ignore */
      }
      try {
        off?.()
      } catch {
        /* ignore */
      }
      try {
        offF?.()
      } catch {
        /* ignore */
      }
    }
  }, [scan, refreshCheckpoints])

  const prepareRoot = async () => {
    setBusy('prepare')
    setError('')
    try {
      await window.kawaii?.getHardwareProfile?.()
      const res = await window.kawaii?.machinePrepareDataRoot?.()
      if (!res?.profile) {
        setError('No se pudo preparar la raíz de datos.')
        return
      }
      setProfile(res.profile as Profile)
      setDrives((res.drives as DriveInfo[]) || [])
      setForgePresent(!!res.forgePresent)
      const ws = res.workspace as { root?: string; modelsDir?: string; forgeDir?: string }
      const rootMsg =
        `Carpetas listas en ${ws?.root || (res.profile as Profile).preferredDataRoot}` +
        (res.forgePresent
          ? ' · Forge detectado.'
          : ' · Instala Forge en la carpeta forge.')
      setMsg(rootMsg)
      activitySuccess('Carpetas preparadas', rootMsg)
      await refreshCheckpoints()
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e)
      setError(m)
      activityError('No se pudieron preparar carpetas', m)
    } finally {
      setBusy(null)
    }
  }

  const applyRoot = async () => {
    const root = customRoot.trim()
    if (!root) {
      setError('Indica una ruta (ej. D:\\KawaiiSD).')
      return
    }
    setBusy('prepare')
    setError('')
    try {
      await window.kawaii?.getHardwareProfile?.()
      const res = await window.kawaii?.machineSetDataRoot?.(root, true)
      if (!res?.profile) {
        setError('No se pudo guardar la ruta.')
        return
      }
      setProfile(res.profile as Profile)
      setForgePresent(!!res.forgePresent)
      setMsg(`Ruta bloqueada: ${root}`)
      activitySuccess('Ruta de datos guardada', root)
      await window.kawaii?.machinePrepareDataRoot?.()
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e)
      setError(m)
      activityError('No se pudo guardar la ruta', m)
    } finally {
      setBusy(null)
    }
  }

  const resetProfile = async () => {
    setBusy('scan')
    setError('')
    try {
      await window.kawaii?.machineClearProfile?.()
      setMsg('Perfil borrado. Re-detectando…')
      await scan()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(null)
    }
  }

  const openFolder = async () => {
    try {
      const r = await (window.kawaii as { machineOpenDataRoot?: () => Promise<{ ok: boolean; path: string }> })
        ?.machineOpenDataRoot?.()
      if (r?.path) {
        setMsg(`Abierta: ${r.path}`)
        return
      }
      await window.kawaii?.machinePrepareDataRoot?.()
      await window.kawaii?.sdOpenWorkspace?.()
      setMsg('Carpeta de workspace abierta.')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }


  const installForge = async () => {
    setBusy('forge')
    setError('')
    setForgePct(0)
    setForgePhaseMsg('Iniciando…')
    setMsg('')
    const actId = activityProgress('Instalando Forge', 'Descarga / extracción…', 0)
    try {
      await window.kawaii?.getHardwareProfile?.()
      const res = await window.kawaii?.forgeInstall?.()
      if (!res) {
        setError('IPC forge no disponible. Reinicia la app.')
        activityError('Forge', 'IPC no disponible. Reinicia la app.')
        return
      }
      if (!res.ok) {
        if (/pausad|progreso guardado/i.test(res.error || '')) {
          setMsg(res.error)
          setError('')
          activityInfo('Forge pausado', res.error || 'Puedes reanudar después.')
          try {
            const jobs =
              (await (
                window.kawaii as {
                  forgeListRecovery?: () => Promise<
                    Array<{
                      id: string
                      received: number
                      total: number | null
                      status: string
                      label?: string
                    }>
                  >
                }
              ).forgeListRecovery?.()) || []
            setRecoveryJobs(jobs)
          } catch { /* ignore */ }
          return
        }
        setError(res.cancelled ? 'Instalación cancelada.' : res.error)
        return
      }
      setForgePresent(true)
      setMsg(`Forge listo en ${res.forgeRoot}. Ejecuta run-kawaii-api.bat (el primer arranque tarda).`)
      setForgePct(100)
      const { useActivityStore } = await import('@shared/lib/stores/activityStore')
      useActivityStore.getState().update(actId, {
        kind: 'success',
        title: 'Forge instalado',
        detail: res.forgeRoot,
        progress: 100,
        ttlMs: 6000
      })
      window.setTimeout(() => useActivityStore.getState().dismiss(actId), 6000)
      await scan()
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e)
      setError(m)
      activityError('Error instalando Forge', m)
    } finally {
      setBusy(null)
    }
  }

  const cancelForge = async () => {
    await window.kawaii?.forgeCancelInstall?.()
    setMsg('Cancelando instalación…')
  }

  const openForgeDir = async () => {
    try {
      const r = await window.kawaii?.forgeOpenFolder?.()
      if (r?.path) setMsg(`Forge: ${r.path}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }


  const refreshRuntime = async () => {
    try {
      const st = await window.kawaii?.forgeRefreshHealth?.()
      if (st) setRuntime(st)
      if (st?.baseUrl && st.state === 'running') {
        // Keep settings in sync so image gen uses the live port
        try {
          const { useSettingsStore } = await import('@shared/lib/stores/settingsStore')
          useSettingsStore.getState().update({ a1111BaseUrl: st.baseUrl })
        } catch {
          /* ignore */
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const startForgeRt = async () => {
    setBusy('forge')
    setError('')
    setMsg('Arrancando Forge (puerto inteligente)…')
    const actId = activityProgress('Arrancando Forge', 'Puerto inteligente + health…', 5)
    bootActIdRef.current = actId
    try {
      const pick = await window.kawaii?.forgePickPort?.(7860)
      if (pick?.ok && pick.port) {
        setPortHint(`Puerto elegido: ${pick.port}`)
      } else if (pick && !pick.ok) {
        setError(pick.error || 'Sin puertos libres')
        bootActIdRef.current = null
        activityError('Sin puertos libres', pick.error || '')
        setBusy(null)
        return
      }
      const st = await window.kawaii?.forgeStart?.(pick?.port)
      if (st) {
        setRuntime(st)
        setMsg(st.message)
        if (st.state === 'running' && st.baseUrl) {
          try {
            const { useSettingsStore } = await import('@shared/lib/stores/settingsStore')
            useSettingsStore.getState().update({
              a1111BaseUrl: st.baseUrl,
              imageProviderMode:
                useSettingsStore.getState().settings.imageProviderMode === 'off'
                  ? 'smart'
                  : useSettingsStore.getState().settings.imageProviderMode
            })
          } catch {
            /* ignore */
          }
        }
        if (st.state === 'error') {
          setError(st.message)
          activityError('Forge no arrancó', st.message)
          bootActIdRef.current = null
        } else if (st.state === 'starting') {
          setMsg(st.message)
          setError('')
          const { useActivityStore } = await import('@shared/lib/stores/activityStore')
          useActivityStore.getState().update(actId, {
            kind: 'progress',
            title: 'Arrancando Forge',
            detail:
              st.message ||
              'Primer boot: descarga modelos. Mira la ventana de Python y Health API después.',
            progress: st.bootProgress ?? 40
          })
          // Keep toast open until boot events finish or user dismisses
        } else if (st.state === 'running') {
          const { useActivityStore } = await import('@shared/lib/stores/activityStore')
          useActivityStore.getState().update(actId, {
            kind: 'success',
            title: 'Forge listo',
            detail: st.baseUrl || st.message,
            progress: 100,
            ttlMs: 5000
          })
          bootActIdRef.current = null
          window.setTimeout(() => useActivityStore.getState().dismiss(actId), 5000)
        } else {
          activityInfo('Forge', st.message)
          bootActIdRef.current = null
        }
      }
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e)
      setError(m)
      activityError('Error al arrancar Forge', m)
    } finally {
      setBusy(null)
    }
  }

  const stopForgeRt = async () => {
    setBusy('forge')
    try {
      const st = await window.kawaii?.forgeStop?.()
      if (st) {
        setRuntime(st)
        setMsg(st.message)
        activityInfo('Forge detenido', st.message)
      }
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e)
      setError(m)
      activityError('No se pudo detener Forge', m)
    } finally {
      setBusy(null)
    }
  }


  const syncCkpt = async () => {
    setBusy('prepare')
    setError('')
    try {
      const res = await window.kawaii?.sdSyncCheckpointsToForge?.()
      if (!res?.ok) {
        setError(res?.error || 'No se pudo sincronizar')
        activityError('Sincronizar modelos', res?.error || 'Error')
        return
      }
      const msg = `Copiados: ${res.copied.length} · Ya estaban: ${res.skipped.length}`
      setMsg(msg + (res.forgeModelsDir ? ` → ${res.forgeModelsDir}` : ''))
      activitySuccess('Modelos sincronizados con Forge', msg)
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e)
      setError(m)
      activityError('Sincronizar modelos', m)
    } finally {
      setBusy(null)
    }
  }

  const testLocalFlow = async () => {
    setBusy('forge')
    setError('')
    setMsg('Probar flujo local: arranque + health…')
    const actId = activityProgress('Probar flujo local', 'Forge + API…', 10)
    try {
      await window.kawaii?.machinePrepareDataRoot?.()
      const sync = await window.kawaii?.sdSyncCheckpointsToForge?.()
      const pipe = await window.kawaii?.imageEnsureLocalPipeline?.()
      if (pipe?.baseUrl) {
        try {
          const { useSettingsStore } = await import('@shared/lib/stores/settingsStore')
          useSettingsStore.getState().update({
            a1111BaseUrl: pipe.baseUrl,
            imageProviderMode:
              useSettingsStore.getState().settings.imageProviderMode === 'off'
                ? 'smart'
                : useSettingsStore.getState().settings.imageProviderMode
          })
        } catch {
          /* ignore */
        }
        setRuntime({
          state: pipe.ok ? 'running' : 'error',
          port: pipe.port,
          baseUrl: pipe.baseUrl,
          message: pipe.message
        })
      }
      const { useActivityStore } = await import('@shared/lib/stores/activityStore')
      if (pipe?.ok) {
        setMsg(pipe.message)
        useActivityStore.getState().update(actId, {
          kind: 'success',
          title: 'Flujo local listo',
          detail: `${pipe.message}${sync?.copied?.length ? ` · sync +${sync.copied.length}` : ''}`,
          progress: 100,
          ttlMs: 7000
        })
        window.setTimeout(() => useActivityStore.getState().dismiss(actId), 7000)
      } else {
        setError(pipe?.message || 'Pipeline local falló')
        useActivityStore.getState().update(actId, {
          kind: 'error',
          title: 'Flujo local incompleto',
          detail: pipe?.message || 'Revisa Forge e instalación',
          ttlMs: 12_000
        })
        window.setTimeout(() => useActivityStore.getState().dismiss(actId), 12_000)
      }
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e)
      setError(m)
      activityError('Probar flujo local', m)
    } finally {
      setBusy(null)
    }
  }

  const downloadCkpt = async () => {
    setBusy('download')
    setError('')
    setMsg('Descargando SD 1.5 de prueba…')
    setProgress(0)
    try {
      await window.kawaii?.sdEnsureWorkspace?.()
      const res = await window.kawaii?.sdDownloadCheckpoint?.()
      if (!res?.ok) {
        setError((res as { error?: string })?.error || 'Descarga fallida')
        return
      }
      setMsg(`Checkpoint: ${(res as { path: string }).path}`)
      setProgress(100)
      await refreshCheckpoints()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const pf = profile?.lastPreflight

  return (
    <div
      className={
        compact
          ? 'space-y-2 text-xs'
          : 'border border-kawaii-border rounded-kawaii p-3 space-y-2'
      }
    >
      {!compact && (
        <h3 className="font-bold text-sm flex items-center gap-1.5 text-kawaii-text">
          <HardDrive className="w-4 h-4 text-kawaii-pink-deep" />
          Datos locales / Stable Diffusion
        </h3>
      )}

      <p className="text-[11px] text-kawaii-text-muted leading-relaxed">
        La app elige una unidad con espacio (prefiere no usar el disco del sistema), guarda el
        perfil en machine-profile.json y prepara carpetas. La instalación completa de Forge es el
        siguiente paso. Las descargas se pueden{' '}
        <strong>pausar y reanudar</strong> aunque cierres la app o se apague el PC.
      </p>

      {profile && (
        <div className="rounded-kawaii bg-kawaii-pink-soft/40 border border-kawaii-border px-2 py-1.5 text-[11px] space-y-0.5">
          <p>
            <span className="font-semibold">Raíz:</span>{' '}
            <span className="break-all">{profile.preferredDataRoot}</span>
            {profile.userOverrides.lockDataRoot ? ' (fija)' : ''}
          </p>
          {profile.gpuName && (
            <p className="text-kawaii-text-muted truncate">
              GPU: {profile.gpuName}
              {profile.vramGB != null ? ` · ~${profile.vramGB} GB VRAM` : ''}
            </p>
          )}
          <p className={pf?.ok ? 'text-emerald-700' : 'text-amber-700'}>
            Preflight: {pf?.ok ? 'apto para local' : 'mejor cloud por ahora'}
            {forgePresent ? ' · Forge detectado' : ''}
          </p>
          {pf?.reasons?.map((r) => (
            <p key={r} className="text-red-600 flex gap-1">
              <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
              {r}
            </p>
          ))}
          {pf?.warnings?.map((w) => (
            <p key={w} className="text-amber-700">
              ⚠ {w}
            </p>
          ))}
        </div>
      )}

      {drives.length > 0 && !compact && (
        <div className="text-[10px] text-kawaii-text-muted">
          <p className="font-semibold text-kawaii-text mb-0.5">Discos detectados</p>
          <ul className="space-y-0.5">
            {drives.map((d) => (
              <li key={d.letter}>
                {d.letter} · {d.freeGB} GB libres / {d.totalGB} GB
                {d.isSystem ? ' · sistema' : ''}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <label className="text-[10px] font-semibold text-kawaii-text flex items-center gap-1">
          <MapPin className="w-3 h-3" />
          Carpeta de datos (editable)
        </label>
        <div className="flex gap-1 flex-wrap">
          <input
            className="input-kawaii text-xs flex-1 min-w-[12rem]"
            value={customRoot}
            onChange={(e) => setCustomRoot(e.target.value)}
            placeholder="D:\\KawaiiSD"
          />
          <Button
            variant="ghost"
            className="text-xs"
            disabled={busy !== null}
            onClick={() => void applyRoot()}
          >
            Guardar ruta
          </Button>
        </div>
      </div>

      
      {runtime && (
        <div className="rounded-kawaii border border-kawaii-border px-2 py-1.5 text-[11px] space-y-1">
          <div className="space-y-2">
            <p className="font-semibold text-kawaii-text">Estado de modelos y descargas</p>
            <ModelsStatusPanel />
            <p className="text-[10px] text-kawaii-text-muted">
              Instalado = archivo en disco · En curso = barra inferior · Fallido = Continuar
              (recovery). Los checkpoints se sincronizan a Forge con «SD 1.5 prueba» o al generar.
            </p>
          </div>
          <p className="font-semibold text-kawaii-text mt-2">Runtime Forge</p>
          <p>
            Estado:{' '}
            <span
              className={
                runtime.state === 'running'
                  ? 'text-emerald-700'
                  : runtime.state === 'starting'
                    ? 'text-amber-700'
                    : runtime.state === 'error'
                      ? 'text-red-600'
                      : 'text-kawaii-text-muted'
              }
            >
              {runtime.state}
            </span>
            {runtime.port != null ? ` · puerto ${runtime.port}` : ''}
            {typeof runtime.elapsedMs === 'number'
              ? ` · ${Math.floor(runtime.elapsedMs / 60000)}m ${Math.floor((runtime.elapsedMs % 60000) / 1000)}s`
              : ''}
          </p>
          {runtime.baseUrl && (
            <p className="text-kawaii-text-muted break-all">API: {runtime.baseUrl}</p>
          )}
          <p className="text-kawaii-text-muted">{runtime.message}</p>
          {runtime.lastLogLine && runtime.lastLogLine !== runtime.message && (
            <p className="text-[10px] text-kawaii-text-muted font-mono truncate">
              {runtime.lastLogLine}
            </p>
          )}
          {runtime.state === 'starting' && typeof runtime.bootProgress === 'number' && (
            <div className="h-1.5 rounded-full bg-kawaii-pink-soft overflow-hidden">
              <div
                className="h-full bg-kawaii-pink-deep transition-all duration-500"
                style={{ width: `${Math.max(3, Math.min(100, runtime.bootProgress))}%` }}
              />
            </div>
          )}
          {runtime.state === 'starting' && (
            <p className="text-[10px] text-amber-800">
              El primer arranque descarga VAE/modelos (~2 GB). No cierres la ventana negra de
              Python. Cuando termine, pulsa Health API o Generar imagen.
            </p>
          )}
          {portHint && <p className="text-kawaii-text-muted">{portHint}</p>}
        </div>
      )}

      {recoveryJobs.filter((j) => j.status !== 'completed').length > 0 && (
        <div className="rounded-kawaii border border-amber-300 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-900 space-y-1">
          <p className="font-semibold">Descargas incompletas (recovery)</p>
          {recoveryJobs
            .filter((j) => j.status !== 'completed')
            .map((j) => {
              const pct =
                j.total && j.total > 0
                  ? Math.round((j.received / j.total) * 100)
                  : j.received > 0
                    ? null
                    : 0
              const mb = j.received > 0 ? `${Math.round(j.received / 1024 / 1024)} MB` : ''
              return (
                <p key={j.id}>
                  {j.label || j.id}: {j.status}
                  {pct != null ? ` · ${pct}%` : mb ? ` · ${mb}` : ''}
                  {' — '}
                  reanuda con el botón (progreso en disco).
                </p>
              )
            })}
        </div>
      )}

      
      <div className="rounded-kawaii border border-kawaii-border bg-white/70 px-2 py-1.5 text-[10px] text-kawaii-text-muted space-y-0.5">
        <ForgeConsole />
        <p className="font-semibold text-kawaii-text text-[11px]">Guía rápida de botones</p>
        <p><strong className="text-kawaii-text">Instalar / Reanudar Forge</strong> — portable ~3.5 GB, pausable; recovery si se corta la red.</p>
        <p><strong className="text-kawaii-text">Arrancar Forge API</strong> — servidor local (puerto 7860+). El primer boot puede tardar.</p>
        <p><strong className="text-kawaii-text">Health API</strong> — solo comprueba si la API responde.</p>
        <p><strong className="text-kawaii-text">SD 1.5 prueba</strong> — descarga modelo base de prueba y sincroniza.</p>
        <p><strong className="text-kawaii-text">Abrir carpeta / raíz</strong> — ve archivos reales en disco.</p>
        <p>Arriba: <em>instalados · descargando · fallidos</em> en vivo (mismo estado que la barra inferior).</p>
      </div>
<div className="flex flex-wrap gap-2">
        <Button
          variant="ghost"
          className="text-xs"
          disabled={busy !== null}
          onClick={() => void scan()}
        >
          {busy === 'scan' ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <RefreshCw className="w-3.5 h-3.5" />
          )}
          Re-detectar
        </Button>
        <Button
          variant="ghost"
          className="text-xs"
          disabled={busy !== null}
          onClick={() => void prepareRoot()}
        >
          {busy === 'prepare' ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <HardDrive className="w-3.5 h-3.5" />
          )}
          Preparar carpetas
        </Button>
        <Button
          variant="ghost"
          className="text-xs"
          disabled={
            busy !== null ||
            (profile != null && !profile.lastPreflight.ok)
          }
          onClick={() => void installForge()}
        >
          {busy === 'forge' ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Download className="w-3.5 h-3.5" />
          )}
          {recoveryJobs.some((j) => j.id.includes('forge') || j.id.includes('webui')) ? 'Reanudar Forge' : 'Instalar Forge (~3.5 GB)'}
        </Button>
        {busy === 'forge' && (
          <>
            <Button
              variant="ghost"
              className="text-xs"
              onClick={async () => {
                await (
                  window.kawaii as { forgePauseInstall?: () => Promise<{ ok: boolean }> }
                ).forgePauseInstall?.()
                setMsg('Pausa solicitada — el progreso queda en disco.')
              }}
            >
              Pausar
            </Button>
            <Button variant="ghost" className="text-xs" onClick={() => void cancelForge()}>
              Cancelar
            </Button>
          </>
        )}
        <Button
          variant="ghost"
          className="text-xs"
          disabled={busy !== null}
          onClick={() => void startForgeRt()}
        >
          {busy === 'forge' && runtime?.state === 'starting' ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <HardDrive className="w-3.5 h-3.5" />
          )}
          Arrancar Forge API
        </Button>
        <Button
          variant="ghost"
          className="text-xs"
          disabled={busy !== null}
          onClick={() => void stopForgeRt()}
        >
          Detener Forge
        </Button>
        <Button
          variant="ghost"
          className="text-xs"
          disabled={busy !== null}
          onClick={() => void refreshRuntime()}
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Health API
        </Button>
        <Button
          variant="ghost"
          className="text-xs"
          disabled={busy !== null}
          onClick={() => void openForgeDir()}
        >
          <FolderOpen className="w-3.5 h-3.5" />
          Abrir carpeta Forge
        </Button>
        <Button
          variant="ghost"
          className="text-xs"
          disabled={busy !== null}
          onClick={() => void openFolder()}
        >
          <FolderOpen className="w-3.5 h-3.5" />
          Abrir raíz datos
        </Button>
        <Button
          variant="ghost"
          className="text-xs"
          disabled={busy !== null}
          onClick={() => void downloadCkpt()}
        >
          {busy === 'download' ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Download className="w-3.5 h-3.5" />
          )}
          SD 1.5 prueba
        </Button>
        <Button
          variant="ghost"
          className="text-xs text-kawaii-text-muted"
          disabled={busy !== null}
          onClick={() => void resetProfile()}
        >
          Borrar perfil
        </Button>
      </div>

            {busy === 'forge' && (
        <div className="space-y-0.5">
          <p className="text-[10px] text-kawaii-text-muted">{forgePhaseMsg}</p>
          {forgePct != null && (
            <>
              <div className="h-1.5 rounded-full bg-kawaii-pink-soft overflow-hidden">
                <div
                  className="h-full bg-kawaii-pink-deep transition-all"
                  style={{ width: `${Math.min(100, forgePct)}%` }}
                />
              </div>
              <p className="text-[10px] text-kawaii-text-muted">{forgePct}%</p>
            </>
          )}
        </div>
      )}

{busy === 'download' && progress != null && (
        <div className="space-y-0.5">
          <div className="h-1.5 rounded-full bg-kawaii-pink-soft overflow-hidden">
            <div
              className="h-full bg-kawaii-pink-deep transition-all"
              style={{ width: `${Math.min(100, progress)}%` }}
            />
          </div>
          <p className="text-[10px] text-kawaii-text-muted">{progress}%</p>
        </div>
      )}

      {msg && (
        <p className="text-[11px] text-emerald-700 flex items-start gap-1">
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span className="break-all">{msg}</span>
        </p>
      )}
      {error && <p className="text-[11px] text-red-600 break-all">{error}</p>}

      {checkpoints.length > 0 && (
        <div className="text-[11px]">
          <p className="font-semibold text-kawaii-text">Checkpoints (carpeta app):</p>
          <ul className="list-disc ml-4 text-kawaii-text-muted">
            {checkpoints.map((c) => (
              <li key={c} className="truncate">
                {c}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
