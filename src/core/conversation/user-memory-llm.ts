import {
  looksLikePersonName,
  normalizeLikePhrase,
  isExplicitRoleplayMemoryContext,
  type ExtractedFacts,
  type NamedPerson,
  type UserMemory
} from './user-memory'

const EXPLICIT_MEMORY_SIGNAL =
  /\b(me llamo|mi nombre(?: real)? es|ll[aá]mame|prefiero que me (?:digas|llames)|me gusta|me encantan?|prefiero|no me gusta|odio|detesto|mi favorito|mi favorita|mi meta|mi objetivo|estoy enfocado|estoy centrado|mi hermana|mi hermano|mi amigo|mi amiga|mi pareja|mi novio|mi novia|recuerda|no olvides|a partir de ahora|en futuras ocasiones|mi hobby|en mi tiempo libre|vivo en|resido en|trabajo como|soy de)\b/i

export function shouldReviewUserMemoryText(userText: string): boolean {
  const text = String(userText || '').trim()
  return (
    text.length >= 8 &&
    text.length <= 1200 &&
    EXPLICIT_MEMORY_SIGNAL.test(text) &&
    !isExplicitRoleplayMemoryContext(text)
  )
}

export function buildUserMemoryExtractMessages(
  userText: string,
  previousAssistantText?: string
): Array<{ role: 'system' | 'user'; content: string }> {
  const system =
    'Eres un extractor conservador de memoria del USUARIO. Devuelve únicamente JSON válido con este esquema: ' +
    '{"userName":null,"preferredName":null,"likes":[],"dislikes":[],"favorites":[],"goals":[],"currentFocus":null,"people":[],"facts":[],"standingInstructions":[],"appearanceNotes":null}.\n' +
    'Guarda solo declaraciones explícitas, personales y útiles a largo plazo. No infieras identidad, gustos, parentescos, salud, ubicación ni progreso. ' +
    'No guardes estados de ánimo pasajeros, escenas, roleplay, ficción, texto del asistente ni detalles de documentos. ' +
    'Un nombre propio, lugar o título mencionado no basta para convertirlo en recuerdo. ' +
    'Solo devuelve hechos/ instrucciones como PIN si el usuario pide claramente recordarlos o mantenerlos. ' +
    'Solo asigna gustos, metas, apariencia o personas si el propio mensaje del usuario lo afirma claramente. ' +
    'El mensaje previo del asistente es contexto para resolver referencias; nunca es evidencia de un hecho del usuario. ' +
    'Si algo es ambiguo, hipotético, una pregunta o una narración, omítelo. Usa arreglos vacíos y null cuando no aplique. Máximo 3 elementos por lista; frases breves en español.'
  const previous = String(previousAssistantText || '').trim().slice(0, 500)
  return [
    { role: 'system', content: system },
    {
      role: 'user',
      content:
        (previous
          ? `Respuesta previa (solo contexto, no extraer de aquí):\n${previous}\n\n`
          : '') +
        `Mensaje del usuario a revisar:\n${String(userText || '').trim().slice(0, 1200)}`
    }
  ]
}

export function parseUserMemoryExtractJson(raw: string): Partial<ExtractedFacts> {
  const text = String(raw || '').trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return {}
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>
    const strings = (key: string, maxLength: number): string[] =>
      Array.isArray(parsed[key])
        ? (parsed[key] as unknown[])
            .filter((value): value is string => typeof value === 'string')
            .map((value) => value.replace(/\s+/g, ' ').trim())
            .filter((value) => value.length >= 2 && value.length <= maxLength)
            .slice(0, 3)
        : []
    const textValue = (key: string, maxLength: number): string | undefined => {
      const value = parsed[key]
      return typeof value === 'string' && value.trim()
        ? value.replace(/\s+/g, ' ').trim().slice(0, maxLength)
        : undefined
    }
    const people: NamedPerson[] = Array.isArray(parsed.people)
      ? (parsed.people as unknown[])
          .filter((person): person is Record<string, unknown> =>
            Boolean(person && typeof person === 'object' && !Array.isArray(person))
          )
          .map((person) => ({
            name: typeof person.name === 'string' ? person.name.trim() : '',
            relation:
              typeof person.relation === 'string'
                ? person.relation.replace(/\s+/g, ' ').trim().slice(0, 32)
                : undefined
          }))
          .filter((person) => looksLikePersonName(person.name))
          .slice(0, 3)
      : []

    return {
      userName: textValue('userName', 32),
      preferredName: textValue('preferredName', 32),
      likes: strings('likes', 48),
      dislikes: strings('dislikes', 48),
      favorites: strings('favorites', 64),
      goals: strings('goals', 100),
      currentFocus: textValue('currentFocus', 80),
      people,
      facts: strings('facts', 120),
      standingInstructions: strings('standingInstructions', 120),
      appearanceNotes: textValue('appearanceNotes', 180)
    }
  } catch {
    return {}
  }
}

