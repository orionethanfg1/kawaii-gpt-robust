/**
 * Source sanity + release gates. Run: node scripts/verify-source.mjs
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
let errors = 0
let warnings = 0

function fail(msg) {
  console.error('FAIL', msg)
  errors++
}
function warn(msg) {
  console.warn('WARN', msg)
  warnings++
}

function walk(dir, out = []) {
  let names
  try {
    names = readdirSync(dir)
  } catch {
    return out
  }
  for (const name of names) {
    if (name === 'node_modules' || name === 'out' || name === 'dist' || name === '.git') continue
    const p = join(dir, name)
    let st
    try {
      st = statSync(p)
    } catch {
      continue
    }
    if (st.isDirectory()) walk(p, out)
    else if (/\.(ts|tsx|mjs|js)$/.test(name)) out.push(p)
  }
  return out
}

const files = walk(join(root, 'src'))
for (const file of files) {
  const text = readFileSync(file, 'utf8')
  const rel = file.slice(root.length + 1).replace(/\\/g, '/')

  if (/\.split\('\r?\n'\)/.test(text) || /\.split\("\r?\n"\)/.test(text)) {
    fail(`${rel} - corrupted newline inside split quotes`)
  }

  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    if (/\.split\(\s*['"]\s*$/.test(lines[i])) {
      fail(`${rel}:${i + 1} - split opens string at end of line`)
    }
    // ipcMain.handle with broken channel string
    if (/handle\(\s*'[^']*,\s*async/.test(lines[i]) || /handle\(\s*"[^"]*,\s*async/.test(lines[i])) {
      fail(`${rel}:${i + 1} - broken handle('channel, async') missing closing quote`)
    }
    // Odd number of single quotes on ipc lines (heuristic)
    if (lines[i].includes('ipcMain.handle') && (lines[i].match(/'/g) || []).length % 2 === 1) {
      fail(`${rel}:${i + 1} - odd single quotes on ipcMain.handle line`)
    }
  }

  if (/\.(ts|tsx)$/.test(rel)) {
    const opens = (text.match(/\{/g) || []).length
    const closes = (text.match(/\}/g) || []).length
    if (opens !== closes) {
      fail(`${rel} - unbalanced braces ${opens} vs ${closes}`)
    }
  }
}

for (const f of [
  'src/main/index.ts',
  'src/main/forge-runtime.ts',
  'src/main/ollama-pull-jobs.ts',
  'src/preload/index.ts',
  'src/shared/version.ts',
  'src/core/models/recommendations.ts',
  'package.json',
  'Abrir.ps1'
]) {
  if (!existsSync(join(root, f))) fail(`missing ${f}`)
}

// Version sync
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const verTs = readFileSync(join(root, 'src/shared/version.ts'), 'utf8')
const m = verTs.match(/APP_VERSION\s*=\s*['"]([^'"]+)['"]/)
if (!m) fail('APP_VERSION not found in version.ts')
else if (m[1] !== pkg.version) fail(`version mismatch package.json=${pkg.version} version.ts=${m[1]}`)
else console.log('OK version', pkg.version)

// Critical IPC channels present
const main = readFileSync(join(root, 'src/main/index.ts'), 'utf8')
const preload = readFileSync(join(root, 'src/preload/index.ts'), 'utf8')
for (const ch of [
  'ollama:pull',
  'ollama:pull-cancel',
  'ollama:list-pull-jobs',
  'forge:start',
  'forge:status'
]) {
  if (!main.includes(`'${ch}'`) && !main.includes(`"${ch}"`)) fail(`main missing channel ${ch}`)
}
if (!preload.includes('ollamaListPullJobs')) fail('preload missing ollamaListPullJobs')
if (!preload.includes('ollama:pull-cancel')) fail('preload missing pull-cancel invoke')

// Forge health must not treat / as API
const forge = readFileSync(join(root, 'src/main/forge-runtime.ts'), 'utf8')
if (!forge.includes('/sdapi/v1/sd-models')) fail('forge probe missing sd-models')
if (/paths\s*=\s*\[[^\]]*['"]\/['"]/.test(forge) && forge.includes("'/docs'")) {
  // old permissive probe - check probe only uses api paths first
  warn('forge-runtime may still reference / or /docs in probe - verify ok requires sdapi')
}

// No promptAlreadyBridged undefined pattern left as bare identifier misuse hard to detect

console.log(`Checked ${files.length} source files`)
if (errors) {
  console.error(`FAILED with ${errors} error(s), ${warnings} warning(s)`)
  process.exit(1)
}
console.log(`OK: sanity checks passed (${files.length} files, ${warnings} warnings)`)
