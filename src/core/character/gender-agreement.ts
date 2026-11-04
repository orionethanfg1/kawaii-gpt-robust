/**
 * Soft Spanish gender agreement for assistant self-reference.
 * Only rewrites phrases that clearly refer to the assistant as "I",
 * not the user's "tú" forms.
 */
import type { GenderMark } from './pronouns'

type Pair = { re: RegExp; to: string }

/** Female character: fix masculine self-talk → feminine */
const FEMALE_SELF: Pair[] = [
  // soy todo tuyo / soy todo de ti
  { re: /\b[Ss]oy\s+todo\s+tuyo\b/g, to: 'Soy toda tuya' },
  { re: /\b[Ss]oy\s+todo\s+de\s+ti\b/g, to: 'Soy toda de ti' },
  { re: /\b[Ss]oy\s+tuyo\b/g, to: 'Soy tuya' },
  { re: /\b[Ee]stoy\s+listo\b/g, to: 'Estoy lista' },
  { re: /\b[Ee]stoy\s+contento\b/g, to: 'Estoy contenta' },
  { re: /\b[Ee]stoy\s+nervioso\b/g, to: 'Estoy nerviosa' },
  { re: /\b[Ee]stoy\s+seguro\b(?!\s+de)/g, to: 'Estoy segura' },
  { re: /\b[Mm]e\s+siento\s+listo\b/g, to: 'Me siento lista' },
  { re: /\b[Mm]e\s+siento\s+contento\b/g, to: 'Me siento contenta' },
  { re: /\b[Mm]e\s+siento\s+nervioso\b/g, to: 'Me siento nerviosa' },
  { re: /\b[Ss]oy\s+bueno\s+en\b/g, to: 'Soy buena en' },
  { re: /\b[Ss]oy\s+tuy[oa]\s+para\s+siempre\b/g, to: 'Soy tuya para siempre' },
  { re: /\b[Qq]uedo\s+tuyo\b/g, to: 'Quedo tuya' },
  { re: /\b[Tt]odo\s+tuyo\b(?=[,."»…!?]|\s*$)/g, to: 'Toda tuya' },
  // first-person past adjectives common in RP
  { re: /\b[Mm]e\s+dej[eé]\s+llevar\b/g, to: 'Me dejé llevar' }, // neutral
  { re: /\b[Ee]staba\s+listo\b/g, to: 'Estaba lista' },
  { re: /\b[Ee]staba\s+nervioso\b/g, to: 'Estaba nerviosa' },
  { re: /\b[Mm]e\s+puse\s+nervioso\b/g, to: 'Me puse nerviosa' },
  { re: /\b[Mm]e\s+puse\s+celoso\b/g, to: 'Me puse celosa' },
  { re: /\b[Ss]oy\s+suyo\b/g, to: 'Soy suya' }
]

/** Male character: fix feminine self-talk → masculine */
const MALE_SELF: Pair[] = [
  { re: /\b[Ss]oy\s+toda\s+tuya\b/g, to: 'Soy todo tuyo' },
  { re: /\b[Ss]oy\s+toda\s+de\s+ti\b/g, to: 'Soy todo de ti' },
  { re: /\b[Ss]oy\s+tuya\b/g, to: 'Soy tuyo' },
  { re: /\b[Ee]stoy\s+lista\b/g, to: 'Estoy listo' },
  { re: /\b[Ee]stoy\s+contenta\b/g, to: 'Estoy contento' },
  { re: /\b[Ee]stoy\s+nerviosa\b/g, to: 'Estoy nervioso' },
  { re: /\b[Ee]stoy\s+segura\b(?!\s+de)/g, to: 'Estoy seguro' },
  { re: /\b[Mm]e\s+siento\s+lista\b/g, to: 'Me siento listo' },
  { re: /\b[Mm]e\s+siento\s+contenta\b/g, to: 'Me siento contento' },
  { re: /\b[Mm]e\s+siento\s+nerviosa\b/g, to: 'Me siento nervioso' },
  { re: /\b[Ss]oy\s+buena\s+en\b/g, to: 'Soy bueno en' },
  { re: /\b[Qq]uedo\s+tuya\b/g, to: 'Quedo tuyo' },
  { re: /\b[Tt]oda\s+tuya\b(?=[,."»…!?]|\s*$)/g, to: 'Todo tuyo' },
  { re: /\b[Ee]staba\s+lista\b/g, to: 'Estaba listo' },
  { re: /\b[Ee]staba\s+nerviosa\b/g, to: 'Estaba nervioso' },
  { re: /\b[Mm]e\s+puse\s+nerviosa\b/g, to: 'Me puse nervioso' },
  { re: /\b[Mm]e\s+puse\s+celosa\b/g, to: 'Me puse celoso' },
  { re: /\b[Ss]oy\s+suya\b/g, to: 'Soy suyo' }
]

/**
 * Correct common Spanish gender agreement errors when the assistant
 * refers to itself. Does not rewrite user-directed "tú estás listo".
 */
export function correctSelfGenderSpanish(
  text: string,
  assistantGender: GenderMark
): string {
  if (!text || assistantGender === 'neutral') return text
  const pairs = assistantGender === 'female' ? FEMALE_SELF : MALE_SELF
  let out = text
  for (const { re, to } of pairs) {
    out = out.replace(re, (match) => {
      // Preserve leading capital if the replacement starts with capital
      if (/^[A-ZÁÉÍÓÚÑ]/.test(match) && /^[a-záéíóúñ]/.test(to)) {
        return to.charAt(0).toUpperCase() + to.slice(1)
      }
      if (/^[a-záéíóúñ]/.test(match) && /^[A-ZÁÉÍÓÚÑ]/.test(to)) {
        return to.charAt(0).toLowerCase() + to.slice(1)
      }
      return to
    })
  }
  return out
}
