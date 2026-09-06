/**
 * Git sync helper for multi-account GitHub (SSH IdentityFile per repo).
 * Persists identity in .git/config so push does not "lose" the key.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

const execFileAsync = promisify(execFile)

export type GitIdentity = {
  /** Display label e.g. orionethan / armandohoyos */
  label: string
  /** Absolute path to private key */
  keyPath: string
  userName?: string
  userEmail?: string
  /** Optional SSH host alias (github-orionethan) — if set, remote URL is rewritten */
  hostAlias?: string
}

export type GitStatus = {
  ok: boolean
  repoRoot?: string
  branch?: string
  remoteUrl?: string
  remoteName?: string
  dirty?: boolean
  ahead?: number
  behind?: number
  staged?: number
  unstaged?: number
  untracked?: number
  userName?: string
  userEmail?: string
  sshCommand?: string
  lastError?: string
  log?: string[]
}

export type GitSyncResult = {
  ok: boolean
  steps: string[]
  stdout: string
  stderr: string
  error?: string
}

function projectRoot(): string {
  // electron-vite: main is out/main → project is ../..
  // Prefer cwd when running from project (Abrir.bat)
  const cwd = process.cwd()
  return cwd
}

/** Convert any GitHub remote to pure SSH (never HTTPS → no browser login). */
export function toGithubSshUrl(url: string, hostAlias?: string): string | null {
  const u = (url || '').trim()
  if (!u) return null
  const host = (hostAlias || 'github.com').trim() || 'github.com'
  // already ssh with alias or github.com
  let m =
    u.match(/^git@([^:]+):(.+?)(?:\.git)?$/i) ||
    u.match(/^ssh:\/\/git@([^/]+)\/(.+?)(?:\.git)?$/i)
  if (m) {
    const pathPart = m[2].replace(/\.git$/i, '')
    return `git@${host}:${pathPart}.git`
  }
  // https://github.com/user/repo.git
  m = u.match(/^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i)
  if (m) {
    return `git@${host}:${m[1]}/${m[2].replace(/\.git$/i, '')}.git`
  }
  // git://github.com/...
  m = u.match(/^git:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?/i)
  if (m) {
    return `git@${host}:${m[1]}/${m[2]}.git`
  }
  return null
}

async function runGit(
  args: string[],
  opts?: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number }
): Promise<{ code: number; stdout: string; stderr: string }> {
  const cwd = opts?.cwd || projectRoot()
  // Prefer local core.sshCommand so child never falls back to HTTPS credentials
  let gitSsh = opts?.env?.GIT_SSH_COMMAND
  if (!gitSsh) {
    try {
      const cfg = await execFileAsync('git', ['config', '--get', 'core.sshCommand'], {
        cwd,
        windowsHide: true
      })
      const v = String(cfg.stdout || '').trim()
      if (v) gitSsh = v
    } catch {
      /* no local sshCommand */
    }
  }
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...opts?.env,
    GIT_TERMINAL_PROMPT: '0',
    // Block interactive credential helpers (GCM browser popup)
    GIT_ASKPASS: 'echo',
    GCM_INTERACTIVE: 'never',
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'credential.helper',
    GIT_CONFIG_VALUE_0: ''
  }
  if (gitSsh) env.GIT_SSH_COMMAND = gitSsh
  try {
    const { stdout, stderr } = await execFileAsync('git', args, {
      cwd,
      env,
      timeout: opts?.timeoutMs ?? 120_000,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true
    })
    return { code: 0, stdout: String(stdout || ''), stderr: String(stderr || '') }
  } catch (e: unknown) {
    const err = e as {
      code?: number
      stdout?: string
      stderr?: string
      message?: string
    }
    return {
      code: typeof err.code === 'number' ? err.code : 1,
      stdout: String(err.stdout || ''),
      stderr: String(err.stderr || err.message || '')
    }
  }
}

