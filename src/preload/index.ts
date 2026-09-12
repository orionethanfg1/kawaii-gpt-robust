import { contextBridge, ipcRenderer } from 'electron'

export interface WebSearchResult {
  title: string
  snippet: string
  url?: string
}

export interface HardwareProfile {
  totalMemoryGB: number
  cpuCores: number
  architecture: string
  gpuName?: string | null
  vramGB?: number | null
  hasDiscreteGpu?: boolean | null
}

export interface OllamaStatus {
  reachable: boolean
  managedByApp: boolean
  pid?: number
}

export interface OllamaPullProgress {
  model: string
  status: string
  progress?: number
  error?: string
}

export interface ImageGeneratePayload {
  prompt: string
  negativePrompt?: string
  width?: number
  height?: number
  seed?: number
  timeoutMs?: number
  jobId?: string
  provider?: 'pollinations' | 'a1111' | 'cloudflare' | 'smart'
  cloudflareAccountId?: string
  a1111BaseUrl?: string
  steps?: number
  cfgScale?: number
  checkpoint?: string
}

export interface A1111ModelInfo {
  title: string
  modelName: string
  hash?: string
}

export interface ImageGenerateSuccess {
  ok: true
  jobId: string
  filePath: string
  dataUrl: string
  width: number
  height: number
  providerId: string
  model?: string
  seed?: number
  latencyMs: number
  prompt: string
}

export interface ImageGenerateFailure {
  ok: false
  code: string
  error: string
  jobId?: string
}

export type ImageGenerateResult = ImageGenerateSuccess | ImageGenerateFailure

export interface KawaiiAPI {
  webSearch: (query: string, maxResults?: number) => Promise<WebSearchResult[]>
  getCloudApiKey: () => Promise<string>
  setCloudApiKey: (key: string) => Promise<boolean>
  getProviderKey: (providerId: string) => Promise<string>
  setProviderKey: (providerId: string, key: string) => Promise<boolean>
  getAllProviderKeys: () => Promise<Record<string, string>>
  getVersion: () => Promise<string>
  notify: (payload: {
    title: string
    body?: string
    silent?: boolean
  }) => Promise<{ ok: boolean; error?: string }>
  getRuntimeMode: () => Promise<'packaged' | 'dev'>
  getHardwareProfile: () => Promise<HardwareProfile>
  openExternal: (url: string) => Promise<void>
  filesToDataUrl: (filePath: string) => Promise<{ ok: boolean; dataUrl?: string; error?: string; path?: string; mime?: string }>
  filesShowInFolder: (filePath: string) => Promise<{ ok: boolean; path?: string; error?: string }>
  filesOpenPath: (filePath: string) => Promise<{ ok: boolean; path?: string; error?: string }>
  filesListKnownDirs: () => Promise<{ ok: boolean; dirs?: Array<{ id: string; label: string; path: string }>; error?: string }>
  ollamaStatus: (baseUrl?: string) => Promise<OllamaStatus>
  ollamaStart: (baseUrl?: string) => Promise<{ ok: boolean; alreadyRunning?: boolean; message: string; pid?: number }>
  ollamaPull: (
    model: string,
    baseUrl?: string
  ) => Promise<{ ok: boolean; error?: string; cancelled?: boolean }>
  sdEnsureWorkspace: () => Promise<{ root: string; modelsDir: string; created: boolean }>
  sdOpenWorkspace: () => Promise<boolean>
  sdListCheckpoints: () => Promise<string[]>
  sdSearchHuggingFace: (query: string, limit?: number) => Promise<{
    ok: boolean
    error?: string
    results: Array<{
      id: string
      label: string
      repo: string
      downloads: number
      likes: number
      tags: string[]
      pageUrl: string
      filesUrl: string
    }>
  }>
  sdListWeights: () => Promise<{
    ok: boolean
    weights?: Array<{
      filename: string
      path: string
      sizeBytes: number
      kind: string
      family: string
      likelySdxl: boolean
      location: string
    }>
    error?: string
  }>
  sdListCheckpointsCatalog: () => Promise<{
    ok: boolean
    models: Array<{
      id: string
      filename: string
      label: string
      approxGB: number
      safety: string
      notes: string
    }>
    error?: string
  }>
  sdDiscardJob: (modelId: string) => Promise<{ ok: boolean; error?: string }>
  sdListInstalled: () => Promise<{
    ok: boolean
    models: Array<{ id: string; filename: string; path: string; sizeBytes: number }>
    error?: string
  }>
  sdListRecovery: () => Promise<{
    ok: boolean
    jobs: Array<{
      id: string
      label: string
      dest: string
      status: string
      received: number
      total: number | null
      pct: number
      updatedAt: string
      error?: string
    }>
    error?: string
  }>
  sdPauseDownload: () => Promise<{ ok: boolean }>
  sdDownloadCheckpoint: (
    modelId?: string
  ) => Promise<{ ok: true; path: string; id?: string } | { ok: false; error: string }>
  onSdDownloadProgress: (
    cb: (p: { modelId?: string; pct: number; received: number; total: number | null }) => void
  ) => () => void
  ollamaListPullJobs: () => Promise<{ ok: boolean; jobs?: Array<{ model: string; status: string; error?: string; progress?: number }> }>
  ollamaPullCancel: (model?: string) => Promise<{ ok: boolean }>
  ollamaDelete: (
    model: string,
    baseUrl?: string
  ) => Promise<{ ok: boolean; error?: string }>
  onOllamaPullProgress: (cb: (p: OllamaPullProgress) => void) => () => void
  imageGenerate: (payload: ImageGeneratePayload) => Promise<ImageGenerateResult>
  imageCloudflareProbe: (accountId?: string) => Promise<{ ok: boolean; latencyMs?: number; error?: string }>
  onImageGenerateProgress: (
    cb: (p: { jobId: string; phase: string; pct: number; detail?: string }) => void
  ) => () => void
  imageCancel: (jobId?: string) => Promise<{ ok: boolean }>
  imageA1111Health: (baseUrl?: string) => Promise<{ ok: boolean; latencyMs?: number; error?: string; modelsCount?: number }>
  imageA1111Models: (baseUrl?: string) => Promise<{
    ok: boolean
    error?: string
    models: A1111ModelInfo[]
    current?: string
  }>
  imageCleanup: (maxAgeDays?: number) => Promise<{ ok: boolean; removed: number; error?: string }>
  imageGetFolder: () => Promise<{ ok: boolean; path?: string; error?: string }>
  imageOpenFolder: () => Promise<{ ok: boolean; path?: string; error?: string }>
  imageShowInFolder: (filePath?: string) => Promise<{ ok: boolean; path?: string; error?: string }>

