from pathlib import Path
import re

root = Path("/home/workdir/artifacts/kawaii-gpt-robust")

# --- parse-intent title + lead ---
pi = root / "src/core/agenda/parse-intent.ts"
pt = pi.read_text(encoding="utf-8")
start = pt.find("  let title = raw")
end = pt.find("  if (title.length < 2)", start)
if start < 0 or end < 0:
    raise SystemExit(f"title markers {start} {end}")
new_title = r"""  let title = raw
  title = title
    .replace(/\b(recu[eé]rdame|recuerdame|av[ií]same|avisame)\b/gi, '')
    .replace(/\b(gracias|por\s+favor|plis|please|preciosa|hermosa|amor|cari[nñ]o)\b/gi, '')
    .replace(/\b(podemos\s+hablar\s+de|lo\s+hablamos\s+de|sobre)\b/gi, '')
    .replace(/\b(mañana|pasado\s+mañana|en\s+una?\s+hora|en\s+\d+\s*min(?:uto)?s?|en\s+un\s+minuto|hoy|ahora)\b/gi, '')
    .replace(/\ba\s+las\s+\d{1,2}(:\d{2})?\b/gi, '')
    .replace(/^(de\s+|a\s+|que\s+|para\s+)/i, '')
    .replace(/\s+/g, ' ')
    .trim()
"""
pt = pt[:start] + new_title + pt[end:]

old_notify = """    notify: (() => {
      const insist = resolveInsist(raw, prefs, sensitivity)
      const lead = type === 'reminder' ? resolveLeadMinutes(raw, prefs) : undefined
      return {
        leadMinutes: lead,
        insist,
        maxNudges: maxNudgesForInsist(insist),
        nudgesSent: 0
      }
    })(),"""
new_notify = """    notify: (() => {
      const insist = resolveInsist(raw, prefs, sensitivity)
      let lead = type === 'reminder' ? resolveLeadMinutes(raw, prefs) : undefined
      const rel = when.relativeMs ?? (when.at != null ? when.at - now : 0)
      if (type === 'reminder' && rel > 0 && rel < 10 * 60_000) {
        lead = 0
      } else if (type === 'reminder' && lead != null && when.at != null) {
        const until = when.at - now
        if (until > 0 && lead * 60_000 >= until) lead = 0
      }
      return {
        leadMinutes: lead,
        insist,
        maxNudges: maxNudgesForInsist(insist),
        nudgesSent: 0
      }
    })(),"""
if old_notify not in pt:
    raise SystemExit("notify block not found")
pt = pt.replace(old_notify, new_notify)
pi.write_text(pt, encoding="utf-8")
print("parse-intent ok")

# --- due.test ---
due_test = root / "src/core/agenda/due.test.ts"
dt = due_test.read_text(encoding="utf-8")
if "short relative ignores lead" not in dt:
    needle = "describe('A2 due engine', () => {"
    add = """describe('A2 due engine', () => {
  it('short relative ignores lead so it is not immediately due', () => {
    const now = Date.now()
    const it = item({
      id: 'short',
      type: 'reminder',
      title: 'agua',
      when: { kind: 'relative', at: now + 60_000, relativeMs: 60_000 },
      notify: { insist: 'once', leadMinutes: 15, maxNudges: 1, nudgesSent: 0 },
      status: 'pending'
    })
    expect(isItemDue(it, now)).toBe(false)
    expect(isItemDue(it, now + 61_000)).toBe(true)
  })
"""
    if needle not in dt:
        raise SystemExit("due describe not found")
    dt = dt.replace(needle, add, 1)
    due_test.write_text(dt, encoding="utf-8")
    print("due test ok")
else:
    print("due test exists")

# --- parse test ---
ptest = root / "src/core/agenda/parse-intent.test.ts"
tt =ptest.read_text(encoding="utf-8")
if "leadMinutes" not in tt:
    tt = tt.rstrip() + """

  it('reminder in N minutes has lead 0', () => {
    const now = Date.UTC(2026, 9, 10, 15, 0, 0)
    const r = parseAgendaIntent('Recuérdame en 1 minuto tomar un vaso de agua', { now })
    expect(r.ok && r.item).toBeTruthy()
    expect(r.item!.notify.leadMinutes).toBe(0)
    expect(r.item!.when.at).toBe(now + 60_000)
  })
"""
   ptest.write_text(tt, encoding="utf-8")
    print("parse test ok")

for path in [
    root / "src/shared/version.ts",
    root / "src/renderer/src/shared/version.ts",
]:
    if path.exists():
        path.write_text(re.sub(r"APP_REVISION = '[^']*'", "APP_REVISION = 'cu'", path.read_text()))
print("rev cu")

# verify due has effectiveLeadMs
assert "effectiveLeadMs" in (root / "src/core/agenda/due.ts").read_text()
assert "rel < 10 * 60_000" in pi.read_text()
print("all checks ok")
