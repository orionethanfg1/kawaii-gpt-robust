# KawaiiGPT Robust

**Versión: `0.6.1`**

Chat de escritorio (Windows) híbrido: **Ollama local** + **cloud** (OpenRouter, Groq, Gemini, …), con personalidad, router inteligente, imágenes (Pollinations + **Forge/Stable Diffusion** local), descargas **reanudables** y autodiagnóstico.

Inspirado en [Azrael-Hagen/kawaii-gpt](https://github.com/Azrael-Hagen/kawaii-gpt); reescrito por capas para mayor resiliencia.

---

## Actualizar sin reinstalar

1. Copia encima `package.json` y la carpeta `src/` (y scripts si cambian).
2. Ejecuta `Actualizar.ps1` (limpia solo `out/`, no toca `node_modules` ni AppData).
3. `Abrir.bat` → comprueba que la UI muestre la versión de `package.json` (p. ej. v0.6.1).

Ajustes, API keys y modelos siguen en AppData / rutas de workspace; no se pierden.

## Cómo abrir (Windows)

1. Instala **Node.js LTS** desde [nodejs.org](https://nodejs.org).
2. En la carpeta del proyecto (donde está `package.json`):
   - Doble clic en **`Abrir.bat`** o **`Abrir KawaiiGPT Robust.bat`**.
3. **No cierres** la ventana negra (log en vivo + `launcher-log.txt`).
4. Si falla: `npm install` y vuelve a abrir el `.bat`.

```bash
npm install
npm run dev
# o: Abrir.bat
```

---

## Qué incluye (0.5.x)

| Área | Detalle |
|------|---------|
| **Chat híbrido** | Local / cloud / Smart (failover + rotación free) |
| **Personalidad** | Nombre, avatar, rol, memoria ligera del usuario |
| **Contexto** | Resumen y presupuesto de tokens para no reventar límites |
| **Imágenes** | Cloud (Pollinations) o Local (Forge API + checkpoints SD) |
| **Datos SD** | Preferencia de disco no-sistema (p.ej. `D:\KawaiiSD`), perfil `machine-profile.json` |
| **Descargas** | HTTP Range + `.partial` + recovery (SD, Forge); barra global en vivo |
| **UI Smart / Avanzado** | Smart oculta paneles expertos; Avanzado muestra Forge, memoria de errores, etc. |
| **Red** | Prueba real de hosts (no solo “parece red”) en Autodiagnóstico |
| **Recovery** | Tras corte de luz/red: **Continuar** en la barra de descargas |

---

## Datos locales / Stable Diffusion (Ajustes → Avanzado)

1. **Carpeta de datos** (editable): modelos y Forge fuera de `C:` si puedes.
2. **Estado de modelos**: instalados · en curso · fallidos (sincroniza con disco cada pocos segundos).
3. **Runtime Forge**: `running` + puerto + URL API.
4. Botones clave:
   - **Instalar Forge** → portable ~3.5 GB (pausable)
   - **Arrancar Forge API** → health en `127.0.0.1:7860+`
   - **SD 1.5 prueba** / catálogo en **Generar imagen** → checkpoints
5. Las imágenes generadas van a la carpeta de la app (`…/images`); **Abrir carpeta** en el panel de imagen.

---

## Modo UI

| Smart | Avanzado |
|-------|----------|
| Uso diario, menos ruido | Rotación cloud, timeouts, workspace SD/Forge |
| Tips y defaults seguros | Memoria de errores + recovery detallado |

Cámbialo en **Ajustes** (arriba).

---

## Scripts

| Comando | Uso |
|---------|-----|
| `npm run dev` / `Abrir.bat` | Desarrollo |
| `npm run verify` | Sanity checks del código fuente |
| `npm run test` | Vitest |
| `npm run build` | Build producción |
| `npm run package:portable` | Portable (cuando apruebes una build) |

---

## Arquitectura (resumen)

- **main**: Ollama, secrets, Forge runtime, descargas resumibles, machine profile  
- **preload**: IPC tipado (`window.kawaii`)  
- **renderer**: React + Zustand + capas (chat, models, image, wizard)  
- **ErrorBoundary** por zona para que un módulo no tumbe toda la app  

---

## Limitaciones conocidas

- Pausar Ollama = cancelar pull (la API no pausa por capas como HTTP Range).
- Hugging Face a veces corta (`fetch failed`); la app reintenta mirrors y guarda `.partial`.
- El primer arranque de Forge puede tardar varios minutos (carga de modelos).
- Empaquetado NSIS/portable configurado pero el flujo recomendado sigue siendo el launcher hasta validar 1.0.

---

## Licencia

MIT
