# KawaiiGPT Robust

Chat de escritorio (Windows) con personalidad, modelos locales y cloud, imagen (Forge/SD), música (ACE), voz (TTS) y mini-juegos.

**Versión actual:** ver `package.json` (p. ej. 0.9.11).

---

## Antes de pulsar `Abrir.bat` (checklist)

Haz esto **una vez** (o cuando cambies de PC). Si omites pasos, la ventana negra puede cerrarse o la app arrancará a medias.

### 1. Sistema

| Requisito | Detalle |
|-----------|---------|
| Windows | 10 u 11 (64 bits) |
| Espacio | Reserva **≥ 20 GB** libres si vas a usar imagen/música local (mejor en disco **D:** o secundario, no satures C:) |
| RAM | **16 GB** mínimo cómodo; **32 GB** ideal con Forge + chat local |
| GPU (opcional pero recomendada) | NVIDIA con **≥ 8 GB VRAM** para Stable Diffusion / ACE a buen ritmo. Sin GPU: chat cloud + imagen cloud siguen siendo útiles |

### 2. Node.js (obligatorio para desarrollo)

1. Instala **Node.js LTS 20 o 22** (no hace falta la última “Current” si da problemas):  
   https://nodejs.org/
2. Cierra y abre una terminal nueva.
3. Comprueba:

```powershell
node -v
npm -v
```

Debes ver algo como `v20.x` / `v22.x` y un número de npm.  
Si `node` no se reconoce, reinstala Node marcando **“Add to PATH”**.

### 3. Dependencias del proyecto (obligatorio la primera vez)

En la carpeta del proyecto (`kawaii-gpt-robust`):

```powershell
cd "C:\ruta\a\kawaii-gpt-robust"
npm install
```

- La primera vez puede tardar varios minutos (descarga Electron).
- Si aparecen *warnings* de paquetes deprecated, en general **no bloquean** el arranque.
- Si `npm install` falla por red o permisos, reinténtalo; no lances `Abrir.bat` hasta que termine bien.

### 4. Chat local (recomendado)

Sin esto, el chat dependerá solo de APIs cloud (claves en Ajustes).

**Opción A — Ollama (simple)**  
1. https://ollama.com/download  
2. Instala y ábrelo al menos una vez.  
3. Descarga un modelo de chat, por ejemplo:

```powershell
ollama pull qwen2.5:7b
```

(o el que sugiera el asistente de la app según tu RAM/VRAM).

**Opción B — LM Studio**  
1. Instala LM Studio.  
2. Descarga un modelo.  
3. Activa **Server** (API local). La app puede detectarlo.

### 5. Claves cloud (opcional, muy útil)

En la app: **Ajustes → Proveedores**. Puedes configurar las que tengas (no hace falta todas):

- OpenRouter, Groq, Google Gemini, OpenAI, Cloudflare (imagen), etc.

Sin claves y sin Ollama, el chat casi no podrá responder.

### 6. Imagen local (opcional)

- La app puede **instalar Forge** y checkpoints desde **Ajustes → Capas**.
- Python para Forge: la app intenta usar un **venv propio**; si el sistema solo tiene Python 3.14, conviene tener también **Python 3.11** instalado para evitar fallos de `torch`.
- GPU NVIDIA + drivers actualizados ayudan mucho.
- Los checkpoints ocupan varios GB; elige carpeta de datos en disco grande (perfil de máquina / data root).

### 7. Música y voz (opcionales)

- **Música (ACE):** se prepara bajo demanda desde Capas; necesita GPU/VRAM libre (no conviene tener Forge y ACE a tope a la vez).
- **Voz (TTS):** en Ajustes → Voz, instalar/activar motor (p. ej. edge-tts, voz LATAM). La primera síntesis puede tardar.

### 8. Git (solo si desarrollas / subes el repo)

No hace falta para usar el chat. Si usas el panel GitHub de la app, configura SSH y el remoto con el alias correcto de tu máquina.

---

## Cómo arrancar

1. Completa el checklist de arriba.  
2. Doble clic en:

```text
Abrir.bat
```

3. **Deja esa ventana abierta** mientras usas la app (es el launcher de desarrollo).  
4. Si algo falla, lee:

```text
launcher-log.txt
```

en la misma carpeta del proyecto.

### Si la ventana se cierra al instante

1. Abre **PowerShell** en la carpeta del proyecto.  
2. Ejecuta:

```powershell
npm install
npm run dev
```

3. Copia el error completo (sobre todo líneas `ERROR` de Vite/esbuild).  
4. Comprueba de nuevo `node -v` y que no falten archivos tras copiar una actualización (mejor **sustituir la carpeta completa** del proyecto o clonar de nuevo, no mezclar versiones a medias).

### Actualizar código

Al recibir archivos nuevos del desarrollo:

1. Cierra la app y el `Abrir.bat`.  
2. Sustituye/copia los archivos indicados (o clona de nuevo).  
3. Si cambió `package.json`:

```powershell
npm install
```

4. Vuelve a `Abrir.bat`.

---

## Qué hace cada capa (resumen)

| Capa | Para qué | Cuándo se activa |
|------|----------|------------------|
| Chat | Conversación + personalidad | Siempre |
| Imagen | Forge/SD local o cloud | Al pedir imagen |
| Música | ACE-Step | Al pedir canción |
| Voz | Leer respuestas | Botón de altavoz / TTS |
| Juegos | Ajedrez visual, aventura | Cabecera del chat → Ajedrez / Aventura |

Forge y ACE **no** deben ir a full a la vez en GPUs de 8–12 GB: la app intenta alternar capas.

---

## Primeros pasos dentro de la app

1. Completa el **asistente / wizard** si aparece.  
2. **Ajustes → Personalidad:** nombre, avatar, descripción visual.  
3. **Proveedores:** claves que vayas a usar.  
4. **Capas:** arrancar o instalar Forge solo si quieres imagen local; descarga al menos un checkpoint.  
5. **Tester (Ajustes):** genera un informe si algo no cuadra.

---

## Documentación extra

- `docs/CAPAS-Y-CONTROLNET.md` — imagen / ControlNet / VRAM  
- `docs/ACTIVIDADES.md` — mini-juegos  
- `docs/JUEGOS-INTEGRACION.md` — opciones técnicas de juegos  
- `docs/ROADMAP.md` — estado del proyecto  
- `CHANGELOG.md` — cambios por versión  

---

## Desarrollo (resumen)

```powershell
npm install
npm run dev
```

Empaquetado (cuando el proyecto esté estable):

```powershell
npm run package
```

---

## Soporte rápido

| Síntoma | Qué revisar |
|---------|-------------|
| `node` / `npm` no reconocido | PATH de Node; reinstalar LTS |
| `electron-vite` no se reconoce | `npm install` en la raíz del proyecto |
| Build / `Unexpected token` / export missing | Copia incompleta de archivos; vuelve a sincronizar y reinicia |
| Chat sin respuesta | Ollama en marcha + modelo, o claves cloud |
| Imagen “sin checkpoints” | Descargar SD en Capas o copiar `.safetensors` a `models/Stable-diffusion` |
| Forge HTTP 500 en modelos | Normal a veces; la app lista desde disco si hay archivos |

**Importante:** en modo desarrollo, el CSP de Electron puede mostrar un aviso en consola; es esperado hasta empaquetar.