  machineEnsureProfile: () => Promise<{
    profile: unknown
    drives: unknown[]
    created: boolean
    forgePresent: boolean
  }>
  machineGetProfile: () => Promise<unknown>
  machineListDrives: () => Promise<unknown[]>
  machineSetDataRoot: (root: string, lock?: boolean) => Promise<{ profile: unknown; forgePresent: boolean }>
  machineOpenDataRoot: () => Promise<{ ok: boolean; path: string }>
  machineClearProfile: () => Promise<{ ok: boolean }>
  machinePrepareDataRoot: () => Promise<{
    profile: unknown
    drives: unknown[]
    created: boolean
    workspace: unknown
    forgePresent: boolean
  }>

  activityOpenWindow: (kind: 'adventure' | 'chess') => Promise<{ ok: boolean; id?: string; error?: string }>
  onActivityWindowClosed: (cb: (p: { kind: string; id: string }) => void) => () => void
  activityCloseWindow: (id: string) => Promise<{ ok: boolean }>
  activityCloseAllWindows: () => Promise<{ ok: boolean; closed: number }>
  forgeExtensionsStatus: () => Promise<unknown>
  forgeEnsureControlNet: () => Promise<{ ok: boolean; dir: string; error?: string }>
  forgeInstallControlNetModels: () => Promise<{ ok: boolean; installed: string[]; error?: string }>
  onForgeCnProgress: (cb: (p: { msg: string; pct?: number }) => void) => () => void
  forgeInstall: () => Promise<
    | { ok: true; forgeRoot: string; launcher: string; profile: unknown }
    | { ok: false; error: string; cancelled?: boolean }
  >
  forgeCancelInstall: (wipe?: boolean) => Promise<{ ok: boolean }>
  forgePauseInstall: () => Promise<{ ok: boolean }>
  forgeDownloadJob: () => Promise<{
    id: string
    url: string
    dest: string
    received: number
    total: number | null
    status: string
    label?: string
  } | null>
  forgeListRecovery: () => Promise<
    Array<{
      id: string
      received: number
      total: number | null
      status: string
      label?: string
      dest: string
    }>
  >
  forgeOpenFolder: () => Promise<{ ok: boolean; path: string }>
  forgePackInfo: () => Promise<{ id: string; filename: string; url: string; approxGB: number; label: string }>
  onForgeBootProgress: (
    cb: (p: {
      state: string
      message: string
      bootProgress?: number
      lastLogLine?: string
      elapsedMs?: number
      baseUrl?: string | null
      port?: number | null
    }) => void
  ) => () => void
  onForgeInstallProgress: (
    cb: (p: {
      phase: string
      pct: number
      message: string
      received?: number
      total?: number | null
    }) => void
  ) => () => void

