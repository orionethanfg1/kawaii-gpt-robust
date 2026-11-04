export type NonHumanSubject = {
  key: string
  prompt: string
  kind: 'creature' | 'animal' | 'object' | 'landscape'
}

const SUBJECTS: Array<{
  pattern: RegExp
  subject: NonHumanSubject
}> = [
  {
    pattern: /\bdrag[oó]n(?:es|s)?\b/i,
    subject: {
      key: 'dragon',
      kind: 'creature',
      prompt:
        '(dragon:1.4), majestic full-body dragon, four-legged mythical reptile, detailed scales, large powerful wings, horns, claws, long tail, complete creature visible'
    }
  },
  {
    pattern: /\b(f[eé]nix|phoenix)\b/i,
    subject: {
      key: 'phoenix',
      kind: 'creature',
      prompt: '(phoenix:1.35), full-body mythical firebird, radiant layered feathers, wings spread'
    }
  },
  {
    pattern: /\b(unicornio|unicorn)\b/i,
    subject: {
      key: 'unicorn',
      kind: 'creature',
      prompt: '(unicorn:1.35), full-body magical horse, single spiraled horn, flowing mane'
    }
  },
  {
    pattern: /\b(lobo|wolf)\b/i,
    subject: {
      key: 'wolf',
      kind: 'animal',
      prompt: '(wolf:1.3), full-body wild wolf, detailed fur, four legs, natural animal anatomy'
    }
  },
  {
    pattern: /\b(perro|dog|cachorro|puppy)\b/i,
    subject: {
      key: 'dog',
      kind: 'animal',
      prompt: '(dog:1.3), full-body dog, detailed fur, four legs, natural animal anatomy'
    }
  },
  {
    pattern: /\b(gato|cat|gatito|kitten)\b/i,
    subject: {
      key: 'cat',
      kind: 'animal',
      prompt: '(cat:1.3), full-body cat, detailed fur, four legs, natural animal anatomy'
    }
  },
  {
    pattern: /\b(caballo|horse)\b/i,
    subject: {
      key: 'horse',
      kind: 'animal',
      prompt: '(horse:1.3), full-body horse, detailed mane, four legs, natural animal anatomy'
    }
  },
  {
    pattern: /(?:^|[^a-z])(águila|aguila|eagle)(?:$|[^a-z])/i,
    subject: {
      key: 'eagle',
      kind: 'animal',
      prompt: '(eagle:1.3), full-body eagle, detailed feathers, wings, natural bird anatomy'
    }
  }
]

export function describeNonHumanSubject(text: string): NonHumanSubject | undefined {
  return SUBJECTS.find(({ pattern }) => pattern.test(text))?.subject
}

const WORD_TRANSLATIONS: Array<[RegExp, string]> = [
  [/\bdrag[oó]n(?:es|s)?\b/gi, 'dragon'],
  [/\bperros?\b/gi, 'dog'],
  [/\bgatos?\b/gi, 'cat'],
  [/\blobos?\b/gi, 'wolf'],
  [/\bcaballos?\b/gi, 'horse'],
  [/\bf[eé]nix\b/gi, 'phoenix'],
  [/\bunicornios?\b/gi, 'unicorn'],
  [/\b(realista|realistas|realismo)\b/gi, 'photorealistic'],
  [/\bvolando\b/gi, 'flying'],
  [/\bvolar\b/gi, 'in flight'],
  [/\bmajestuoso|majestuosa\b/gi, 'majestic'],
  [/\bverde\b/gi, 'green'],
  [/\brojo|roja\b/gi, 'red'],
  [/\bazul\b/gi, 'blue'],
  [/\bnegro|negra\b/gi, 'black'],
  [/\bblanco|blanca\b/gi, 'white'],
  [/\bdorado|dorada\b/gi, 'golden'],
  [/\bmonta[nñ]a(s)?\b/gi, 'mountain$1'],
  [/\bciudad\b/gi, 'city'],
  [/\bbosque\b/gi, 'forest'],
  [/\bplaya\b/gi, 'beach'],
  [/\bnoche\b/gi, 'night'],
  [/\batardecer\b/gi, 'sunset']
]

export function translateImagePromptText(text: string): string {
  return WORD_TRANSLATIONS.reduce((result, [pattern, replacement]) => {
    return result.replace(pattern, replacement)
  }, text)
}
