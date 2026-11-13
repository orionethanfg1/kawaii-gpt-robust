import { describe, expect, it } from 'vitest'
import { pickArchiveLinesForTurn } from './memory-archive-retrieve'

describe('memory archive retrieval', () => {
  const blob = {
    lines: [
      'Le gusta el café de olla.',
      'Está trabajando en el catálogo de Michoacán.',
      'Su hermana Ana vive en Guadalajara.'
    ]
  }

  it('does not inject arbitrary archive lines when a turn has no match', () => {
    expect(pickArchiveLinesForTurn(blob, 'Hola, ¿cómo estás?')).toEqual([])
    expect(pickArchiveLinesForTurn(blob, '¿Qué opinas del clima?')).toEqual([])
  })

  it('allows a small recent recall only for explicit memory questions', () => {
    expect(pickArchiveLinesForTurn(blob, '¿Qué recuerdas?')).toEqual(blob.lines.slice(-2))
  })

  it('ranks archive lines by topical overlap', () => {
    expect(pickArchiveLinesForTurn(blob, 'Retomemos el catálogo de Michoacán')).toEqual([
      blob.lines[1]
    ])
  })
})