  forgeStart: (preferredPort?: number) => Promise<{
    state: string
    port: number | null
    baseUrl: string | null
    pid: number | null
    forgeRoot: string | null
    message: string
    bootProgress?: number
    lastLogLine?: string
    elapsedMs?: number
  }>
  forgeStop: () => Promise<{
    state: string
    port: number | null
    baseUrl: string | null
    message: string
  }>
  forgeLogTail: () => Promise<{ lines: string[]; path: string | null }>
  onForgeLogLine: (cb: (p: { line: string; tail: string[] }) => void) => () => void
  musicEnsureWorkspace: () => Promise<{ ok: boolean; musicRoot?: string; error?: string }>
  musicStatus: () => Promise<Record<string, unknown>>
  musicAnalyze: () => Promise<Record<string, unknown>>
  musicInstall: (opts?: { forceAce?: boolean; forceYue?: boolean }) => Promise<Record<string, unknown>>
  musicInstallCancel: () => Promise<{ ok: boolean }>
  musicSetup: () => Promise<Record<string, unknown>>
  musicStart: (preferredPort?: number) => Promise<Record<string, unknown>>
  musicStop: () => Promise<Record<string, unknown>>
  musicRuntimeStatus: () => Promise<Record<string, unknown>>
  musicEnsureReady: (preferredPort?: number) => Promise<Record<string, unknown>>
  musicGenerate: (req: {
    prompt: string
    lyrics?: string
    durationSec?: number
    vocalLanguage?: string
  }) => Promise<{ ok: boolean; path?: string; audioPath?: string; error?: string; taskId?: string }>
  onMusicRuntime: (cb: (s: Record<string, unknown>) => void) => () => void
  musicLogTail: () => Promise<{ lines: string[]; path: string | null }>
  onMusicLogLine: (cb: (p: { line: string; tail: string[] }) => void) => () => void

  onMusicInstallProgress: (
    cb: (p: {
      backend: string
      phase: string
      pct: number
      message: string
      received?: number
      total?: number | null
    }) => void
  ) => () => void
  forgeStatus: () => Promise<{
    state: string
    port: number | null
    baseUrl: string | null
    pid?: number | null
    bootProgress?: number
    lastLogLine?: string
    elapsedMs?: number
    message: string
  }>
  forgeRefreshHealth: () => Promise<{
    state: string
    port: number | null
    baseUrl: string | null
    message: string
  }>
  gitStatus: () => Promise<{
    ok: boolean
    repoRoot?: string
    branch?: string
    remoteUrl?: string
    dirty?: boolean
    ahead?: number
    behind?: number
    staged?: number
    unstaged?: number
    untracked?: number
    userName?: string
    userEmail?: string
    sshCommand?: string
    lastError?: string
  }>
  gitListKeys: () => Promise<Array<{ name: string; path: string }>>
  gitApplyIdentity: (identity: {
    label: string
    keyPath: string
    userName?: string
    userEmail?: string
    hostAlias?: string
  }) => Promise<{ ok: boolean; steps: string[]; error?: string; stdout?: string }>
  gitSavedIdentity: () => Promise<{
    label?: string
    keyPath?: string
    userName?: string
    userEmail?: string
    hostAlias?: string
  } | null>
  gitAdd: () => Promise<{ ok: boolean; error?: string }>
  gitCommit: (message?: string) => Promise<{ ok: boolean; error?: string }>
  gitPush: (force?: boolean) => Promise<{ ok: boolean; error?: string }>
  gitSync: (
    message?: string,
    force?: boolean
  ) => Promise<{ ok: boolean; steps?: string[]; error?: string; stdout?: string; stderr?: string }>
  gitTestAuth: () => Promise<{ ok: boolean; error?: string; stdout?: string }>
  forgePickPort: (preferred?: number) => Promise<{
    ok: boolean
    port?: number
    error?: string
    candidates: number[]
  }>

