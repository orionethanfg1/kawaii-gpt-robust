# Generación de imagen 100 % local

## Principio
La calidad no depende de APIs externas. Forge (A1111/SD) + buen **prompt** + **preset de estilo** + **ficha visual** del personaje.

## Flujo
1. Usuario pide imagen en el chat (o panel).
2. `parseImageIntent` → framing + estilo.
3. `composeImagePrompt` → quality + preset + identidad pesada + negative.
4. `recommendSdParams` → width/height/steps/CFG según estilo.
5. `imageGenerate` vía Forge (`provider: a1111`).

## Encuadre y resolución mínima

- El encuadre se infiere del contenido: retrato/medio cuerpo usa formato vertical, cuerpo entero conserva un lienzo más alto y escenas/paisajes usan formato horizontal. Una indicación explícita del usuario tiene prioridad.
- La salida final tiene un mínimo de 2048 px en el lado largo (2K), conservando la proporción elegida y alineando dimensiones a múltiplos de 8.
- Forge genera primero a una escala de trabajo menor y aplica Hi-Res Fix con un segundo pase para llegar al lienzo final. Los proveedores cloud con límites menores conservan el encuadre al pedir la imagen y se reescalan con la mejor calidad disponible de Electron; ese reescalado garantiza las dimensiones, pero no añade detalle generativo como el segundo pase de Forge.
- El costo de memoria y tiempo aumenta para lienzos 2K, especialmente en formato cuadrado. Los proveedores de nube pueden producir menos detalle fino que Forge aunque su archivo final tenga el mismo tamaño.

## Presets (`STYLE_PRESETS`)
| id | Uso |
|----|-----|
| casual_photo | Por defecto, natural |
| portrait_studio | Headshot / estudio |
| cinematic | Drama / escena |
| anime | Ilustración 2D |
| soft_portrait | Cálido / íntimo |

## Identidad
`settings.character.visualDescription` + avatar/galería. El host **no** deja que el modelo invente otro color de pelo si la ficha dice rojo.

## Próximas mejoras locales
- Batch 2–4 seeds y elegir la mejor
- Upscaler neuronal dedicado configurable

## Checklist de prompt (qué debe llevar)

Orden recomendado (Stable Diffusion / Forge):

1. **Calidad** — masterpiece, best quality, photorealistic…
2. **Identidad (Character DNA)** — 2–4 anclas fijas: pelo, ojos, rostro, accesorio firma (con pesos `:1.3+`)
3. **Framing** — full body / half / portrait
4. **Estilo preset** — casual photo, studio, anime…
5. **Variación de esta toma** — pose, fondo, ropa (solo lo que cambia)
6. **Negative** — two heads, wrong hair color, elf ears, extra limbs…

Reglas de la app:
- «foto tuya» → DNA del personaje + (si hay) IP-Adapter con avatar `data:image`
- «otra persona / no seas tú» → **sin** DNA del personaje
- Comandos operativos (renombrar chat, logs, estado) **nunca** generan imagen

## Offline
Imagen: solo Forge local (`a1111`). Chat: Ollama y/o LM Studio (`:1234`). Cloud se omite si `navigator.onLine === false`.


## Identidad (v0.9.28)

Pipeline local para «foto tuya»:

1. `extractIdentityAnchors(visualDescription)` → pelo, ojos, piel, cara, ropa, accesorio
2. `composeImagePrompt` pone el **DNA al inicio** con pesos `(tag:1.2–1.55)`
3. Negativos bloquean colores/identidad incorrectos
4. Si hay avatar `data:image` → FaceID/IP-Adapter en ControlNet de Forge; el avatar no se usa como imagen inicial de img2img para que no bloquee ropa, pose ni escena.
5. CFG ~7.5–8.5 en autorretratos

Sin ficha visual buena, la identidad se degrada: regenera descripción desde la galería en Ajustes.

## Continuidad entre escenas y vestuario

- Las peticiones de autorretrato con referencia se enrutan a Forge: los proveedores cloud de esta ruta reciben texto y no pueden prometer que conservarán el rostro.
- Las revisiones toman la identidad del mensaje previo (`imageWasSelf`) y vuelven a adjuntar el avatar canónico; las imágenes de galería no reemplazan al rostro principal.
- Una imagen nueva solo hereda esa identidad si el texto es realmente una revisión de imagen. Una petición de otro sujeto (por ejemplo, un dragón) inicia una generación independiente, incluso en la misma conversación.
- FaceID usa el avatar canónico como referencia principal y hasta dos vistas distintas de la galería como unidades IP-Adapter secundarias de menor peso.
- Cambiar ropa conserva la escena previa si no se pide otra. Las peticiones de vestuario sin encuadre explícito usan cuerpo completo; una escena sin encuadre usa toma ambiental para dejar visible el entorno.
- Los sujetos no humanos detectados reciben descriptores propios y negativos que excluyen retratos humanos; las peticiones de retratos humanos externos conservan sexo/rasgos explícitos sin heredar la ficha del personaje.
- FaceID Plus v2 se prefiere sobre IP-Adapter genérico. Las LoRA no se confunden con modelos ControlNet.
- Si Forge no acepta ninguna referencia FaceID/IP-Adapter, una petición de identidad referenciada se detiene con un error accionable en vez de entregar una cara distinta como si el anclaje hubiera funcionado.
- “Primer plano”, “medio cuerpo” y encuadres equivalentes tienen prioridad sobre el encuadre automático de vestuario/escena.
- El historial limita el total de imágenes base64 persistidas en `localStorage`. Las imágenes generadas se vuelven a leer de la carpeta de imágenes por el protocolo local seguro.
