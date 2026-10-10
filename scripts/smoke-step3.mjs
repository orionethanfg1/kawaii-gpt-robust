#!/usr/bin/env node
/**
 * E-SMOKE+ — static contract checks (no Electron required).
 * Covers E0-E4: R2, forge resolve, initiative, humanize Forge, identity-match.
 */
import fs from "node:fs"
import path from "node:path"

const root = path.resolve(import.meta.dirname, "..")
let failed = 0
const ok = (m) => console.log("OK", m)
const bad = (m) => {
  console.error("FAIL", m)
  failed++
}

function read(rel) {
  const p = path.join(root, rel)
  if (!fs.existsSync(p)) {
    bad("missing " + rel)
    return null
  }
  return fs.readFileSync(p, "utf8")
}

function mustHave(rel, needles, label) {
  const t = read(rel)
  if (t == null) return
  for (const n of needles) {
    if (!t.includes(n)) {
      bad((label || rel) + " missing: " + n)
      return
    }
  }
  ok(label || rel)
}

const files = [
  "src/renderer/src/shared/lib/settings-backup.ts",
  "src/core/tools/web-search-intent.ts",
  "src/main/web-search.ts",
  "src/core/resources/unload-local.ts",
  "src/main/forge-api-resolve.ts",
  "src/renderer/src/features/chat/services/ensureForgeReady.ts",
  "src/core/image/image-size.ts",
  "src/core/image/subject-prompt.ts",
  "src/core/conversation/initiative.ts",
  "src/renderer/src/features/chat/hooks/useConversationInitiative.ts",
  "src/core/agent/humanize-host-reply.ts",
  "docs/SMOKE-0.10.md",
  "docs/RECOVERY-CHECK.md",
  "docs/ENGINEERING.md",
  "plugins/web-search/plugin.json",
  "plugins/identity-match/plugin.json",
  "plugins/face-score/plugin.json",
  "tools/identity_match.py",
  "tools/face_similarity.py"
]
for (const f of files) {
  if (fs.existsSync(path.join(root, f))) ok(f)
  else bad("missing " + f)
}

mustHave(
  "src/renderer/src/features/chat/services/hostTools/executeAppTool.ts",
  [
    "recover_settings",
    "web_search",
    "case \x27health_forge\x27",
    "case \x27start_forge\x27",
    "analyze_identity_refs",
    "score_identity_match",
    "score_face_match",
    "Forge detenido",
    "identity_match.py"
  ],
  "executeAppTool contracts"
)

mustHave(
  "src/main/forge-api-resolve.ts",
  ["export async function resolveForgeApiForGeneration"],
  "resolve export"
)
mustHave("src/core/resources/unload-local.ts", ["keep_alive", "unloadLocalModelsForForge"], "R2 unload")
mustHave(
  "src/renderer/src/features/chat/services/ensureForgeReady.ts",
  ["unloadLocalModels"],
  "ensureForgeReady R2"
)
mustHave("src/main/image-ipc-generate.ts", ["forge-api-resolve"], "image-ipc resolve wire")

mustHave(
  "src/core/conversation/initiative.ts",
  ["waitMinOverride", "minUserIdleMs", "shouldSendInitiative"],
  "initiative gate overrides"
)
mustHave(
  "src/renderer/src/features/chat/hooks/useConversationInitiative.ts",
  [
    "resolveDelayMs",
    "conversationInitiativeMode",
    "looksOllama",
    "[initiative]",
    "settings-initiative"
  ],
  "initiative hook timer"
)

mustHave(
  "src/core/agent/humanize-host-reply.ts",
  [
    "stripForgeScare",
    "humanStartForge",
    "humanHealthForge",
    "forgeFocus",
    "Start Server en LM Studio"
  ],
  "humanize Forge"
)