  sdSyncCheckpointsToForge: () => Promise<{
    ok: boolean
    copied: string[]
    skipped: string[]
    forgeModelsDir: string | null
    error?: string
  }>
  imageEnsureLocalPipeline: (preferredPort?: number) => Promise<{
    ok: boolean
    baseUrl: string | null
    port: number | null
    modelsCount: number
    synced: { copied: string[]; skipped: string[] }
    message: string
  }>
  voiceSpeak: (req: { text: string; voiceId?: string }) => Promise<{
    ok: boolean
    audioPath?: string
    voiceId?: string
    error?: string
    chars?: number
  }>
  voiceStop: () => Promise<{ ok: boolean; error?: string }>
  voiceList: () => Promise<{
    ok: boolean
    voices: Array<{ id: string; label: string; locale: string; gender: string; region: string }>
  }>
  voiceStatus: () => Promise<{
    ok: boolean
    engine: string
    defaultVoice: string
    edgeTtsReady: boolean | null
    message: string
  }>
  voiceEnsure: () => Promise<{
    ok: boolean
    python?: string
    error?: string
    installed?: boolean
    messages?: string[]
  }>
  voiceGetLog: () => Promise<{ ok: boolean; lines: string[]; error?: string }>
  onVoiceLogLine: (cb: (p: { line: string; tail: string[] }) => void) => () => void
  platform: NodeJS.Platform
}


