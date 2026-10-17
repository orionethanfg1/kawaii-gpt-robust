/**
 * Image IPC shell — registers generate + meta handlers.
 */
import { app } from 'electron'
import { join } from 'path'
import { mkdir } from 'fs/promises'
import { registerImageMetaIpc } from './image-ipc-meta'
import { registerImageGenerateIpc } from './image-ipc-generate'

function secureStoreGet(k: string, d = ""): string {
  try {
    const s = (globalThis as { __kawaiiSecureStore?: { get: (a: string, b?: string) => unknown } }).__kawaiiSecureStore
    return String(s?.get(k, d) ?? d ?? "")
  } catch {
    return d
  }
}

const imageAbortControllers = new Map<string, AbortController>()

async function ensureImagesDir(): Promise<string> {
  const dir = join(app.getPath('userData'), 'images')
  await mkdir(dir, { recursive: true })
  return dir
}

registerImageGenerateIpc({ ensureImagesDir, imageAbortControllers, secureStoreGet })
registerImageMetaIpc({ ensureImagesDir, imageAbortControllers })