export async function getGitStatus(): Promise<GitStatus> {
  const root = projectRoot()
  const steps: string[] = []
  const inside = await runGit(['rev-parse', '--is-inside-work-tree'], { cwd: root })
  if (inside.code !== 0 || !inside.stdout.includes('true')) {
    return { ok: false, lastError: 'No es un repositorio git (abre la app desde la carpeta del proyecto).', log: [inside.stderr] }
  }
  const repoRoot = (await runGit(['rev-parse', '--show-toplevel'], { cwd: root })).stdout.trim() || root
  const branch = (await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repoRoot })).stdout.trim()
  const remoteName = 'origin'
  const remoteUrl = (
    await runGit(['remote', 'get-url', remoteName], { cwd: repoRoot })
  ).stdout.trim()
  const userName = (await runGit(['config', 'user.name'], { cwd: repoRoot })).stdout.trim()
  const userEmail = (await runGit(['config', 'user.email'], { cwd: repoRoot })).stdout.trim()
  const sshCommand = (await runGit(['config', 'core.sshCommand'], { cwd: repoRoot })).stdout.trim()

  const statusPorcelain = await runGit(['status', '--porcelain'], { cwd: repoRoot })
  const lines = statusPorcelain.stdout.split(/\r?\n/).filter(Boolean)
  let staged = 0
  let unstaged = 0
  let untracked = 0
  for (const line of lines) {
    if (line.startsWith('??')) untracked++
    else {
      const x = line[0]
      const y = line[1]
      if (x && x !== ' ' && x !== '?') staged++
      if (y && y !== ' ' && y !== '?') unstaged++
    }
  }

  let ahead = 0
  let behind = 0
  const ab = await runGit(
    ['rev-list', '--left-right', '--count', `HEAD...${remoteName}/${branch}`],
    { cwd: repoRoot }
  )
  if (ab.code === 0) {
    const parts = ab.stdout.trim().split(/\s+/)
    ahead = Number(parts[0] || 0)
    behind = Number(parts[1] || 0)
  }

  return {
    ok: true,
    repoRoot,
    branch,
    remoteUrl,
    remoteName,
    dirty: lines.length > 0,
    ahead,
    behind,
    staged,
    unstaged,
    untracked,
    userName,
    userEmail,
    sshCommand,
    log: steps
  }
}

/** List private keys under ~/.ssh (no content, only names/paths) */
export async function listSshKeys(): Promise<Array<{ name: string; path: string }>> {
  const dir = path.join(os.homedir(), '.ssh')
  try {
    const names = await fs.readdir(dir)
    const out: Array<{ name: string; path: string }> = []
    for (const n of names) {
      if (n.endsWith('.pub') || n === 'config' || n === 'known_hosts' || n.endsWith('.old')) continue
      if (!n.startsWith('id_')) continue
      const full = path.join(dir, n)
      try {
        const st = await fs.stat(full)
        if (st.isFile()) out.push({ name: n, path: full })
      } catch {
        /* ignore */
      }
    }
    return out
  } catch {
    return []
  }
}

/**
 * Persist SSH key + identity for THIS repo only (does not change global git config).
 * Uses core.sshCommand with IdentitiesOnly=yes so the correct key always wins.
 */