{
  const t = read("src/renderer/src/features/chat/services/hostTools/executeAppTool.ts")
  if (t) {
    const a = t.indexOf("case \x27health_forge\x27")
    const b = t.indexOf("case \x27scan_local_models\x27")
    const healthBlock = a >= 0 && b > a ? t.slice(a, b) : ""
    if (healthBlock.includes("JSON.stringify(h)")) {
      bad("health_forge still dumps JSON.stringify(h) as ok path")
    } else if (healthBlock.includes("running") || healthBlock.includes("Forge detenido")) {
      ok("health_forge no raw-JSON-ok")
    } else {
      bad("health_forge missing running/stopped logic")
    }
  }
}

mustHave(
  "tools/identity_match.py",
  ["cmd_analyze", "cmd_score", "deps_missing", "identity_match"],
  "identity_match.py modes"
)
mustHave(
  "plugins/identity-match/plugin.json",
  ["analyze_identity_refs", "score_identity_match", "identity-match"],
  "identity-match plugin.json"
)
mustHave(
  "src/core/agent/capabilities-registry.ts",
  ["identity-match", "analyze_identity_refs"],
  "capabilities identity-match"
)
mustHave(
  "src/core/agent/host-command-catalog.ts",
  ["analyze_identity_refs", "score_identity_match"],
  "catalog identity tools"
)

mustHave(
  "src/core/agent/planner.ts",
  ["autodiagnóstico app", "health_forge", "run_diagnosis"],
  "autodiagn host path"
)
mustHave(
  "src/renderer/src/features/chat/services/orchestratorRun.ts",
  ["deliveredChars"],
  "S1 deliveredChars"
)
mustHave(
  "src/core/providers/openai-compatible.ts",
  ["extractMessageContent"],
  "S1 extract content"
)
mustHave(
  "src/core/agent/index.ts",
  ["half", "segundo plano"],
  "strip half leak"
)

// --- M0–M5 memory stack ---
const memFiles = [
  "src/core/conversation/dual-memory.ts",
  "src/core/conversation/assistant-memory.ts",
  "src/core/conversation/memory-backup-gate.ts",
  "src/core/conversation/memory-onboarding.ts",
  "src/core/conversation/relationship-confidence.ts",
  "src/renderer/src/features/chat/components/MemoryChipBar.tsx",
  "src/renderer/src/features/chat/components/OnboardingChips.tsx"
]
for (const f of memFiles) {
  if (fs.existsSync(path.join(root, f))) ok("M-mem " + f)
  else bad("missing " + f)
}
mustHave(
  "src/core/conversation/dual-memory.ts",
  ["migrateToDual", "isUserMemorySparse"],
  "M0 dual-memory"
)
mustHave(
  "src/core/conversation/memory-backup-gate.ts",
  ["snapshotUserMemory", "shouldOfferMemoryRestore", "restoreLatestUserMemory"],
  "M1 backup-gate"
)
mustHave(
  "src/core/conversation/memory-onboarding.ts",
  ["shouldRunOnboarding", "applyOnboardingChip", "buildOnboardingSystemPrompt"],
  "M2 onboarding"
)
mustHave(
  "src/core/conversation/assistant-memory.ts",
  ["extractAssistantSelfFacts", "ingestAssistantReply", "buildAssistantMemoryPrompt"],
  "M3 assistant-memory"
)
mustHave(
  "src/core/conversation/relationship-confidence.ts",
  ["shouldProposeNickname", "acceptNickname", "buildConfidenceSystemPrompt", "bumpTurns"],
  "M4 relationship-confidence"
)
mustHave(
  "src/renderer/src/features/chat/components/MemoryChipBar.tsx",
  ["MemoryChipBar", "MemoryChipItem"],
  "M5 MemoryChipBar"
)
mustHave(
  "src/renderer/src/features/chat/services/chatOrchestrator.ts",
  ["buildAssistantMemoryPrompt", "buildOnboardingSystemPrompt", "buildConfidenceSystemPrompt"],
  "orchestrator memory prompts"
)
mustHave(
  "src/renderer/src/features/chat/hooks/useChat.ts",
  ["ingestAssistantReply", "bumpTurns", "advanceOnboardingAfterExtract"],
  "useChat memory wire"
)

if (failed) {





  console.error("smoke-step3 FAILED", failed)
  process.exit(1)
}
console.log("smoke-step3 OK (E-SMOKE+)")
