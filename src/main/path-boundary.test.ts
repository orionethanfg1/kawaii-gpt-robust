import { describe, expect, it } from 'vitest'
import { isPathInsideRoot, normalizeForCompare, assertPathAllowed } from './path-boundary'
import { join } from 'path'
import { mkdirSync, writeFileSync, rmSync, symlinkSync, existsSync } from 'fs'
import { tmpdir } from 'os'

describe('path-boundary G1/P0', () => {
  const root = join(tmpdir(), 'kawaii-boundary-test-root')
  const sibling = join(tmpdir(), 'kawaii-boundary-test-root-extra')

  it('isPathInsideRoot accepts child and rejects sibling prefix', () => {
    expect(isPathInsideRoot(join(root, 'a', 'b.txt'), root)).toBe(true)
    expect(isPathInsideRoot(root, root)).toBe(true)
    // sibling with shared prefix must fail
    expect(isPathInsideRoot(sibling, root)).toBe(false)
    expect(isPathInsideRoot(join(sibling, 'x'), root)).toBe(false)
  })

  it('rejects path traversal style when resolved under sibling', () => {
    const attack = join(root, '..', 'kawaii-boundary-test-root-extra', 'secret.txt')
    // After resolve this leaves root
    expect(isPathInsideRoot(attack, root)).toBe(false)
  })

  it('assertPathAllowed under temp fixture', () => {
    mkdirSync(join(root, 'wardrobe'), { recursive: true })
    const file = join(root, 'wardrobe', 'a.png')
    writeFileSync(file, 'x')
    const ok = assertPathAllowed(file, root)
    expect(ok.ok).toBe(true)
    if (ok.ok) expect(ok.path).toContain('wardrobe')

    const bad = assertPathAllowed(join(sibling, 'nope.txt'), root)
    expect(bad.ok).toBe(false)

    try {
      rmSync(root, { recursive: true, force: true })
    } catch {
      /* */
    }
  })

  it('normalizeForCompare is stable', () => {
    const a = normalizeForCompare(root + sepish())
    const b = normalizeForCompare(root)
    expect(a).toBe(b)
  })
})

function sepish(): string {
  return process.platform === 'win32' ? '\\' : '/'
}