export async function applyGitIdentity(identity: GitIdentity): Promise<GitSyncResult> {
  const steps: string[] = []
  const status = await getGitStatus()
  if (!status.ok || !status.repoRoot) {
    return { ok: false, steps, stdout: '', stderr: status.lastError || 'no repo', error: status.lastError }
  }
  const cwd = status.repoRoot
  const key = identity.keyPath.replace(/\\/g, '/')
  // Windows OpenSSH accepts forward slashes
  const sshCmd = `ssh -i "${key}" -o IdentitiesOnly=yes`
  steps.push(`core.sshCommand = ${sshCmd}`)
  await runGit(['config', 'core.sshCommand', sshCmd], { cwd })

  if (identity.userName) {
    steps.push(`user.name = ${identity.userName}`)
    await runGit(['config', 'user.name', identity.userName], { cwd })
  }
  if (identity.userEmail) {
    steps.push(`user.email = ${identity.userEmail}`)
    await runGit(['config', 'user.email', identity.userEmail], { cwd })
  }

  // ALWAYS force SSH remote — HTTPS triggers Git Credential Manager / browser login
  if (status.remoteUrl) {
    const sshUrl = toGithubSshUrl(status.remoteUrl, identity.hostAlias || undefined)
    if (sshUrl && sshUrl !== status.remoteUrl) {
      steps.push(`remote.origin.url (HTTPS→SSH): ${status.remoteUrl} → ${sshUrl}`)
      await runGit(['remote', 'set-url', 'origin', sshUrl], { cwd })
    } else if (sshUrl) {
      steps.push(`remote.origin.url ya es SSH: ${sshUrl}`)
      if (identity.hostAlias) {
        await runGit(['remote', 'set-url', 'origin', sshUrl], { cwd })
      }
    } else {
      steps.push(`AVISO: no pude convertir remote a SSH: ${status.remoteUrl}`)
    }
  }

  // Disable credential helper for this repo (prevents browser popup)
  await runGit(['config', 'credential.helper', ''], { cwd })
  await runGit(['config', 'credential.https://github.com.helper', ''], { cwd })
  steps.push('credential.helper desactivado en este repo (solo SSH)')

  // Save profile snapshot for UI
  try {
    const profilePath = path.join(cwd, '.kawaii-git-identity.json')
    await fs.writeFile(
      profilePath,
      JSON.stringify({ ...identity, keyPath: identity.keyPath, updatedAt: Date.now() }, null, 2),
      'utf8'
    )
    steps.push('Guardado .kawaii-git-identity.json (local)')
  } catch {
    /* ignore */
  }

  return { ok: true, steps, stdout: steps.join('\n'), stderr: '' }
}

export async function loadSavedIdentity(): Promise<GitIdentity | null> {
  try {
    const status = await getGitStatus()
    if (!status.repoRoot) return null
    const raw = await fs.readFile(path.join(status.repoRoot, '.kawaii-git-identity.json'), 'utf8')
    return JSON.parse(raw) as GitIdentity
  } catch {
    return null
  }
}

export async function gitAddAll(): Promise<GitSyncResult> {
  const status = await getGitStatus()
  if (!status.ok || !status.repoRoot) {
    return { ok: false, steps: [], stdout: '', stderr: status.lastError || '', error: status.lastError }
  }
  const r = await runGit(['add', '-A'], { cwd: status.repoRoot })
  return {
    ok: r.code === 0,
    steps: ['git add -A'],
    stdout: r.stdout,
    stderr: r.stderr,
    error: r.code !== 0 ? r.stderr : undefined
  }
}

export async function gitCommit(message: string): Promise<GitSyncResult> {
  const status = await getGitStatus()
  if (!status.ok || !status.repoRoot) {
    return { ok: false, steps: [], stdout: '', stderr: status.lastError || '', error: status.lastError }
  }
  const msg = (message || '').trim() || `chore: sync ${new Date().toISOString().slice(0, 19)}`
  const r = await runGit(['commit', '-m', msg], { cwd: status.repoRoot })
  // exit 1 often means "nothing to commit"
  const nothing = /nothing to commit/i.test(r.stdout + r.stderr)
  return {
    ok: r.code === 0 || nothing,
    steps: [`git commit -m ${JSON.stringify(msg)}`],
    stdout: r.stdout,
    stderr: r.stderr,
    error: r.code !== 0 && !nothing ? r.stderr : undefined
  }
}

