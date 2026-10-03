#!/usr/bin/env node
/** E2 + B1 — static contract checks before release candidates */
import fs from "node:fs"
import path from "node:path"

const root = path.resolve(import.meta.dirname, "..")
let failed = 0

function check(file, fn) {
  const p = path.join(root, file)
  if (!fs.existsSync(p)) {
    console.error("MISSING", file)
    failed++
    return
  }
  const t = fs.readFileSync(p, "utf8")
  fn(t, file)
}

function mustInclude(t, f, needles) {
  for (const n of needles) {
    if (!t.includes(n)) {
      console.error(f, "missing:", n)
      failed++
      return false
    }
  }
  return true
}

check("src/renderer/src/features/chat/hooks/useChat.ts", (t, f) => {
  console.log("ok", f, "present")
})

check("src/main/web-search.ts", (t, f) => {
  if (!mustInclude(t, f, ["export async function searchWeb", "searchWiki"])) return
  console.log("ok", f, "cascade")
})

check("src/core/tools/web-search-intent.ts", (t, f) => {
  if (!mustInclude(t, f, ["wantsWebSearch"])) return
  console.log("ok", f)
})

check("src/renderer/src/features/chat/services/chatOrchestrator.ts", (t, f) => {
  if (!mustInclude(t, f, ["wantsWebSearch", "focusSearchQuery"])) return
  console.log("ok", f, "wired")
})

check("src/core/resources/unload-local.ts", (t, f) => {
  if (!mustInclude(t, f, ["unloadLocalModelsForForge", "keep_alive", "listOllamaLoaded"])) return
  console.log("ok", f, "R2 unload-local")
})

check("src/main/forge-runtime.ts", (t, f) => {
  if (!mustInclude(t, f, ["skipUnload", "unloadLocalModelsForForge", "startForgeRuntime"])) return
  console.log("ok", f, "R2 in startForgeRuntime")
})

check("src/renderer/src/features/chat/services/ensureForgeReady.ts", (t, f) => {
  if (!mustInclude(t, f, ["unloadLocalModels", "minSizeGB", "ensureForgeReady"])) return
  console.log("ok", f, "R2 + ensure")
})

check("src/preload/index.ts", (t, f) => {
  if (!mustInclude(t, f, ["models:unloadLocal", "unloadLocalModels"])) return
  console.log("ok", f, "preload unload IPC")
})

check("src/main/forge-api-resolve.ts", (t, f) => {
  if (!mustInclude(t, f, ["resolveForgeApiForGeneration", "ResolveForgeApiResult", "probeForgeHealth"])) return
  console.log("ok", f, "E1 resolve contract")
})

check("src/main/image-ipc.ts", (t, f) => {
  if (!mustInclude(t, f, ["resolveForgeApiForGeneration", "forge-api-resolve"])) return
  console.log("ok", f, "wired to resolve")
})

check("src/core/image/image-size.ts", (t, f) => {
  console.log("ok", f)
})

check("src/core/image/subject-prompt.ts", (t, f) => {
  if (!mustInclude(t, f, ["describeNonHumanSubject"])) return
  console.log("ok", f)
})


check("src/core/conversation/initiative.ts", (t, f) => {
  if (!mustInclude(t, f, ["waitMinOverride", "minUserIdleMs", "shouldSendInitiative"])) return
  console.log("ok", f, "E-INIT gate")
})

check("src/renderer/src/features/chat/hooks/useConversationInitiative.ts", (t, f) => {
  if (!mustInclude(t, f, ["resolveDelayMs", "conversationInitiativeEnabled"])) return
  console.log("ok", f, "E-INIT hook")
})

check("src/core/agent/humanize-host-reply.ts", (t, f) => {
  if (!mustInclude(t, f, ["stripForgeScare", "humanHealthForge", "forgeFocus"])) return
  console.log("ok", f, "E-HMSG2")
})

check("tools/identity_match.py", (t, f) => {
  if (!mustInclude(t, f, ["cmd_analyze", "cmd_score", "deps_missing"])) return
  console.log("ok", f, "E4 script")
})

check("plugins/identity-match/plugin.json", (t, f) => {
  if (!mustInclude(t, f, ["analyze_identity_refs", "score_identity_match"])) return
  console.log("ok", f, "E4 plugin")
})

if (failed) {
  console.error("verify-step1 FAILED", failed)
  process.exit(1)
}
console.log("verify-step1 OK")
