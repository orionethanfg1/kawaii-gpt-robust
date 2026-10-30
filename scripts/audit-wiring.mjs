/**
 * Static wiring audit — no runtime Electron.
 * Exit 1 if a critical path is missing.
 */
import { readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')
const must = (cond, msg) => {
  if (!cond) {
    console.error('FAIL', msg)
    process.exitCode = 1
  } else {
    console.log('ok', msg)
  }
}

// Image intent: compliments must not force revision
{
  const rev = read('src/core/generative/image-revision.ts')
  must(rev.includes('Appearance nouns alone are NOT enough'), 'image-revision: compliment guard comment')
  must(rev.includes('editVerb'), 'image-revision: editVerb gate')
}

// Media plan: only assistant-generated prior images
{
  const plan = read('src/renderer/src/features/chat/services/chatMediaPlan.ts')
  must(plan.includes("m.role === 'assistant'"), 'chatMediaPlan: hasPrevImg assistant-only')
  must(plan.includes('detectGenerativeIntent'), 'chatMediaPlan: detectGenerativeIntent')
}

// Image cancel unlocks busy
{
  const meta = read('src/main/image-ipc-meta.ts')
  const gen = read('src/main/image-ipc-generate.ts')
  const shell = read('src/main/image-ipc.ts')
  must(shell.includes('imageGenState'), 'image-ipc: shared imageGenState')
  must(meta.includes('imageGenState.busy = false'), 'image:cancel clears busy')
  must(gen.includes('getBusy') && gen.includes('setBusy'), 'generate uses shared busy')
}

// Wardrobe media protocol + CSP
{
  const proto = read('src/main/media-protocol.ts')
  const html = read('src/renderer/index.html')
  const gallery = read('src/renderer/src/features/settings/AvatarGalleryPanel.tsx')
  must(proto.includes("host === 'wardrobe'"), 'media-protocol: wardrobe host')
  must(html.includes('kawaii-media:'), 'CSP allows kawaii-media')
  must(gallery.includes('wardrobeMediaUrl'), 'gallery uses wardrobeMediaUrl')
  must(gallery.includes('listWardrobeOnDisk'), 'gallery reconciles disk')
  must(gallery.includes('Abrir carpeta del guardarropa'), 'gallery open-folder button')
  must(gallery.includes('ghost') || gallery.includes('file gone') || gallery.includes('diskNames'), 'gallery purges missing files')
}

// useChat routes image modality
{
  const chat = read('src/renderer/src/features/chat/hooks/useChat.ts')
  must(chat.includes('runChatImageFlow'), 'useChat → runChatImageFlow')
}

// Preload IPC surface
{
  const pre = read('src/preload/index.ts')
  for (const k of [
    'filesToDataUrl',
    'filesListWardrobe',
    'filesOpenWardrobeDir',
    'imageGenerate',
    'unloadLocalModels'
  ]) {
    must(pre.includes(k), 'preload exposes ' + k)
  }
}

// Core modules still present
for (const f of [
  'src/core/chat/document-chunks.ts',
  'src/core/conversation/initiative.ts',
  'src/core/conversation/dual-memory.ts',
  'src/renderer/src/features/chat/services/runChatOrchestrationTurn.ts',
  'src/core/providers/lmstudio-lifecycle.ts'
]) {
  must(existsSync(join(root, f)), 'exists ' + f)
}

if (process.exitCode) {
  console.error('\naudit-wiring FAILED')
} else {
  console.log('\naudit-wiring OK')
}
