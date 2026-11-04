/**
 * B1 — full portable backup / restore (renderer).
 */
import { useSettingsStore } from '@shared/lib/stores/settingsStore'
import { useCharacterStore, thinCharacterForLocalStorage } from '@shared/lib/stores/characterStore'
import { useChatStore } from '@shared/lib/stores/chatStore'
import { APP_VERSION } from '@shared/version'
import { recallChatPrimaryPath, rememberChatPrimaryPath } from '@features/settings/services/wardrobeDisk'

function thinSettingsForBackup(settings: Record<string, unknown>) {
  const ch = (settings.character || {}) as Record<string, unknown>
  let thinChar = ch
  try {
    thinChar = thinCharacterForLocalStorage(ch as never) as unknown as Record<string, unknown>
  } catch {
    /* */
  }
  return {
    ...settings,
    character: thinChar
  }
}

export async function exportFullBackup(): Promise<{ ok: boolean; path?: string; message: string }> {
  const api = window.kawaii
  if (!api?.backupExportFull) {
    return { ok: false, message: 'API de respaldo no disponible (¿app empaquetada antigua?)' }
  }
  const settings = useSettingsStore.getState().settings as unknown as Record<string, unknown>
  const character = useCharacterStore.getState().character
  const chats = useChatStore.getState().conversations
  const primaryPath = recallChatPrimaryPath()
  const memory = {
    userMemory: settings.userMemory,
    assistantMemory: settings.assistantMemory,
    relationshipState: settings.relationshipState,
    memoryOnboarding: settings.memoryOnboarding
  }
  try {
    const r = await api.backupExportFull({
      settings: thinSettingsForBackup(settings),
      character: thinCharacterForLocalStorage(character as never),
      chats,
      memory,
      primary: { chatPrimaryPath: primaryPath || undefined },
      appVersion: APP_VERSION,
      openAfter: true
    })
    if (!r.ok) return { ok: false, message: r.error || 'Falló el export' }
    return {
      ok: true,
      path: r.path,
      message: `Respaldo completo listo (${r.wardrobeFiles ?? 0} fotos) · ${r.path}`
    }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) }
  }
}

export async function importFullBackup(mode: 'merge' | 'replace' = 'merge'): Promise<{
  ok: boolean
  message: string
}> {
  const api = window.kawaii
  if (!api?.backupImportFull) {
    return { ok: false, message: 'API de import no disponible' }
  }
  try {
    const r = await api.backupImportFull()
    if (!r.ok) return { ok: false, message: r.error || 'Import cancelado o fallido' }

    const st = useSettingsStore.getState()
    const cur = st.settings as Record<string, unknown>
    const incomingSettings = (r.settings || {}) as Record<string, unknown>
    const incomingChar = (r.character || incomingSettings.character || {}) as Record<string, unknown>
    const mem = (r.memory || {}) as Record<string, unknown>

    if (mode === 'replace') {
      st.update({
        ...incomingSettings,
        character: { ...cur.character, ...incomingChar } as never,
        userMemory: (mem.userMemory as never) ?? cur.userMemory,
        assistantMemory: (mem.assistantMemory as never) ?? (cur as { assistantMemory?: unknown }).assistantMemory,
        relationshipState: (mem.relationshipState as never) ?? cur.relationshipState
      } as never)
    } else {
      // merge: prefer incoming non-empty identity + memories
      st.update({
        character: {
          ...(cur.character as object),
          ...incomingChar,
          visualGallery:
            (incomingChar.visualGallery as unknown[])?.length
              ? incomingChar.visualGallery
              : (cur.character as { visualGallery?: unknown }).visualGallery
        } as never,
        userMemory: (mem.userMemory as never) || cur.userMemory,
        assistantMemory:
          (mem.assistantMemory as never) ||
          (cur as { assistantMemory?: unknown }).assistantMemory,
        relationshipState: (mem.relationshipState as never) || cur.relationshipState
      } as never)
    }

    try {
      useCharacterStore.getState().setCharacter(incomingChar as never)
    } catch {
      /* */
    }

    const primary = r.primary as { chatPrimaryPath?: string } | undefined
    if (primary?.chatPrimaryPath) {
      rememberChatPrimaryPath(primary.chatPrimaryPath)
      try {
        st.update({
          character: {
            ...(st.settings.character as object),
            visualImageUrl: primary.chatPrimaryPath
          } as never
        })
      } catch {
        /* */
      }
    }

    // Chats
    try {
      let list: Array<{ id: string; title?: string; messages?: unknown[] }> = []
      const raw = r.chats
      if (Array.isArray(raw)) list = raw as never
      else if (raw && typeof raw === 'object') {
        const o = raw as { conversations?: unknown[]; chats?: unknown[] }
        if (Array.isArray(o.conversations)) list = o.conversations as never
        else if (Array.isArray(o.chats)) list = o.chats as never
      }
      if (list.length) {
        const n = useChatStore.getState().importConversations(list, mode)
        console.info('[fullBackup] chats imported', n)
      }
    } catch (e) {
      console.warn('[fullBackup] chats merge', e)
    }

    return {
      ok: true,
      message: `Import OK · ${r.wardrobeCopied ?? 0} fotos · ${r.path || ''} · recarga la app si el chat no refleja los cambios`
    }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) }
  }
}

export async function openBackupsFolder(): Promise<void> {
  try {
    await window.kawaii?.backupOpenBackupsDir?.()
  } catch {
    /* */
  }
}
