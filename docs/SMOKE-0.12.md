# Smoke 0.12.0-beta

## P0
- [OK] Arranque sin pantalla blanca
- [OK] Chat local responde y deja de “Generando…”
- [OK] Tras mensaje tipo “quiero descansar un poco” en escena → chip aftercare / no scene_active
- [Warn] Continuar escribiendo si corta (con errores menores)
- [OK] Ajustes: guardar descripción visual y reiniciar → sigue ahí

## P1
- [OK] Biblioteca / adjuntos
- [Warn] Iniciativa no spam (No se activan apropiadamente)
- [ ] Cloud-only sin Ollama (Aquí conviene un boton de switch con 3 opciones |Auto|Solo Local|Solo Cloud|)

## Release
```bash
npm run release:check
npm run package:portable
```
