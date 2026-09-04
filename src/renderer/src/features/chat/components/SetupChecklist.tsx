import { useEffect, useState } from 'react'
import { Check, Circle } from 'lucide-react'
import { useSettingsStore } from '@shared/lib/stores/settingsStore'
import { useChatStore } from '@shared/lib/stores/chatStore'
import { Button } from '@shared/ui/Button'

export interface ChecklistItem {
  id: string
  label: string
  done: boolean
  hint?: string
  action?: () => void
  actionLabel?: string
}

interface Props {
  onOpenSettings?: () => void
  onOpenWizard?: () => void
  onStartChat?: () => void
}

export function SetupChecklist({ onOpenSettings, onOpenWizard, onStartChat }: Props) {
  const settings = useSettingsStore((s) => s.settings)
  const conversations = useChatStore((s) => s.conversations)
  const [ollamaOk, setOllamaOk] = useState<boolean | null>(null)
  const [hasAnyKey, setHasAnyKey] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      // Ollama
      if (settings.providerMode === 'cloud') {
        if (!cancelled) setOllamaOk(null)
      } else {
        try {
          const controller = new AbortController()
          const timer = setTimeout(() => controller.abort(), 3500)
          const res = await fetch(
            `${settings.localBaseUrl.replace(/\/$/, '')}/api/tags`,
            { signal: controller.signal }
          )
          clearTimeout(timer)
          if (!cancelled) setOllamaOk(res.ok)
        } catch {
          if (!cancelled) setOllamaOk(false)
        }
      }

      // Keys
      try {
        const keys = (await window.kawaii?.getAllProviderKeys?.()) ?? {}
        const legacy = (await window.kawaii?.getCloudApiKey?.()) ?? ''
        const any = Object.values(keys).some((k) => k && k.length >= 8) || legacy.length >= 8
        if (!cancelled) setHasAnyKey(any)
      } catch {
        if (!cancelled) setHasAnyKey(false)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [settings.localBaseUrl, settings.providerMode])

  const needsLocal = settings.providerMode === 'local' || settings.providerMode === 'smart'
  const needsCloud = settings.providerMode === 'cloud' || settings.providerMode === 'smart'
  const hasMessages = conversations.some((c) => c.messages.some((m) => m.role === 'user'))
  const personalityTouched =
    settings.character?.name !== 'Kawaii' ||
    (settings.character?.personality?.length ?? 0) > 80

  const items: ChecklistItem[] = [
    {
      id: 'setup',
      label: 'Completar asistente de configuración',
      done: settings.hasCompletedSetup,
      hint: 'Puedes repetirlo con el botón Asistente',
      action: onOpenWizard,
      actionLabel: 'Asistente'
    },
    ...(needsLocal
      ? [
          {
            id: 'ollama',
            label: 'Ollama en marcha',
            done: ollamaOk === true,
            hint:
              ollamaOk === false
                ? 'Abre Ollama o usa el Asistente → Iniciar'
                : ollamaOk === null
                  ? 'Comprobando…'
                  : undefined,
            action: onOpenWizard,
            actionLabel: 'Revisar'
          } satisfies ChecklistItem,
          {
            id: 'local-model',
            label: 'Modelo local elegido',
            done: Boolean(settings.localModel?.trim()),
            hint: settings.localModel || 'Ej. llama3.2:3b',
            action: onOpenSettings,
            actionLabel: 'Ajustes'
          } satisfies ChecklistItem
        ]
      : []),
    ...(needsCloud
      ? [
          {
            id: 'cloud-key',
            label: 'Al menos una API key cloud',
            done: hasAnyKey === true,
            hint:
              hasAnyKey === false
                ? 'OpenRouter / Groq / Gemini en Ajustes'
                : hasAnyKey === null
                  ? 'Comprobando…'
                  : undefined,
            action: onOpenSettings,
            actionLabel: 'Ajustes'
          } satisfies ChecklistItem
        ]
      : []),
    {
      id: 'personality',
      label: 'Personalizar personalidad (opcional)',
      done: personalityTouched,
      hint: 'Nombre, tono o avatar en Ajustes',
      action: onOpenSettings,
      actionLabel: 'Ajustes'
    },
    {
      id: 'images',
      label: settings.imageGenEnabled
        ? 'Imágenes listas'
        : 'Imágenes revisadas (opcional)',
      // Optional: satisfied once setup wizard was completed (user chose on/off)
      done: settings.hasCompletedSetup,
      hint: settings.imageGenEnabled
        ? settings.imageProviderMode === 'cloud'
          ? 'Pollinations · botón Generar imagen o /image'
          : settings.imageProviderMode === 'smart'
            ? 'Smart · local → cloud'
            : 'Local A1111/Forge'
        : 'Desactivadas — puedes activarlas en Ajustes',
      action: onOpenSettings,
      actionLabel: 'Ajustes'
    },
    {
      id: 'first-message',
      label: 'Enviar el primer mensaje',
      done: hasMessages,
      action: onStartChat,
      actionLabel: 'Empezar'
    }
  ]

  const doneCount = items.filter((i) => i.done).length
  const allDone = doneCount === items.length

  if (allDone && settings.dismissSetupChecklist) {
    return null
  }

  return (
    <div className="w-full max-w-md text-left mt-2 pb-24">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-bold text-kawaii-text uppercase tracking-wide">
          Primeros pasos
        </p>
        <span className="text-[11px] text-kawaii-text-muted">
          {doneCount}/{items.length}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-kawaii-border overflow-hidden mb-3">
        <div
          className="h-full bg-kawaii-pink-deep transition-all"
          style={{ width: `${(doneCount / Math.max(items.length, 1)) * 100}%` }}
        />
      </div>
      <ul className="space-y-2">
        {items.map((item) => (
          <li
            key={item.id}
            className={`flex items-start gap-2 rounded-kawaii border px-3 py-2 text-sm ${
              item.done
                ? 'border-green-200 bg-green-50/80 text-green-900'
                : 'border-kawaii-border bg-white text-kawaii-text'
            }`}
          >
            <span className="mt-0.5 shrink-0">
              {item.done ? (
                <Check className="w-4 h-4 text-green-600" />
              ) : (
                <Circle className="w-4 h-4 text-kawaii-text-muted" />
              )}
            </span>
            <div className="flex-1 min-w-0">
              <p className={item.done ? 'line-through opacity-80' : 'font-medium'}>
                {item.label}
              </p>
              {item.hint && !item.done && (
                <p className="text-[11px] text-kawaii-text-muted mt-0.5">{item.hint}</p>
              )}
            </div>
            {!item.done && item.action && item.actionLabel && (
              <button
                type="button"
                className="text-[11px] text-kawaii-pink-deep font-semibold hover:underline shrink-0"
                onClick={item.action}
              >
                {item.actionLabel}
              </button>
            )}
          </li>
        ))}
      </ul>
      {allDone && (
        <div className="mt-3 flex gap-2">
          <Button className="flex-1 text-sm" onClick={onStartChat}>
            Chatear
          </Button>
          <Button
            variant="ghost"
            className="text-xs"
            onClick={() =>
              useSettingsStore.getState().update({ dismissSetupChecklist: true })
            }
          >
            Ocultar
          </Button>
        </div>
      )}
    </div>
  )
}
