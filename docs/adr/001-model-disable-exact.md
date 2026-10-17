# ADR 001 — Disable de modelos exacto + mapeo disco→API

**Estado:** aceptado  
**Fecha:** 2026-10-15  
**Rev:** 0.11.1-beta Fase 1

## Contexto

El catálogo mezcla ids **live** (Ollama / LM Studio OpenAI-compatible) y **disco** (`lmstudio-disk`), p. ej.:

- `mlabonne_qwen3-14b-abliterated` (API)
- `mlabonne_Qwen3-14B-abliterated-Q6_K_L` (archivo GGUF)

Un matching **fuzzy** (“si el id contiene abliterated…”) hacía que desmarcar una fila deshabilitara la otra.

## Decisión

1. **`disabledLocalModels` solo compara id exacto** (case-insensitive).  
   Implementación: `isLocalModelDisabled` en `disabled-local-models.ts`.

2. **Dedup de catálogo** usa `modelFingerprint` (quita cuantización/publisher **antes** de separadores) para no mostrar dos filas del mismo peso.

3. **Intimacy / Auto**: si el ganador es disco, `preferLiveAbliteratedId` lo mapea al id API hermano cuando existe, para poder hacer `POST /api/v1/models/load` y chat/completions.

## Consecuencias

- El usuario puede deshabilitar un id sin tumbar variantes con otro nombre exacto.  
- Hace falta refrescar el catálogo tras instalar/desinstalar en LMS.  
- Tests P0: `phase0-disable-exact-not-fuzzy`, `phase0-merge-single-abliterated`.
