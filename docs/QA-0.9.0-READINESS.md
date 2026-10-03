# QA · 0.9.0 readiness tests

## Goal

The in-app **Tester de sistema** scores progress toward **0.9.0**, not only "services up".

## P0 checks (block 0.9.0 if FAIL)

| ID | Meaning |
|----|---------|
| preload / API files* / musicGenerate | Bridge usable |
| ollama | Local chat path |
| forge | Local image path |
| p0-image-identity-config | Avatar + visualDescription + style flag |
| p0-avatar-reference-flow | Avatar primary + ancla + escenas listos para Forge img2img |
| p0-prompt-compose-identity | Prompts keep character traits |
| p0-checkpoint-pick | Realistic Vision over LoRA |
| music-runtime / music-health | ACE up |
| p0-known-dirs | Folder list for chat buttons |
| p0-character-prompt | Named character system prompt |

## Readiness line

`0.9.0 readiness: N% · BLOQUEADO` if any **P0 FAIL**.

Ship 0.9.0 only when **P0 fail = 0** and image/text dislike trend is acceptable.

## How to run

Ajustes → **Tester** → Ejecutar tests → Copiar Markdown.
Optional: include music generate smoke.
