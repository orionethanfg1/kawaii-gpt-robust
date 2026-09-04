/// <reference types="vite/client" />

interface HardwareProfile {
  totalMemoryGB: number
  cpuCores: number
  architecture: string
  gpuName?: string | null
  vramGB?: number | null
  hasDiscreteGpu?: boolean | null
}

interface OllamaPullProgress {
  model: string
  status: string
  progress?: number
  error?: string
}

interface ImageGeneratePayload {
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

interface A1111ModelInfo {
  title: string
  modelName: string
  hash?: string
}

type ImageGenerateResult =
  | {
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
  | { ok: false; code: string; error: string; jobId?: string }

interface KawaiiAPI {
  webSearch: (query: string, maxResults?: number) => Promise<{ title: string; snippet: string; url?: string }[]>
  getCloudApiKey: () => Promise<string>
  setCloudApiKey: (key: string) => Promise<boolean>
  getProviderKey: (providerId: string) => Promise<string>
  setProviderKey: (providerId: string, key: string) => Promise<boolean>
  getAllProviderKeys: () => Promise<Record<string, string>>
  getVersion: () => Promise<string>
  getRuntimeMode: () => Promise<'packaged' | 'dev'>
  sdEnsureWorkspace: () => Promise<{ root: string; modelsDir: string; created: boolean }>
  sdOpenWorkspace: () => Promise<boolean>
  sdListCheckpoints: () => Promise<string[]>
  sdDownloadCheckpoint: () => Promise<{ ok: true; path: string } | { ok: false; error: string }>
  onSdDownloadProgress: (
    cb: (p: { pct: number; received: number; total: number | null }) => void
  ) => () => void
  getHardwareProfile: () => Promise<HardwareProfile>
  openExternal: (url: string) => Promise<void>
  ollamaStatus: (baseUrl?: string) => Promise<{ reachable: boolean; managedByApp: boolean; pid?: number }>
  ollamaStart: (baseUrl?: string) => Promise<{ ok: boolean; alreadyRunning?: boolean; message: string; pid?: number }>
  ollamaPull: (model: string, baseUrl?: string) => Promise<{ ok: boolean; error?: string; cancelled?: boolean }>
  ollamaPullCancel: (model?: string) => Promise<{ ok: boolean }>
  ollamaDelete: (model: string, baseUrl?: string) => Promise<{ ok: boolean; error?: string }>
  onOllamaPullProgress: (cb: (p: OllamaPullProgress) => void) => () => void
  imageCloudflareProbe?: (accountId?: string) => Promise<{ ok: boolean; latencyMs?: number; error?: string }>
  imageGenerate: (payload: ImageGeneratePayload) => Promise<ImageGenerateResult>
  imageGetFolder: () => Promise<{ ok: boolean; path?: string; error?: string }>
  imageOpenFolder: () => Promise<{ ok: boolean; path?: string; error?: string }>
  imageShowInFolder: (filePath?: string) => Promise<{ ok: boolean; path?: string; error?: string }>
  imageCancel: (jobId?: string) => Promise<{ ok: boolean }>
  imageA1111Health: (baseUrl?: string) => Promise<{ ok: boolean; latencyMs?: number; error?: string; modelsCount?: number }>
  imageA1111Models: (baseUrl?: string) => Promise<{
    ok: boolean
    error?: string
    models: A1111ModelInfo[]
    current?: string
  }>
  imageCleanup: (maxAgeDays?: number) => Promise<{ ok: boolean; removed: number; error?: string }>
  platform: NodeJS.Platform
}

declare global {
  interface Window {
    kawaii: KawaiiAPI
  }
}

export {}