function stringsIf(
  values: string[] | undefined,
  enabled: boolean,
  normalize: (value: string) => string,
  sourceText: string,
  max = 3
): string[] | undefined {
  if (!enabled || !values?.length) return undefined
  const normalizeForSearch = (value: string) =>
    value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase()
  const sourceWords = new Set(normalizeForSearch(sourceText).match(/[\p{L}\p{N}]+/gu) || [])
  const output: string[] = []
  const seen = new Set<string>()
  for (const raw of values) {
    const value = normalize(raw)
    if (!value) continue
    const key = normalizeForSearch(value)
    const words = key.match(/[\p{L}\p{N}]+/gu) || []
    if (!words.length || words.some((word) => !sourceWords.has(word)) || seen.has(key)) continue
    seen.add(key)
    output.push(value)
  }
  return output.length ? output.slice(0, max) : undefined
}

export function sanitizeUserMemoryExtract(
  patch: Partial<ExtractedFacts>,
  userText: string
): Partial<ExtractedFacts> {
  const text = String(userText || '').trim()
  if (!shouldReviewUserMemoryText(text)) return {}

  const explicitName = /\b(me llamo|mi nombre(?: real)? es)\b/i.test(text)
  const explicitAddress = /\b(ll[aá]mame|prefiero que me (?:digas|llames))\b/i.test(text)
  const explicitLike =
    /\b(?:me gusta(?:n)?|me encant[ao]s?|disfruto|prefiero (?!que me (?:digas|llames)))\b/i.test(
      text
    ) && !/\bme gusta que me (?:digas|llames)\b/i.test(text)
  const explicitDislike = /\b(no me gusta|odio|detesto|no soporto)\b/i.test(text)
  const explicitFavorite = /\bmi (?:color |comida |pel[ií]cula |serie |canci[oó]n )?favorit[oa]\b/i.test(
    text
  )
  const explicitGoal = /\b(mi meta|mi objetivo|estoy enfocado|estoy centrado|mi proyecto)\b/i.test(
    text
  )
  const explicitFact =
    /\b(recuerda|no olvides|importante:)\b/i.test(text) &&
    !/\b(?:role[\s-]?play|juego de rol|escena)\b/i.test(text)
  const explicitStanding =
    /\b(a partir de ahora|en futuras ocasiones|siempre debes|no debes|debes evitar)\b/i.test(text)
  const explicitPerson =
    /\bmi (?:amigo|amiga|hermano|hermana|pareja|novio|novia|jefe|madre|padre|mam[aá]|pap[aá])\b/i.test(
      text
    )
  const explicitAppearance =
    /\b(mi cabello|mi pelo|mis ojos|mi estatura|mido \d|mi complexi[oó]n)\b/i.test(text)

  const userName =
    explicitName &&
    patch.userName &&
    looksLikePersonName(patch.userName) &&
    text.toLocaleLowerCase().includes(patch.userName.toLocaleLowerCase())
      ? patch.userName
      : undefined
  const preferredName =
    (explicitName || explicitAddress) &&
    patch.preferredName &&
    looksLikePersonName(patch.preferredName) &&
    text.toLocaleLowerCase().includes(patch.preferredName.toLocaleLowerCase())
      ? patch.preferredName
      : undefined
  const likes = stringsIf(patch.likes, explicitLike, normalizeLikePhrase, text, 3)
  const dislikes = stringsIf(patch.dislikes, explicitDislike, normalizeLikePhrase, text, 3)
  const favorites = stringsIf(patch.favorites, explicitFavorite, normalizeLikePhrase, text, 3)
  const goals = stringsIf(patch.goals, explicitGoal, normalizeLikePhrase, text, 3)
  const facts = stringsIf(
    patch.facts,
    explicitFact,
    (value) => value.slice(0, 120),
    text,
    2
  )
  const standingInstructions = stringsIf(
    patch.standingInstructions,
    explicitStanding,
    (value) => value.slice(0, 120),
    text,
    2
  )
  const people = explicitPerson
    ? (patch.people || [])
        .filter(
          (person) =>
            looksLikePersonName(person.name) &&
            text.toLocaleLowerCase().includes(person.name.toLocaleLowerCase())
        )
        .slice(0, 2)
    : undefined
  const appearanceNotes =
    explicitAppearance &&
    patch.appearanceNotes &&
    patch.appearanceNotes
      .toLocaleLowerCase()
      .split(/\s+/)
      .filter((word) => word.length > 3)
      .every((word) => text.toLocaleLowerCase().includes(word))
      ? patch.appearanceNotes.slice(0, 180)
      : undefined

  return {
    ...(userName ? { userName } : {}),
    ...(preferredName ? { preferredName } : {}),
    ...(likes ? { likes } : {}),
    ...(dislikes ? { dislikes } : {}),
    ...(favorites ? { favorites } : {}),
    ...(goals ? { goals, currentFocus: patch.currentFocus?.slice(0, 80) || goals[0] } : {}),
    ...(people?.length ? { people } : {}),
    ...(facts ? { facts } : {}),
    ...(standingInstructions ? { standingInstructions } : {}),
    ...(appearanceNotes ? { appearanceNotes } : {})
  }
}

