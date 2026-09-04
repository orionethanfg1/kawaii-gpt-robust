import { useEffect, useMemo, useState } from 'react'
import { Button } from '@shared/ui/Button'
import type { CharacterProfile } from '@shared/types/settings'
import { describeAvatarFromDataUrl } from '@core/character/avatar-describe'
import {
  archetypesFor,
  buildProfileFromSurvey,
  defaultArchetypeFor,
  USER_GENDER_OPTIONS,
  ASSISTANT_GENDER_OPTIONS,
  TONE_OPTIONS,
  FORMALITY_OPTIONS,
  LENGTH_OPTIONS,
  EMOJI_OPTIONS,
  type ArchetypeId,
  type AssistantGenderId,
  type UserGenderId,
  type ToneId,
  type FormalityId,
  type LengthId,
  type EmojiId,
  type SurveyAnswers
} from '@core/character/archetypes'

interface Props {
  value: CharacterProfile
  onChange: (next: CharacterProfile) => void
  onClose: () => void
  getOpenRouterKey?: () => Promise<string>
}

const STEPS = ['Tú', 'Asistente', 'Rol', 'Tono', 'Estilo', 'Nombre', 'Avatar', 'Resumen'] as const

export function CharacterSetupAssistant({
  value,
  onChange,
  onClose,
  getOpenRouterKey
}: Props) {
  const [step, setStep] = useState(0)
  const [userGender, setUserGender] = useState<UserGenderId>('unspecified')
  const [assistantGender, setAssistantGender] = useState<AssistantGenderId>('female')
  const [archetype, setArchetype] = useState<ArchetypeId>('partner_f')
  const [tone, setTone] = useState<ToneId>('warm')
  const [formality, setFormality] = useState<FormalityId>('tu')
  const [length, setLength] = useState<LengthId>('medium')
  const [emoji, setEmoji] = useState<EmojiId>('few')
  const [name, setName] = useState(value.name || '')
  const [notes, setNotes] = useState('')
  const [avatarUrl, setAvatarUrl] = useState(value.visualImageUrl || '')
  const [visualDescription, setVisualDescription] = useState(value.visualDescription || '')
  const [visualFromAvatar, setVisualFromAvatar] = useState(!!value.visualFromAvatar)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const roleOptions = useMemo(
    () => archetypesFor(assistantGender, userGender),
    [assistantGender, userGender]
  )

  // When assistant gender changes, keep a valid role and suggest name
  useEffect(() => {
    const stillValid = roleOptions.some((r) => r.id === archetype)
    if (!stillValid) {
      const next = defaultArchetypeFor(assistantGender)
      setArchetype(next)
      const def = roleOptions.find((r) => r.id === next) || roleOptions[0]
      if (def && !name.trim()) setName(def.defaultName)
    }
  }, [assistantGender, roleOptions, archetype, name])

  const answers: SurveyAnswers = useMemo(
    () => ({
      userGender,
      assistantGender,
      archetype,
      tone,
      formality,
      length,
      emoji,
      name,
      notes
    }),
    [userGender, assistantGender, archetype, tone, formality, length, emoji, name, notes]
  )

  const preview = useMemo(() => buildProfileFromSurvey(answers), [answers])

  const finish = () => {
    const base = buildProfileFromSurvey(answers)
    onChange({
      ...base,
      visualImageUrl: avatarUrl || undefined,
      visualDescription: visualDescription || base.visualDescription,
      visualFromAvatar,
      relationshipHistory: value.relationshipHistory || []
    })
    onClose()
  }

  const describeFromAvatar = async () => {
    if (!avatarUrl) {
      setMsg('Sube primero un avatar (imagen).')
      return
    }
    setBusy(true)
    setMsg('Analizando avatar…')
    try {
      const key = (await getOpenRouterKey?.()) || ''
      const res = await describeAvatarFromDataUrl(avatarUrl, {
        apiKey: key,
        characterName: name || preview.name
      })
      setVisualDescription(res.description)
      setVisualFromAvatar(true)
      setMsg(
        res.source === 'vision'
          ? 'Descripción generada desde tu avatar.'
          : 'Descripción base ligada al avatar. Puedes editarla.'
      )
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const onFile = (file: File | null) => {
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      setAvatarUrl(String(reader.result || ''))
      setVisualFromAvatar(false)
    }
    reader.readAsDataURL(file)
  }

  const Choice = ({
    active,
    onClick,
    title,
    sub
  }: {
    active: boolean
    onClick: () => void
    title: string
    sub?: string
  }) => (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left rounded-kawaii border px-3 py-2 transition ${
        active
          ? 'border-kawaii-pink bg-kawaii-pink/15 ring-1 ring-kawaii-pink'
          : 'border-kawaii-border bg-white/70 hover:border-kawaii-pink/50'
      }`}
    >
      <div className="font-semibold text-sm">{title}</div>
      {sub ? <div className="text-[11px] text-kawaii-text-muted mt-0.5">{sub}</div> : null}
    </button>
  )

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-kawaii bg-kawaii-surface border border-kawaii-border shadow-xl p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-bold text-lg">Asistente de personalidad</h2>
          <button type="button" className="text-sm text-kawaii-text-muted" onClick={onClose}>
            Cerrar
          </button>
        </div>

        <div className="flex flex-wrap gap-1">
          {STEPS.map((s, i) => (
            <span
              key={s}
              className={`text-[10px] px-2 py-0.5 rounded-full ${
                i === step
                  ? 'bg-kawaii-pink text-white'
                  : i < step
                    ? 'bg-kawaii-pink/20 text-kawaii-pink'
                    : 'bg-black/5 text-kawaii-text-muted'
              }`}
            >
              {i + 1}. {s}
            </span>
          ))}
        </div>

        {step === 0 && (
          <div className="space-y-2">
            <p className="text-sm text-kawaii-text-muted">
              Sobre ti (opcional, solo para adaptar ejemplos y trato)
            </p>
            <div className="grid gap-2">
              {USER_GENDER_OPTIONS.map((o) => (
                <Choice
                  key={o.id}
                  active={userGender === o.id}
                  onClick={() => setUserGender(o.id)}
                  title={o.label}
                  sub={o.sub}
                />
              ))}
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-2">
            <p className="text-sm text-kawaii-text-muted">
              ¿Cómo prefieres que se presente tu asistente?
            </p>
            <div className="grid gap-2">
              {ASSISTANT_GENDER_OPTIONS.map((o) => (
                <Choice
                  key={o.id}
                  active={assistantGender === o.id}
                  onClick={() => setAssistantGender(o.id)}
                  title={o.label}
                  sub={o.sub}
                />
              ))}
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-2">
            <p className="text-sm text-kawaii-text-muted">
              Roles acordes a un asistente{' '}
              {assistantGender === 'female'
                ? 'mujer'
                : assistantGender === 'male'
                  ? 'hombre'
                  : 'neutro'}
            </p>
            <div className="grid gap-2">
              {roleOptions.map((a) => (
                <Choice
                  key={a.id}
                  active={archetype === a.id}
                  onClick={() => {
                    setArchetype(a.id)
                    setName(a.defaultName)
                  }}
                  title={`${a.emoji} ${a.label}`}
                  sub={a.blurb}
                />
              ))}
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-2">
            <p className="text-sm text-kawaii-text-muted">¿Cómo debe sentirse el tono general?</p>
            <div className="grid gap-2">
              {TONE_OPTIONS.map((t) => (
                <Choice
                  key={t.id}
                  active={tone === t.id}
                  onClick={() => setTone(t.id)}
                  title={t.label}
                />
              ))}
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-3">
            <div>
              <p className="text-xs font-semibold mb-1">Trato</p>
              <div className="grid gap-2">
                {FORMALITY_OPTIONS.map((t) => (
                  <Choice
                    key={t.id}
                    active={formality === t.id}
                    onClick={() => setFormality(t.id)}
                    title={t.label}
                  />
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold mb-1">Longitud</p>
              <div className="grid gap-2">
                {LENGTH_OPTIONS.map((t) => (
                  <Choice
                    key={t.id}
                    active={length === t.id}
                    onClick={() => setLength(t.id)}
                    title={t.label}
                  />
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold mb-1">Emojis</p>
              <div className="grid gap-2">
                {EMOJI_OPTIONS.map((t) => (
                  <Choice
                    key={t.id}
                    active={emoji === t.id}
                    onClick={() => setEmoji(t.id)}
                    title={t.label}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        {step === 5 && (
          <div className="space-y-3">
            <label className="block text-sm">
              Nombre del personaje
              <input
                className="mt-1 w-full rounded-kawaii border border-kawaii-border px-3 py-2 text-sm"
                value={name}
                placeholder={preview.name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="block text-sm">
              ¿Algo más que deba saber? (opcional)
              <textarea
                className="mt-1 w-full rounded-kawaii border border-kawaii-border px-3 py-2 text-sm min-h-[80px]"
                value={notes}
                placeholder="Ej. le gusta el anime, usa apodos…"
                onChange={(e) => setNotes(e.target.value)}
              />
            </label>
          </div>
        )}

        {step === 6 && (
          <div className="space-y-3">
            <p className="text-sm text-kawaii-text-muted">Avatar opcional</p>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => onFile(e.target.files?.[0] || null)}
            />
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt="avatar"
                className="h-24 w-24 object-cover rounded-full border border-kawaii-border"
              />
            ) : null}
            <Button
              type="button"
              disabled={busy || !avatarUrl}
              onClick={() => void describeFromAvatar()}
            >
              {busy ? 'Analizando…' : 'Describir desde avatar'}
            </Button>
            <textarea
              className="w-full rounded-kawaii border border-kawaii-border px-3 py-2 text-sm min-h-[70px]"
              placeholder="Descripción visual (editable)"
              value={visualDescription}
              onChange={(e) => {
                setVisualDescription(e.target.value)
                setVisualFromAvatar(false)
              }}
            />
            {msg ? <p className="text-xs text-kawaii-text-muted">{msg}</p> : null}
          </div>
        )}

        {step === 7 && (
          <div className="space-y-2 text-sm">
            <p className="font-semibold">Resumen</p>
            <div className="rounded-kawaii border border-kawaii-border bg-white/60 p-3 space-y-1 text-xs">
              <p>
                <b>
                  {preview.visualEmoji} {preview.name}
                </b>{' '}
                — {preview.tagline}
              </p>
              <p>
                <span className="text-kawaii-text-muted">Tú:</span>{' '}
                {USER_GENDER_OPTIONS.find((x) => x.id === userGender)?.label} ·{' '}
                <span className="text-kawaii-text-muted">Asistente:</span>{' '}
                {ASSISTANT_GENDER_OPTIONS.find((x) => x.id === assistantGender)?.label}
              </p>
              <p>
                <span className="text-kawaii-text-muted">Rol:</span> {preview.relationshipRole}
              </p>
              <p className="text-kawaii-text-muted">{preview.personality}</p>
            </div>
          </div>
        )}

        <div className="flex justify-between gap-2 pt-2">
          <Button
            type="button"
            variant="ghost"
            disabled={step === 0}
            onClick={() => setStep((s) => Math.max(0, s - 1))}
          >
            Atrás
          </Button>
          {step < STEPS.length - 1 ? (
            <Button type="button" onClick={() => setStep((s) => s + 1)}>
              Siguiente
            </Button>
          ) : (
            <Button type="button" onClick={finish}>
              Guardar personalidad
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
