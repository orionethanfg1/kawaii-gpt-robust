import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Local draft for text fields + debounced commit to global store.
 * Typing stays on the React local state path; expensive update() runs after pause.
 */
export function useDebouncedCommit(
  committedValue: string,
  commit: (next: string) => void,
  delayMs = 280
): [string, (next: string) => void, () => void] {
  const [draft, setDraft] = useState(committedValue)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const commitRef = useRef(commit)
  commitRef.current = commit
  const lastCommitted = useRef(committedValue)

  // Sync when external store changes (and we're not mid-edit)
  useEffect(() => {
    if (timer.current) return
    if (committedValue !== lastCommitted.current) {
      lastCommitted.current = committedValue
      setDraft(committedValue)
    }
  }, [committedValue])

  const flush = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    const v = draft
    if (v === lastCommitted.current) return
    lastCommitted.current = v
    commitRef.current(v)
  }, [draft])

  const set = useCallback(
    (next: string) => {
      setDraft(next)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        timer.current = null
        lastCommitted.current = next
        commitRef.current(next)
      }, delayMs)
    },
    [delayMs]
  )

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    []
  )

  return [draft, set, flush]
}
