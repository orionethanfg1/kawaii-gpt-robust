# Auditoría KawaiiGPT Robust 0.8.56

## Principios anti-regresión
1. **Capas aisladas**: cambios en música no tocan Forge/imagen; imagen no muta music-state.
2. **Arranques idempotentes**: repair solo si probe falla (numpy/skimage, torchao).
3. **No matar procesos sanos por timeouts cortos** (Forge 90s fue regresión → corregido 0.8.54).
4. **Estado real en UI**: toasts suscritos a eventos runtime (music/forge).
5. **Errores recuperables**: lastError en music-state dispara re-setup.

## Hallazgos
| Área | Problema | Estado |
|------|----------|--------|
| Forge API | Timeout 90s tras "Running on local URL" | Corregido 0.8.54 |
| Forge numpy | ABI skimage | Repair multi-estrategia 0.8.53 |
| Música ACE | torch 2.7.1 + torchao 0.16 | Pin torchao compatible 0.8.56 |
| Badge música | off sin musicLocalOk | Corregido 0.8.51 |
| Intención música | letras vs audio | 0.8.52 |
| UI versión | usuario en build viejo | Launcher limpia out/ |

## Checklist antes de merge
- [ ] `npm run verify`
- [ ] Forge: Detener → Arrancar → Health /sdapi/v1/progress
- [ ] Música: Arrancar → sin code 2 torchao → /health
- [ ] Chat imagen local con checkpoint ya en disco
- [ ] Badge capas refleja settings
