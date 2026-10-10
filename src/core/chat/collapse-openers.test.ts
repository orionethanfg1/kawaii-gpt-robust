import { describe, expect, it } from 'vitest'
import { collapseRepeatedOpeners, cutAtSecondRestart } from './collapse-openers'

describe('assistant reply restart cleanup', () => {
  it('keeps a distinct second preference sentence instead of truncating it', () => {
    const reply =
      'Me encanta leer novelas históricas por la noche porque me ayuda a imaginar otros mundos y descansar después de un día largo. Me encanta el café de olla con canela.'

    expect(cutAtSecondRestart(reply)).toContain('Me encanta el café de olla con canela.')
  })

  it('still removes a genuinely repeated preference sentence', () => {
    const reply =
      'Me encanta leer novelas históricas por la noche porque me ayuda a imaginar otros mundos y descansar después de un día largo. Me encanta leer novelas históricas por la noche porque me ayuda a imaginar otros mundos y descansar después de un día largo.'

    const cleaned = collapseRepeatedOpeners(reply)
    expect(cleaned.match(/Me encanta leer novelas históricas/gi)).toHaveLength(1)
  })
})
