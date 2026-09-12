/**
 * Detect / install useful Forge (A1111) extensions & ControlNet assets.
 * Forge usually ships ControlNet built-in; we ensure models folder + optional git extensions.
 */
import { existsSync } from 'fs'
import { mkdir, readdir } from 'fs/promises'
import { join } from 'path'
import { loadMachineProfile } from './machine-profile'
import { resumableDownload } from './resumable-download'

export type ForgeExtStatus = {
  forgeRoot: string | null
  controlNetBuiltIn: boolean
  controlNetModelsDir: string | null
  controlNetModels: string[]
  extensionsDir: string | null
  extensions: Array<{ name: string; path: string }>
  recommended: Array<{ id: string; title: string; status: 'ok' | 'missing' | 'optional'; detail: string }>
}

async function resolveForgeRoot(): Promise<string | null> {
  try {
    const p = await loadMachineProfile()
    const root =
      (p as { forgeInstallPath?: string; sdWorkRoot?: string } | null)?.forgeInstallPath ||
      (p as { sdWorkRoot?: string } | null)?.sdWorkRoot
    if (root && existsSync(root)) return root
  } catch {
    /* ignore */
  }
  return null
}

function controlNetDirs(forgeRoot: string): string[] {
  return [
    join(forgeRoot, 'webui', 'models', 'ControlNet'),
    join(forgeRoot, 'models', 'ControlNet'),
    join(forgeRoot, 'webui', 'models', 'ControlNetPreprocessor'),
    join(forgeRoot, 'models', 'ControlNetPreprocessor')
  ]
}

export async function getForgeExtensionsStatus(): Promise<ForgeExtStatus> {
  const forgeRoot = await resolveForgeRoot()
  if (!forgeRoot) {
    return {
      forgeRoot: null,
      controlNetBuiltIn: false,
      controlNetModelsDir: null,
      controlNetModels: [],
      extensionsDir: null,
      extensions: [],
      recommended: [
        {
          id: 'forge',
          title: 'Forge instalado',
          status: 'missing',
          detail: 'Instala Forge desde Capas antes de extensiones'
        }
      ]
    }
  }

  const webui = existsSync(join(forgeRoot, 'webui')) ? join(forgeRoot, 'webui') : forgeRoot
  const extDir = join(webui, 'extensions')
  const extensions: Array<{ name: string; path: string }> = []
  if (existsSync(extDir)) {
    try {
      for (const name of await readdir(extDir)) {
        if (name.startsWith('.')) continue
        extensions.push({ name, path: join(extDir, name) })
      }
    } catch {
      /* ignore */
    }
  }

  // Forge embeds ControlNet; classic A1111 uses sd-webui-controlnet extension
  const hasCnExt = extensions.some((e) => /controlnet/i.test(e.name))
  const cnDirs = controlNetDirs(forgeRoot)
  let controlNetModelsDir: string | null = null
  const controlNetModels: string[] = []
  for (const d of cnDirs) {
    if (!existsSync(d)) continue
    if (!controlNetModelsDir) controlNetModelsDir = d
    try {
      for (const f of await readdir(d)) {
        if (/\.(safetensors|pt|pth|ckpt)$/i.test(f)) controlNetModels.push(f)
      }
    } catch {
      /* ignore */
    }
  }

  const controlNetBuiltIn = hasCnExt || true // Forge always has CN scripts in tree

  const recommended: ForgeExtStatus['recommended'] = [
    {
      id: 'controlnet-core',
      title: 'ControlNet (Forge integrado)',
      status: 'ok',
      detail: hasCnExt
        ? `Extensión: ${extensions.find((e) => /controlnet/i.test(e.name))?.name}`
        : 'Forge incluye ControlNet/API alwayson_scripts'
    },
    {
      id: 'controlnet-models',
      title: 'Modelos ControlNet (canny/openpose/depth…)',
      status: controlNetModels.length > 0 ? 'ok' : 'missing',
      detail:
        controlNetModels.length > 0
          ? `${controlNetModels.length} archivo(s) en ${controlNetModelsDir}`
          : 'Sin pesos CN — la app puede descargar un pack básico'
    },
    {
      id: 'ip-adapter',
      title: 'IP-Adapter / FaceID (identidad)',
      status: controlNetModels.some((m) => /ip-adapter|faceid/i.test(m)) ? 'ok' : 'optional',
      detail: 'Mejora “foto tuya” con referencia del avatar'
    }
  ]

  return {
    forgeRoot,
    controlNetBuiltIn,
    controlNetModelsDir: controlNetModelsDir || join(webui, 'models', 'ControlNet'),
    controlNetModels,
    extensionsDir: existsSync(extDir) ? extDir : extDir,
    extensions,
    recommended
  }
}

/** Ensure ControlNet folders exist under Forge */
export async function ensureControlNetFolders(): Promise<{ ok: boolean; dir: string; error?: string }> {
  const st = await getForgeExtensionsStatus()
  if (!st.forgeRoot) return { ok: false, dir: '', error: 'Forge no instalado' }
  const dir = st.controlNetModelsDir || join(st.forgeRoot, 'models', 'ControlNet')
  try {
    await mkdir(dir, { recursive: true })
    await mkdir(join(st.forgeRoot, 'models', 'ControlNetPreprocessor'), { recursive: true })
    return { ok: true, dir }
  } catch (e) {
    return { ok: false, dir, error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Download a small set of widely used SD1.5 ControlNet weights (Hugging Face).
 * Persistent via resumableDownload.
 */
export async function installBasicControlNetModels(
  onProgress?: (msg: string, pct?: number) => void
): Promise<{ ok: boolean; installed: string[]; error?: string }> {
  const ensured = await ensureControlNetFolders()
  if (!ensured.ok) return { ok: false, installed: [], error: ensured.error }

  // Public HF mirrors — openpose + canny are enough for structured control
  const files: Array<{ name: string; url: string }> = [
    {
      name: 'control_v11p_sd15_openpose.pth',
      url: 'https://huggingface.co/lllyasviel/ControlNet-v1-1/resolve/main/control_v11p_sd15_openpose.pth'
    },
    {
      name: 'control_v11p_sd15_canny.pth',
      url: 'https://huggingface.co/lllyasviel/ControlNet-v1-1/resolve/main/control_v11p_sd15_canny.pth'
    }
  ]

  const installed: string[] = []
  for (let i = 0; i < files.length; i++) {
    const f = files[i]
    const dest = join(ensured.dir, f.name)
    if (existsSync(dest)) {
      installed.push(f.name + ' (ya estaba)')
      onProgress?.(`${f.name} ya presente`, Math.round(((i + 1) / files.length) * 100))
      continue
    }
    onProgress?.(`Descargando ${f.name}…`, Math.round((i / files.length) * 100))
    try {
      const result = await resumableDownload({
        id: `cn-${f.name}`,
        url: f.url,
        dest,
        label: f.name,
        onProgress: (received, total) => {
          const pct = total && total > 0 ? Math.round((received / total) * 100) : undefined
          onProgress?.(`${f.name}${pct != null ? ' ' + pct + '%' : ''}`, pct)
        }
      })
      if (!result.ok) {
        return { ok: installed.length > 0, installed, error: result.error }
      }
      installed.push(f.name)
    } catch (e) {
      return {
        ok: installed.length > 0,
        installed,
        error: e instanceof Error ? e.message : String(e)
      }
    }
  }
  onProgress?.('ControlNet listo', 100)
  return { ok: true, installed }
}