export async function gitPush(opts?: { force?: boolean; setUpstream?: boolean }): Promise<GitSyncResult> {
  const status = await getGitStatus()
  if (!status.ok || !status.repoRoot) {
    return { ok: false, steps: [], stdout: '', stderr: status.lastError || '', error: status.lastError }
  }
  // Harden: if remote is still HTTPS, refuse rather than open browser login
  if (status.remoteUrl && /^https?:\/\//i.test(status.remoteUrl)) {
    const fixed = toGithubSshUrl(status.remoteUrl)
    if (fixed) {
      await runGit(['remote', 'set-url', 'origin', fixed], { cwd: status.repoRoot })
      status.remoteUrl = fixed
    } else {
      return {
        ok: false,
        steps: [],
        stdout: '',
        stderr: '',
        error:
          'El remote es HTTPS y provocaría login en el navegador. ' +
          'Usa «Guardar identidad» para convertirlo a SSH (git@github.com:...).'
      }
    }
  }
  const args = ['push']
  if (opts?.setUpstream) args.push('-u', 'origin', status.branch || 'HEAD')
  else if (opts?.force) args.push('--force-with-lease')
  else args.push('origin', status.branch || 'HEAD')

  // Prefer force-with-lease over --force; still allow true force if requested twice
  if (opts?.force && opts?.setUpstream) {
    /* ignore */
  }
  const r = await runGit(args, { cwd: status.repoRoot, timeoutMs: 180_000 })
  return {
    ok: r.code === 0,
    steps: [`git ${args.join(' ')}`],
    stdout: r.stdout,
    stderr: r.stderr,
    error: r.code !== 0 ? r.stderr || r.stdout : undefined
  }
}

export async function gitForcePush(): Promise<GitSyncResult> {
  const status = await getGitStatus()
  if (!status.ok || !status.repoRoot) {
    return { ok: false, steps: [], stdout: '', stderr: status.lastError || '', error: status.lastError }
  }
  if (status.remoteUrl && /^https?:\/\//i.test(status.remoteUrl)) {
    const fixed = toGithubSshUrl(status.remoteUrl)
    if (fixed) {
      await runGit(['remote', 'set-url', 'origin', fixed], { cwd: status.repoRoot })
    }
  }
  const branch = status.branch || 'HEAD'
  const r = await runGit(['push', '--force', 'origin', branch], {
    cwd: status.repoRoot,
    timeoutMs: 180_000
  })
  return {
    ok: r.code === 0,
    steps: [`git push --force origin ${branch}`],
    stdout: r.stdout,
    stderr: r.stderr,
    error: r.code !== 0 ? r.stderr || r.stdout : undefined
  }
}

/** add -A → commit → push (optional force) in one shot */
export async function gitSyncAll(opts: {
  message: string
  force?: boolean
}): Promise<GitSyncResult> {
  const steps: string[] = []
  let stdout = ''
  let stderr = ''

  const add = await gitAddAll()
  steps.push(...add.steps)
  stdout += add.stdout
  stderr += add.stderr
  if (!add.ok) return { ok: false, steps, stdout, stderr, error: add.error }

  const commit = await gitCommit(opts.message)
  steps.push(...commit.steps)
  stdout += commit.stdout
  stderr += commit.stderr
  if (!commit.ok) return { ok: false, steps, stdout, stderr, error: commit.error }

  const push = opts.force ? await gitForcePush() : await gitPush({ setUpstream: true })
  steps.push(...push.steps)
  stdout += push.stdout
  stderr += push.stderr
  return {
    ok: push.ok,
    steps,
    stdout,
    stderr,
    error: push.error
  }
}

export async function testSshAuth(): Promise<GitSyncResult> {
  const status = await getGitStatus()
  if (!status.ok || !status.repoRoot) {
    return { ok: false, steps: [], stdout: '', stderr: status.lastError || '', error: status.lastError }
  }
  // ssh -T uses host from remote; use git ls-remote as safer test
  const r = await runGit(['ls-remote', '--heads', 'origin'], {
    cwd: status.repoRoot,
    timeoutMs: 45_000
  })
  return {
    ok: r.code === 0,
    steps: ['git ls-remote --heads origin'],
    stdout: r.stdout.slice(0, 500),
    stderr: r.stderr,
    error: r.code !== 0 ? (r.stderr || r.stdout || 'SSH/auth falló. ¿Remote HTTPS? Guarda identidad para forzar SSH.') : undefined
  }
}
