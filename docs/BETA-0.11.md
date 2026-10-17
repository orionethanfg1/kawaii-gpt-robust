# Beta 0.11.1 — instalador y primer uso

Qué incluye la beta

- Chat local (Ollama / LM Studio) y **cloud** (OpenRouter, Groq, Gemini, OpenAI…).
- Lectura progresiva de documentos, biblioteca (Mis archivos / Contexto app).
- Imagen (Forge) y música (ACE) **opcionales**, bajo demanda.
- Asistente de primer arranque con enlaces de descarga y comprobación de requisitos.

## Requisitos según modo

| Modo | Qué necesitas |
|------|----------------|
| **Solo cloud** | Internet + API key gratis (OpenRouter o Groq recomendados). **No** hace falta GPU ni Ollama. |
| **Solo local** | [Ollama](https://ollama.com/download) **o** [LM Studio](https://lmstudio.ai/) + un modelo descargado. |
| **Smart** | Ideal: local + cloud. Si falta local, usa cloud automáticamente. |

### Ollama (principiantes)

1. Descarga el instalador en https://ollama.com/download  
2. Instálalo y **ábrelo** una vez (debe quedar el icono en la bandeja del sistema).  
3. En KawaiiGPT → asistente o Ajustes → «Iniciar Ollama» / comprobar.  
4. Descarga un modelo sugerido (p. ej. 7B–14B según tu RAM).

### LM Studio

1. https://lmstudio.ai/  
2. Descarga un modelo → **Developer → Start Server**.  
3. KawaiiGPT detecta el puerto solo.

## Cómo generar binarios (desarrollador)

```bash
npm run release:check
npm run package:nsis      # instalador
npm run package:portable  # un solo .exe
```

Artefactos en `dist/`:

- `KawaiiGPT-Robust-<ver>-setup-x64.exe` — instalador con acceso directo  
- `KawaiiGPT-Robust-<ver>-portable-x64.exe` — sin instalar  

**Nota:** el paquete **no** incluye modelos ni Forge. SmartScreen puede avisar si el `.exe` no está firmado (normal en beta sin certificado).

## Checklist antes de subir la beta

1. `npm run release:check` verde  
2. Smoke manual (`docs/SMOKE-0.11.md`)  
3. Probar el setup.exe en un Windows limpio: wizard → Solo cloud **y** flujo local  
4. Confirmar que sin Ollama, modo cloud chatea  
5. CHANGELOG + tag `v0.11.1-beta`

## Usuarios sin modelo local

No quedan fuera: el wizard ofrece **Solo cloud** con texto claro, omite el paso local y solo pide la key. En Ajustes se puede pasar a Smart/local cuando instalen Ollama después.
