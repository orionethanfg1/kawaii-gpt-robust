/**
 * M3 — shared UI state for settings panels (avoids prop drilling).
 */
import {
  createContext,
  useContext,
  type Dispatch,
  type SetStateAction,
  type ReactNode
} from 'react'
import type { Settings } from '@shared/types/settings'
import type { DiagReport } from '@core/diagnostics/self-heal'

export type SettingsSectionId =
  | 'persona'
  | 'layers'
  | 'providers'
  | 'advanced'
  | 'actividades'
  | 'tester'

export type MusicSnap = {
  ok?: boolean
  ace?: { stage?: string; present?: boolean; lastError?: string }
  yue?: { stage?: string; disabledReason?: string }
  eligibility?: {
    summary?: string
    vramGB?: number | null
    ramGB?: number
    ace?: { eligible?: boolean; tier?: string; reason?: string }
    yue?: { eligible?: boolean; reason?: string }
    preferred?: string
  }
  musicRoot?: string
} | null

export type MusicRuntime = {
  state?: string
  message?: string
  baseUrl?: string
  bootProgress?: number
} | null

export type SettingsUiValue = {
  settings: Settings
  update: (partial: Partial<Settings>) => void
  char: Settings["character"]
  traitsText: string
  setTraitsText: Dispatch<SetStateAction<string>>
  charAssistOpen: boolean
  setCharAssistOpen: Dispatch<SetStateAction<boolean>>
  onAvatarFile: (file: File | null) => void
  apiKey: string
  setApiKey: Dispatch<SetStateAction<string>>
  savedKeyHint: string
  setSavedKeyHint: Dispatch<SetStateAction<string>>
  providerKeys: Record<string, string>
  setProviderKeys: Dispatch<SetStateAction<Record<string, string>>>
  keyDrafts: Record<string, string>
  setKeyDrafts: Dispatch<SetStateAction<Record<string, string>>>
  saveApiKey: () => Promise<void>
  diag: DiagReport | null
  diagRunning: boolean
  runDiag: () => Promise<void>
  repairImageStack: () => Promise<void>
  probeNetworkOnly: () => Promise<void>
  musicSnap: MusicSnap
  setMusicSnap: Dispatch<SetStateAction<MusicSnap>>
  musicRuntime: MusicRuntime
  setMusicRuntime: Dispatch<SetStateAction<MusicRuntime>>
  musicBusy: boolean
  setMusicBusy: Dispatch<SetStateAction<boolean>>
}

const SettingsUiContext = createContext<SettingsUiValue | null>(null)

export function SettingsUiProvider({
  value,
  children
}: {
  value: SettingsUiValue
  children: ReactNode
}) {
  return (
    <SettingsUiContext.Provider value={value}>{children}</SettingsUiContext.Provider>
  )
}

export function useSettingsUi(): SettingsUiValue {
  const v = useContext(SettingsUiContext)
  if (!v) throw new Error('useSettingsUi outside SettingsUiProvider')
  return v
}
