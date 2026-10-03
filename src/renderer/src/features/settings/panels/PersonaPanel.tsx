/**
 * M3 — PersonaPanel
 */
import { useSettingsUi } from './SettingsUiContext'
import { Sparkles } from 'lucide-react'
import { Button } from '@shared/ui/Button'
import { AvatarGalleryPanel } from '../AvatarGalleryPanel'


export function PersonaPanel() {
  const {
    settings,
    update,
    char,
    traitsText,
    setTraitsText,
    setCharAssistOpen,
    onAvatarFile,
    apiKey,
    setApiKey,
    savedKeyHint,
    setSavedKeyHint,
    providerKeys,
    setProviderKeys,
    keyDrafts,
    setKeyDrafts,
    saveApiKey,
    diag,
    diagRunning,
    runDiag,
    repairImageStack,
    probeNetworkOnly,
    musicSnap,
    setMusicSnap,
    musicRuntime,
    setMusicRuntime,
    musicBusy,
    setMusicBusy
  } = useSettingsUi()

  return (
    <div className="space-y-3">
<div id="settings-persona" className="scroll-mt-4 border border-kawaii-border rounded-kawaii p-3 space-y-3 bg-kawaii-pink-soft/20 ">
  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
    <div>
      <h3 className="font-bold text-sm text-kawaii-text flex items-center gap-1.5">
        <Sparkles className="w-4 h-4 text-kawaii-pink-deep" />
        Personalidad y avatar
      </h3>
      <p className="text-[10px] text-kawaii-text-muted mt-0.5">
        Define quién es el chat: rol, tono, relación y aspecto visual.
      </p>
    </div>
    <Button
      className="text-[11px] shrink-0 bg-kawaii-pink-soft border border-kawaii-pink-deep/30"
      onClick={() => setCharAssistOpen(true)}
    >
      <Sparkles className="w-3.5 h-3.5 mr-1 inline" />
      Asistente guiado
    </Button>
  </div>
  <div className="rounded-lg border border-kawaii-pink/40 p-3 space-y-2 bg-white/80">
    <p className="text-xs font-semibold text-kawaii-text">Iniciativa de conversación</p>
    <p className="text-[10px] text-kawaii-text-muted">
      Si la app está abierta y no escribes, puede escribirte sola. (También en Capas.)
    </p>
    <label className="flex items-center gap-2 text-xs">
      <input
        type="checkbox"
        checked={settings.conversationInitiativeEnabled === true}
        onChange={(e) => update({ conversationInitiativeEnabled: e.target.checked })}
      />
      Activar mensajes por iniciativa propia
    </label>
    {settings.conversationInitiativeEnabled ? (
      <div className="flex flex-wrap gap-2 items-center text-xs">
        <label className="flex items-center gap-1">
          Modo
          <select
            className="input-kawaii text-xs py-0.5"
            value={settings.conversationInitiativeMode || 'personality'}
            onChange={(e) =>
              update({
                conversationInitiativeMode: e.target.value as 'personality' | 'fixed'
              })
            }
          >
            <option value="personality">Según personalidad</option>
            <option value="fixed">Fijo (minutos)</option>
          </select>
        </label>
        {settings.conversationInitiativeMode === 'fixed' ? (
          <label className="flex items-center gap-1">
            Cada
            <input
              type="number"
              min={1}
              max={120}
              className="input-kawaii text-xs w-14 py-0.5"
              value={settings.conversationInitiativeMinutes || 4}
              onChange={(e) =>
                update({
                  conversationInitiativeMinutes: Math.max(
                    1,
                    Math.min(120, Number(e.target.value) || 4)
                  )
                })
              }
            />
            min
          </label>
        ) : null}
      </div>
    ) : null}
  </div>
  <div className="rounded-lg border border-dashed border-kawaii-pink-deep/40 bg-white/60 px-3 py-2 text-[11px] text-kawaii-text-muted">
    El <strong className="text-kawaii-text">asistente guiado</strong> te hace una encuesta
    (género, rol, tono) y rellena la ficha. También puedes editar los campos abajo a mano.
  </div>
  <div className="flex items-center gap-3">
    <div className="w-14 h-14 rounded-full bg-white border border-kawaii-border flex items-center justify-center text-2xl overflow-hidden">
      {char.visualImageUrl ? (
        <img
          src={char.visualImageUrl}
          alt=""
          className="w-full h-full object-cover"
        />
      ) : (
        char.visualEmoji
      )}
    </div>
    <div className="flex-1 space-y-1">
      <input
        className="input-kawaii text-sm"
        value={char.visualEmoji}
        onChange={(e) =>
          update({ character: { ...char, visualEmoji: e.target.value } })
        }
        placeholder="Emoji 🌸"
      />
      <input
        type="file"
        accept="image/*"
        className="text-[11px] w-full"
        onChange={(e) => onAvatarFile(e.target.files?.[0] ?? null)}
      />
      {char.visualImageUrl && (
        <button
          type="button"
          className="text-[11px] text-red-600 underline"
          onClick={() =>
            update({
              character: { ...char, visualImageUrl: undefined }
            })
          }
        >
          Quitar imagen
        </button>
      )}
    </div>
  </div>
  <AvatarGalleryPanel
    character={char}
    onChange={(next) => update({ character: next })}
  />

  <div>
    <label className="block text-xs font-semibold mb-1">Nombre</label>
    <input
      className="input-kawaii"
      value={char.name}
      onChange={(e) =>
        update({ character: { ...char, name: e.target.value } })
      }
    />
  </div>
  <div>
    <label className="block text-xs font-semibold mb-1">Tagline</label>
    <input
      className="input-kawaii"
      value={char.tagline}
      onChange={(e) =>
        update({ character: { ...char, tagline: e.target.value } })
      }
    />
  </div>
  <div>
    <label className="block text-xs font-semibold mb-1">
      Relación con el usuario
    </label>
    <input
      className="input-kawaii"
      value={char.relationshipRole ?? ''}
      onChange={(e) =>
        update({
          character: { ...char, relationshipRole: e.target.value }
        })
      }
      placeholder="Ej: mejor amiga, mentor, asistente profesional…"
    />
  </div>

  <div>
    <label className="block text-xs font-semibold mb-1">
      Descripción visual / física
    </label>
    <textarea
      className="input-kawaii min-h-[70px]"
      value={char.visualDescription ?? ''}
      onChange={(e) =>
        update({
          character: { ...char, visualDescription: e.target.value }
        })
      }
      placeholder="Ej: cabello pastel ondulado, ojos grandes y cálidos, detalle floral, estética kawaii suave…"
    />
    <p className="text-[10px] text-kawaii-text-muted mt-0.5">
      Idealmente generada desde el avatar. Requiere visión (OpenRouter o Ollama
      llava/moondream). Si falla, escribe rasgos a mano: cabello, ojos, piel, ropa.
      {char.visualFromAvatar ? ' · Ligada al avatar.' : ''}
      {!(char.visualDescription || '').trim() && char.visualImageUrl
        ? ' · Vacía: pulsa «Regenerar» o rellena a mano.'
        : ''}
    </p>
    <button
      type="button"
      className="text-[11px] text-kawaii-pink-deep underline"
      onClick={async () => {
        if (!char.visualImageUrl) return
        const keys = (await window.kawaii?.getAllProviderKeys?.()) ?? {}
        const act = activityProgress(
          'Describiendo personaje',
          'Analizando avatar + galería…',
          20
        )
        try {
          try {
            const { ensureVisionForApp } = await import('../ensureVision')
            await ensureVisionForApp({
              autoInstall: true,
              ollamaBaseUrl: settings.localBaseUrl
            })
          } catch {
            /* vision ensure optional */
          }
          const { describeCharacterFromGallery, describeAvatarFromDataUrl } =
            await import('@core/character/avatar-describe')
          const galleryImgs = [
            ...(char.visualImageUrl
              ? [{ dataUrl: char.visualImageUrl, label: 'Principal', isPrimary: true }]
              : []),
            ...((char.visualGallery || []) as Array<{ dataUrl?: string; label?: string; id?: string }>)
              .filter((g) => g.dataUrl && g.dataUrl !== char.visualImageUrl)
              .map((g) => ({
                dataUrl: g.dataUrl as string,
                label: g.label || g.id || 'ref',
                isPrimary: false
              }))
          ]
          const describeOpts = {
            apiKey: keys.openrouter || keys.main || '',
            openaiKey: keys.openai || '',
            characterName: char.name,
            ollamaBaseUrl: settings.localBaseUrl || 'http://127.0.0.1:11434',
            chatModel: settings.localModel || ''
          }
          const res =
            galleryImgs.length > 1
              ? await describeCharacterFromGallery(galleryImgs, describeOpts)
              : await describeAvatarFromDataUrl(
                  char.visualImageUrl,
                  describeOpts
                )
          let desc = (res.description || '').trim()
          if (!desc || res.source === 'none') {
            activityError(
              'No se pudo describir el avatar',
              (res.error ||
                'Hace falta visión: API Key de OpenRouter (modelo vision) o Ollama con llava/moondream/qwen2-vl. Sin eso el campo queda vacío a propósito (no inventamos rasgos).') +
                ' Puedes escribir la descripción manualmente.'
            )
            return
          }
          try {
            const { polishVisualDescription } = await import('@core/character/avatar-describe')
            desc = await polishVisualDescription(desc, {
              characterName: char.name,
              ollamaBaseUrl: settings.localBaseUrl || 'http://127.0.0.1:11434',
              chatModel: settings.localModel || '',
              openRouterKey: keys.openrouter || keys.main || ''
            })
          } catch {
            /* keep raw vision text */
          }
          desc = desc.replace(/^[!?.#*\-\s]+/, '').trim()
          update({
            character: {
              ...char,
              visualDescription: desc,
              visualFromAvatar: true
            }
          })
          const { useActivityStore } = await import('@shared/lib/stores/activityStore')
          useActivityStore.getState().update(act, {
            kind: 'success',
            title:
              res.source === 'vision' || res.source === 'ollama'
                ? 'Descripción desde avatar (visión)'
                : 'Descripción del avatar',
            detail: desc.slice(0, 120) + (desc.length > 120 ? '…' : ''),
            progress: 100,
            ttlMs: 5000
          })
          window.setTimeout(() => useActivityStore.getState().dismiss(act), 5000)
        } catch (e) {
          activityError(
            'No se pudo describir el avatar',
            e instanceof Error ? e.message : String(e)
          )
        }
      }}
    >
      Regenerar descripción (avatar + galería)
    </button>

    <button
      type="button"
      className="text-[11px] text-kawaii-pink-deep underline ml-3"
      onClick={async () => {
        const act = activityProgress('Visión', 'Comprobando / instalando modelo vision…', 15)
        try {
          const { ensureVisionForApp } = await import('../ensureVision')
          const r = await ensureVisionForApp({
            autoInstall: true,
            ollamaBaseUrl: settings.localBaseUrl
          })
          const { useActivityStore } = await import('@shared/lib/stores/activityStore')
          useActivityStore.getState().update(act, {
            kind: r.ok ? 'success' : 'error',
            title: r.ok ? 'Visión' : 'Visión incompleta',
            detail: r.message + (r.pullStarted ? ` · Pull: ${r.pullStarted}` : ''),
            progress: r.pullStarted ? 40 : 100,
            ttlMs: 8000
          })
          window.setTimeout(() => useActivityStore.getState().dismiss(act), 8000)
        } catch (e) {
          activityError('Visión', e instanceof Error ? e.message : String(e))
        }
      }}
    >
      Preparar visión (auto)
    </button>
  </div>
  <div>
    <label className="block text-xs font-semibold mb-1">Personalidad</label>
    <textarea
      className="input-kawaii min-h-[80px]"
      value={char.personality}
      onChange={(e) =>
        update({ character: { ...char, personality: e.target.value } })
      }
    />
  </div>
  <div>
    <label className="block text-xs font-semibold mb-1">Estilo de respuesta</label>
    <textarea
      className="input-kawaii min-h-[60px]"
      value={char.style}
      onChange={(e) =>
        update({ character: { ...char, style: e.target.value } })
      }
    />
  </div>
  <div>
    <label className="block text-xs font-semibold mb-1">
      Rasgos (separados por coma)
    </label>
    <input
      className="input-kawaii"
      value={traitsText}
      onChange={(e) => setTraitsText(e.target.value)}
      onBlur={() =>
        update({
          character: {
            ...char,
            traits: traitsText
              .split(',')
              .map((t) => t.trim())
              .filter(Boolean)
          }
        })
      }
    />
  </div>
</div>


    </div>
  )
}
