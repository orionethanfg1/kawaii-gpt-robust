#!/usr/bin/env node
/**
 * E-TC — run project typecheck when TypeScript is installed.
 * Exit 0 with SKIP if tsc is missing (incomplete node_modules in CI/sandbox).
 * Exit 1 on real type errors.
 */
import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const tscJs = path.join(root, "node_modules", "typescript", "lib", "tsc.js")
const tscBin = path.join(root, "node_modules", ".bin", "tsc")

function runProject(cfg) {
  const args = ["--noEmit", "-p", cfg]
  let r
  if (fs.existsSync(tscJs)) {
    r = spawnSync(process.execPath, [tscJs, ...args], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024
    })
  } else if (fs.existsSync(tscBin)) {
    r = spawnSync(tscBin, args, {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
      shell: process.platform === "win32"
    })
  } else {
    return { skip: true }
  }
  return {
    skip: false,
    status: r.status ?? 1,
    out: (r.stdout || "") + (r.stderr || "")
  }
}

const configs = ["tsconfig.web.json", "tsconfig.node.json"]
let anyFail = false
let skipped = false

for (const cfg of configs) {
  if (!fs.existsSync(path.join(root, cfg))) {
    console.error("MISSING", cfg)
    anyFail = true
    continue
  }
  const r = runProject(cfg)
  if (r.skip) {
    skipped = true
    console.log("SKIP typecheck — typescript package not in node_modules (run npm install)")
    break
  }
  if (r.status !== 0) {
    anyFail = true
    console.error("---", cfg, "---")
    const lines = (r.out || "").split(/\r?\n/).filter(Boolean)
    // Cap noise but keep actionable
    for (const line of lines.slice(0, 80)) console.error(line)
    if (lines.length > 80) console.error(`… +${lines.length - 80} more`)
  } else {
    console.log("OK", cfg)
  }
}

if (skipped && !anyFail) {
  console.log("typecheck-gate SKIP (no tsc)")
  process.exit(0)
}
if (anyFail) {
  console.error("typecheck-gate FAILED")
  process.exit(1)
}
console.log("typecheck-gate OK")