const api: KawaiiAPI = {
  webSearch: (query, maxResults = 5) =>
    ipcRenderer.invoke('web:search', query, maxResults),
  getCloudApiKey: () => ipcRenderer.invoke('secrets:getCloudApiKey'),
  setCloudApiKey: (key) => ipcRenderer.invoke('secrets:setCloudApiKey', key),
  getProviderKey: (providerId) =>
    ipcRenderer.invoke('secrets:getProviderKey', providerId),
  setProviderKey: (providerId, key) =>
    ipcRenderer.invoke('secrets:setProviderKey', providerId, key),
  getAllProviderKeys: () => ipcRenderer.invoke('secrets:getAllProviderKeys'),
  getVersion: () => ipcRenderer.invoke('app:version'),
  notify: (payload) => ipcRenderer.invoke('app:notify', payload),
  getRuntimeMode: () => ipcRenderer.invoke('app:runtimeMode'),
  getHardwareProfile: () => ipcRenderer.invoke('system:hardwareProfile'),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  filesToDataUrl: (filePath: string) => ipcRenderer.invoke('files:toDataUrl', filePath),
  filesShowInFolder: (filePath: string) => ipcRenderer.invoke('files:showInFolder', filePath),
  filesOpenPath: (filePath: string) => ipcRenderer.invoke('files:openPath', filePath),
  filesListKnownDirs: () => ipcRenderer.invoke('files:listKnownDirs'),
  ollamaStatus: (baseUrl) => ipcRenderer.invoke('ollama:status', baseUrl),
  ollamaStart: (baseUrl) => ipcRenderer.invoke('ollama:start', baseUrl),
  ollamaPull: (model, baseUrl) =>
    ipcRenderer.invoke('ollama:pull', { model, baseUrl }),
  sdEnsureWorkspace: () => ipcRenderer.invoke('sd:ensureWorkspace'),
  sdOpenWorkspace: () => ipcRenderer.invoke('sd:openWorkspace'),
  sdListCheckpoints: () => ipcRenderer.invoke('sd:listCheckpoints'),
  sdSearchHuggingFace: (query: string, limit?: number) =>
    ipcRenderer.invoke('sd:searchHuggingFace', query, limit),
  sdListWeights: () => ipcRenderer.invoke('sd:listWeights'),
  sdListCheckpointsCatalog: () => ipcRenderer.invoke('sd:listCheckpointsCatalog'),
  sdListInstalled: () => ipcRenderer.invoke('sd:listInstalled'),
  sdDiscardJob: (modelId: string) => ipcRenderer.invoke('sd:discardJob', modelId),
  sdListRecovery: () => ipcRenderer.invoke('sd:listRecovery'),
  sdPauseDownload: () => ipcRenderer.invoke('sd:pauseDownload'),
  sdDownloadCheckpoint: (modelId?: string) =>
    ipcRenderer.invoke('sd:downloadCheckpoint', modelId),
  onSdDownloadProgress: (cb) => {
    const listener = (_: unknown, p: { modelId?: string; pct: number; received: number; total: number | null }) =>
      cb(p)
    ipcRenderer.on('sd:download-progress', listener)
    return () => ipcRenderer.removeListener('sd:download-progress', listener)
  },
  ollamaListPullJobs: () => ipcRenderer.invoke('ollama:list-pull-jobs'),
  ollamaPullCancel: (model) => ipcRenderer.invoke('ollama:pull-cancel', model),
  ollamaDelete: (model, baseUrl) =>
    ipcRenderer.invoke('ollama:delete', { model, baseUrl }),
  onOllamaPullProgress: (cb) => {
    const listener = (_event: Electron.IpcRendererEvent, data: OllamaPullProgress) =>
      cb(data)
    ipcRenderer.on('ollama:pull-progress', listener)
    return () => ipcRenderer.removeListener('ollama:pull-progress', listener)
  },
  imageGenerate: (payload) => ipcRenderer.invoke('image:generate', payload),
  imageCloudflareProbe: (accountId?: string) =>
    ipcRenderer.invoke('image:cloudflareProbe', accountId),
  onImageGenerateProgress: (cb) => {
    const listener = (
      _e: unknown,
      p: { jobId: string; phase: string; pct: number; detail?: string }
    ) => cb(p)
    ipcRenderer.on('image:generate-progress', listener)
    return () => ipcRenderer.removeListener('image:generate-progress', listener)
  },
  imageCancel: (jobId) => ipcRenderer.invoke('image:cancel', jobId),
  imageA1111Health: (baseUrl) => ipcRenderer.invoke('image:a1111Health', baseUrl),
  imageA1111Models: (baseUrl) => ipcRenderer.invoke('image:a1111Models', baseUrl),
  imageCleanup: (maxAgeDays) => ipcRenderer.invoke('image:cleanup', maxAgeDays),
  imageGetFolder: () => ipcRenderer.invoke('image:getFolder'),
  imageOpenFolder: () => ipcRenderer.invoke('image:openFolder'),
  imageShowInFolder: (filePath?: string) =>
    ipcRenderer.invoke('image:showInFolder', filePath),
  
  machineEnsureProfile: () => ipcRenderer.invoke('machine:ensureProfile'),
  machineGetProfile: () => ipcRenderer.invoke('machine:getProfile'),
  machineListDrives: () => ipcRenderer.invoke('machine:listDrives'),
  machineSetDataRoot: (root: string, lock?: boolean) =>
    ipcRenderer.invoke('machine:setDataRoot', root, lock),
  machineOpenDataRoot: () => ipcRenderer.invoke('machine:openDataRoot'),
  machineClearProfile: () => ipcRenderer.invoke('machine:clearProfile'),
  machinePrepareDataRoot: () => ipcRenderer.invoke('machine:prepareDataRoot'),

  activityOpenWindow: (kind: 'adventure' | 'chess') =>
    ipcRenderer.invoke('activity:openWindow', kind),
  onActivityWindowClosed: (cb: (p: { kind: string; id: string }) => void) => {
    const listener = (_e: unknown, p: { kind: string; id: string }) => cb(p)
    ipcRenderer.on('activity:window-closed', listener)
    return () => ipcRenderer.removeListener('activity:window-closed', listener)
  },
  activityCloseWindow: (id: string) => ipcRenderer.invoke('activity:closeWindow', id),
  activityCloseAllWindows: () => ipcRenderer.invoke('activity:closeAllWindows'),
  forgeExtensionsStatus: () => ipcRenderer.invoke('forge:extensionsStatus'),
  forgeEnsureControlNet: () => ipcRenderer.invoke('forge:ensureControlNet'),
  forgeInstallControlNetModels: () => ipcRenderer.invoke('forge:installControlNetModels'),
  onForgeCnProgress: (cb: (p: { msg: string; pct?: number }) => void) => {
    const listener = (_e: unknown, p: { msg: string; pct?: number }) => cb(p)
    ipcRenderer.on('forge:cn-progress', listener)
    return () => ipcRenderer.removeListener('forge:cn-progress', listener)
  },
  forgeInstall: () => ipcRenderer.invoke('forge:install'),
  forgeCancelInstall: (wipe?: boolean) => ipcRenderer.invoke('forge:cancelInstall', wipe),
  forgePauseInstall: () => ipcRenderer.invoke('forge:pauseInstall'),
  forgeDownloadJob: () => ipcRenderer.invoke('forge:downloadJob'),
  forgeListRecovery: () => ipcRenderer.invoke('forge:listRecovery'),
  forgeOpenFolder: () => ipcRenderer.invoke('forge:openFolder'),
  forgePackInfo: () => ipcRenderer.invoke('forge:packInfo'),
  onForgeBootProgress: (cb) => {
    const listener = (_e: unknown, p: {
      state: string
      message: string
      bootProgress?: number
      lastLogLine?: string
      elapsedMs?: number
      baseUrl?: string | null
      port?: number | null
    }) => cb(p)
    ipcRenderer.on('forge:boot-progress', listener)
    return () => ipcRenderer.removeListener('forge:boot-progress', listener)
  },
  onForgeInstallProgress: (cb) => {
    const listener = (
      _: unknown,
      p: {
        phase: string
        pct: number
        message: string
        received?: number
        total?: number | null
      }
    ) => cb(p)
    ipcRenderer.on('forge:install-progress', listener)
    return () => ipcRenderer.removeListener('forge:install-progress', listener)
  },

  forgeStart: (preferredPort?: number) => ipcRenderer.invoke('forge:start', preferredPort),
  forgeStop: () => ipcRenderer.invoke('forge:stop'),
  forgeLogTail: () => ipcRenderer.invoke('forge:logTail'),
  onForgeLogLine: (cb) => {
    const listener = (_e: unknown, p: { line: string; tail: string[] }) => cb(p)
    ipcRenderer.on('forge:log-line', listener)
    return () => ipcRenderer.removeListener('forge:log-line', listener)
  },
  forgeStatus: () => ipcRenderer.invoke('forge:status'),
  forgeRefreshHealth: () => ipcRenderer.invoke('forge:refreshHealth'),
  forgePickPort: (preferred?: number) => ipcRenderer.invoke('forge:pickPort', preferred),

  sdSyncCheckpointsToForge: () => ipcRenderer.invoke('sd:syncCheckpointsToForge'),
  imageEnsureLocalPipeline: (preferredPort?: number) =>
    ipcRenderer.invoke('image:ensureLocalPipeline', preferredPort),
  gitStatus: () => ipcRenderer.invoke('git:status'),
  gitListKeys: () => ipcRenderer.invoke('git:listKeys'),
  gitApplyIdentity: (identity: {
    label: string
    keyPath: string
    userName?: string
    userEmail?: string
    hostAlias?: string
  }) => ipcRenderer.invoke('git:applyIdentity', identity),
  gitSavedIdentity: () => ipcRenderer.invoke('git:savedIdentity'),
  gitAdd: () => ipcRenderer.invoke('git:add'),
  gitCommit: (message?: string) => ipcRenderer.invoke('git:commit', message),
  gitPush: (force?: boolean) => ipcRenderer.invoke('git:push', force),
  gitSync: (message?: string, force?: boolean) => ipcRenderer.invoke('git:sync', message, force),
  gitTestAuth: () => ipcRenderer.invoke('git:testAuth'),
  musicEnsureWorkspace: () => ipcRenderer.invoke('music:ensureWorkspace'),
  musicStatus: () => ipcRenderer.invoke('music:status'),
  musicAnalyze: () => ipcRenderer.invoke('music:analyze'),
  musicInstall: (opts?: { forceAce?: boolean; forceYue?: boolean }) =>
    ipcRenderer.invoke('music:install', opts),
  musicInstallCancel: () => ipcRenderer.invoke('music:installCancel'),
  musicSetup: () => ipcRenderer.invoke('music:setup'),
  musicStart: (preferredPort?: number) => ipcRenderer.invoke('music:start', preferredPort),
  musicStop: () => ipcRenderer.invoke('music:stop'),
  musicRuntimeStatus: () => ipcRenderer.invoke('music:runtimeStatus'),
  musicEnsureReady: (preferredPort?: number) =>
    ipcRenderer.invoke('music:ensureReady', preferredPort),
  musicGenerate: (req: {
    prompt: string
    lyrics?: string
    durationSec?: number
    vocalLanguage?: string
  }) => ipcRenderer.invoke('music:generate', req),
  onMusicRuntime: (cb: (s: Record<string, unknown>) => void) => {
    const listener = (_e: unknown, s: Record<string, unknown>) => cb(s)
    ipcRenderer.on('music:runtime', listener)
    return () => ipcRenderer.removeListener('music:runtime', listener)
  },
  musicLogTail: () => ipcRenderer.invoke('music:logTail'),
  onMusicLogLine: (cb: (p: { line: string; tail: string[] }) => void) => {
    const listener = (_e: unknown, p: { line: string; tail: string[] }) => cb(p)
    ipcRenderer.on('music:log-line', listener)
    return () => ipcRenderer.removeListener('music:log-line', listener)
  },

  onMusicInstallProgress: (cb: (p: {
    backend: string
    phase: string
    pct: number
    message: string
    received?: number
    total?: number | null
  }) => void) => {
    const listener = (_e: unknown, p: {
      backend: string
      phase: string
      pct: number
      message: string
      received?: number
      total?: number | null
    }) => cb(p)
    ipcRenderer.on('music:install-progress', listener)
    return () => ipcRenderer.removeListener('music:install-progress', listener)
  },
  voiceSpeak: (req: { text: string; voiceId?: string }) =>
    ipcRenderer.invoke('voice:speak', req),
  voiceStop: () => ipcRenderer.invoke('voice:stop'),
  voiceList: () => ipcRenderer.invoke('voice:list'),
  voiceStatus: () => ipcRenderer.invoke('voice:status'),
  voiceEnsure: () => ipcRenderer.invoke('voice:ensure'),
  voiceGetLog: () => ipcRenderer.invoke('voice:getLog'),
  onVoiceLogLine: (cb: (p: { line: string; tail: string[] }) => void) => {
    const listener = (_e: unknown, p: { line: string; tail: string[] }) => cb(p)
    ipcRenderer.on('voice:log-line', listener)
    return () => { ipcRenderer.removeListener('voice:log-line', listener) }
  },
  layersPrepare: (target: 'none' | 'image' | 'music', reason?: string) =>
    ipcRenderer.invoke('layers:prepare', target, reason),
  layersActive: () =>
    ipcRenderer.invoke('layers:active') as Promise<{
      active: string
      last: { phase: string; target: string; message: string; ms?: number } | null
    }>,
  onLayersSchedule: (
    cb: (ev: {
      phase: string
      target: string
      released?: string
      message: string
      ms?: number
    }) => void
  ) => {
    const listener = (_e: unknown, ev: {
      phase: string
      target: string
      released?: string
      message: string
      ms?: number
    }) => cb(ev)
    ipcRenderer.on('layers:schedule', listener)
    return () => ipcRenderer.removeListener('layers:schedule', listener)
  },
  platform: process.platform
}

contextBridge.exposeInMainWorld('kawaii', api)

declare global {
  interface Window {
    kawaii: KawaiiAPI
  }
}