export function filterKnownUserMemoryPatch(
  patch: Partial<ExtractedFacts>,
  current?: UserMemory | null
): Partial<ExtractedFacts> {
  if (!current) return patch
  const sameText = (a: string, b: string) => a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase()
  const unique = (
    values: string[] | undefined,
    existing: string[] | undefined,
    normalize = (value: string) => value.trim().toLocaleLowerCase()
  ) => {
    const known = new Set((existing || []).map(normalize))
    return values?.filter((value) => !known.has(normalize(value)))
  }
  const facts = unique(
    patch.facts,
    current.facts,
    (value) => value.replace(/^PIN:/i, '').trim().toLocaleLowerCase()
  )
  const likes = unique(patch.likes, current.likes)
  const dislikes = unique(patch.dislikes, current.dislikes)
  const favorites = unique(patch.favorites, current.favorites)
  const goals = unique(patch.goals, current.goals)
  const standingInstructions = unique(patch.standingInstructions, current.standingInstructions)
  const people = patch.people?.filter((person) => {
    const existing = current.people?.find(
      (candidate) => candidate.name.toLocaleLowerCase() === person.name.toLocaleLowerCase()
    )
    return (
      !existing ||
      !sameText(existing.relation || '', person.relation || '')
    )
  })
  return {
    ...(patch.userName && !sameText(patch.userName, current.userName || '')
      ? { userName: patch.userName }
      : {}),
    ...(patch.preferredName && !sameText(patch.preferredName, current.preferredName || '')
      ? { preferredName: patch.preferredName }
      : {}),
    ...(patch.appearanceNotes && !sameText(patch.appearanceNotes, current.appearanceNotes || '')
      ? { appearanceNotes: patch.appearanceNotes }
      : {}),
    ...(patch.currentFocus && !sameText(patch.currentFocus, current.currentFocus || '')
      ? { currentFocus: patch.currentFocus }
      : {}),
    ...(likes?.length ? { likes } : {}),
    ...(dislikes?.length ? { dislikes } : {}),
    ...(favorites?.length ? { favorites } : {}),
    ...(goals?.length ? { goals } : {}),
    ...(facts?.length ? { facts } : {}),
    ...(standingInstructions?.length ? { standingInstructions } : {}),
    ...(people?.length ? { people } : {})
  }
}
