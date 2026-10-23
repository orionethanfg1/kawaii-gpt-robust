# Configuración local (usuarios y beta)

## Requisitos opcionales
- **Ollama** — https://ollama.com (modelos locales tipo chat)
- **LM Studio** — https://lmstudio.ai (GGUF, servidor local puerto 1234)
- **Stable Diffusion / Forge** — solo si usas generación de imagen local

La app funciona en modo cloud/smart sin modelos locales, con menos privacidad offline.

## Primer arranque
1. Instala Ollama o LM Studio si quieres offline.
2. En KawaiiGPT → Modelos: Auto detecta runtimes.
3. Persona: escribe o regenera la descripción visual (se guarda en disco bajo userData/identity).
4. Ajustes → Avanzada → Clima (opcional, Open-Meteo).

## Empaquetado (desarrolladores)
```bash
npm run release:check
npm run package:portable   # o package:nsis
```
Salida en `dist/`.
