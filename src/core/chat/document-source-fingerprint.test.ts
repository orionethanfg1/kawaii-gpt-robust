import { describe, expect, it } from 'vitest'
import {
  makeSourceFingerprint,
  documentSourceChanged,
  emptyDocReadingState
} from './document-reading-state'

describe('document source fingerprint', () => {
  it('stable fingerprint', () => {
    expect(makeSourceFingerprint(1000, 50)).toBe('1000:50')
  })
  it('detects change', () => {
    const st = emptyDocReadingState('c1', 'book.docx', 5000, 3, {
      fingerprint: makeSourceFingerprint(1000, 50)
    })
    expect(documentSourceChanged(st, 1000, 50)).toBe(false)
    expect(documentSourceChanged(st, 1001, 50)).toBe(true)
    expect(documentSourceChanged(st, 1000, 51)).toBe(true)
  })
  it('no fingerprint = no false positive', () => {
    const st = emptyDocReadingState('c1', 'book.docx', 5000, 3)
    expect(documentSourceChanged(st, 999, 1)).toBe(false)
  })
})
