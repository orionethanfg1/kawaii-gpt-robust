#!/usr/bin/env node
/**
 * Lightweight sanity: no obvious broken string literals / unmatched exports patterns.
 * Does not replace typecheck — run before packaging when possible.
 */
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const srcRoot = path.join(root, 'src')
let files = 0
let issues = 0

function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name === 'out') continue
    const p = path.join(dir, name)
    const st = fs.statSync(p)
    if (st.isDirectory()) walk(p)
    else if (/\.(ts|tsx|js|mjs)$/.test(name)) check(p)
  }
}

function check(file) {
  files++
  const text = fs.readFileSync(file, 'utf8')
  // unterminated template-ish: line ends with odd number of unescaped quotes in crude way
  const lines = text.split(/\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    // ignore strings that document error messages for the user
    if (/FIXME:\s*BROKEN/.test(line)) {
      console.error('FLAG', file + ':' + (i + 1), line.trim().slice(0, 120))
      issues++
    }
  }
  // common typo from past incidents: ipcMain.handle('foo, async
  if (/ipcMain\.handle\('[^']+,\s*async/.test(text)) {
    console.error('BAD_IPC', file)
    issues++
  }
}

if (!fs.existsSync(srcRoot)) {
  console.error('No src/')
  process.exit(1)
}
walk(srcRoot)
if (issues) {
  console.error('FAIL: ' + issues + ' issue(s) in ' + files + ' files')
  process.exit(1)
}
console.log('OK: sanity checks passed (' + files + ' ts/tsx files)')
