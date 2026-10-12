/**
 * Pure helpers for ModelCatalogPanel — unit-testable without React.
 */

export type InstallFilter = 'all' | 'installed' | 'not-installed'

export type CatalogRowInput = {
  key: string
  pullName: string
  label: string
  installed: boolean
  source: string
}

export function matchesInstallFilter(
  row: { installed: boolean },
  filter: InstallFilter
): boolean {
  if (filter === 'installed') return row.installed
  if (filter === 'not-installed') return !row.installed
  return true
}

export function isNameInstalled(
  name: string,
  installedIds: string[]
): boolean {
  const n = name.toLowerCase()
  return installedIds.some(
    (i) =>
      i === n ||
      i.startsWith(n) ||
      n.startsWith(i) ||
      i.includes(n) ||
      n.includes(i)
  )
}

export function filterCatalogRows(
  rows: CatalogRowInput[],
  opts: { query?: string; installFilter?: InstallFilter }
): CatalogRowInput[] {
  const q = (opts.query || '').trim().toLowerCase()
  const filter = opts.installFilter || 'all'
  return rows.filter((row) => {
    if (!matchesInstallFilter(row, filter)) return false
    if (!q) return true
    const hay = `${row.label} ${row.pullName} ${row.source}`.toLowerCase()
    return hay.includes(q)
  })
}

/** Merge installed + remote without duplicate pull names */
export function mergeCatalogSources(
  installed: Array<{ id: string; source: string }>,
  remote: Array<{ id: string; pullName: string; label: string; source: string }>
): CatalogRowInput[] {
  const seen = new Set<string>()
  const out: CatalogRowInput[] = []
  for (const m of installed) {
    const key = m.id.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      key: `inst-${m.id}`,
      pullName: m.id,
      label: m.id,
      installed: true,
      source: m.source
    })
  }
  const installedIds = installed.map((x) => x.id.toLowerCase())
  for (const r of remote) {
    const key = r.pullName.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      key: r.id,
      pullName: r.pullName,
      label: r.label,
      installed: isNameInstalled(r.pullName, installedIds),
      source: r.source
    })
  }
  return out
}
