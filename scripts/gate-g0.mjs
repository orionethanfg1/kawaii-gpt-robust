#!/usr/bin/env node
/**
 * G0 baseline: typecheck gate + focused vitest (path-boundary + intimacy chip).
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function run(cmd, args) {
  console.log('>', cmd, args.join(' '))
  const r = spawnSync(cmd, args, {
    cwd: root,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    maxBuffer: 8 * 1024 * 1024
  })
  if (r.stdout) process.stdout.write(r.stdout)
  if (r.stderr) process.stderr.write(r.stderr)
  return r.status ?? 1
}

let code = run('node', ['scripts/typecheck-gate.mjs'])
if (code !== 0) {
  console.error('G0 typecheck-gate failed')
  process.exit(code)
}

code = run('npx', [
  'vitest',
  'run',
  'src/main/path-boundary.test.ts',
  'src/core/conversation/intimacy-phase-chip.test.ts',
  'src/core/conversation/assistant-memory.test.ts'
])
if (code !== 0) {
  console.error('G0 vitest focused failed')
  process.exit(code)
}
console.log('G0 gate OK')
