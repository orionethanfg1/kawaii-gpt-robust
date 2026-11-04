/**
 * Minimal line diff for A4 file-edit previews (no external deps).
 */
export function unifiedDiff(before: string, after: string, fileLabel = 'file'): string {
  const a = String(before || '').split(/\r?\n/)
  const b = String(after || '').split(/\r?\n/)
  const lines: string[] = [`--- a/${fileLabel}`, `+++ b/${fileLabel}`]
  const max = Math.max(a.length, b.length)
  let i = 0
  while (i < max) {
    if (i < a.length && i < b.length && a[i] === b[i]) {
      lines.push(' ' + a[i])
      i++
      continue
    }
    // find next sync point (simple)
    let found = -1
    for (let j = i; j < Math.min(max, i + 40); j++) {
      for (let k = i; k < Math.min(max, i + 40); k++) {
        if (j < a.length && k < b.length && a[j] === b[k] && a[j] !== undefined) {
          found = j
          // emit deletes then inserts until sync
          for (let d = i; d < j; d++) if (d < a.length) lines.push('-' + a[d])
          for (let n = i; n < k; n++) if (n < b.length) lines.push('+' + b[n])
          i = Math.max(j, k)
          break
        }
      }
      if (found >= 0) break
    }
    if (found < 0) {
      for (let d = i; d < a.length; d++) lines.push('-' + a[d])
      for (let n = i; n < b.length; n++) lines.push('+' + b[n])
      break
    }
  }
  return lines.slice(0, 400).join('\n')
}
