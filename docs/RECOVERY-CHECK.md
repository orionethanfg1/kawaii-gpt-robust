# Recovery B2

- Character backup + rolling settings backups
- Chat: «recupera ajustes» → `recover_settings`
- Self-check incluye dry-run de recovery
- `npm run smoke:step3`

## Lecturas de documento pendientes

- Estado en `localStorage` clave `kawaii.docReading.v1` (cursor + resumen; el texto vive en adjuntos/disco).
- Al **arrancar** o **antes de actualizar**: si hay progressive a medias o ingesta remember incompleta, el boot lo lista y puede notificar.
- Tras actualizar: el estado **persiste** en el mismo perfil de usuario (Electron `localStorage`); no se borra con el instalador portable si usas el mismo userData.
- Recuperar: abrir el chat del documento → **Continuar lectura** (progressive) o preguntar por un capítulo (remember/seek).
