# Capas de memoria (inyección al modelo)

## Visibles en Ajustes (usuario)

| Capa | Dónde vive | Cómo llega al LLM |
|------|------------|-------------------|
| Nombre / apodos / vínculo | `userMemory` | `buildSelectiveUserMemoryPrompt` → system |
| Gustos / favoritos / metas / personas | `userMemory` | Selectivo según el texto del turno |
| Anclas (facts pinned) | `userMemory.factEntries` | Siempre (pocas) |
| Apariencia del **usuario** | `userMemory.appearanceNotes` | Selectivo + `[APARIENCIA_USUARIO]` en el turno |
| Escenas avatar usadas | `userMemory.avatarScenes` | `[ESCENAS_AVATAR]` en el turno |
| Instrucciones permanentes | `userMemory.standingInstructions` | Bloque aparte en el turno |

## Personaje (asistente)

| Capa | Dónde | Inyección |
|------|-------|-----------|
| Personalidad / estilo / tagline | `settings.character` + disco `identity/character-visual.json` | `buildCharacterSystemPrompt` |
| **Descripción visual** | `character.visualDescription` + **disco** | System del personaje + prompts de imagen (DNA) |
| Cara FaceID | `facePrimaryUrl` / guardarropa | Solo generación de imagen |
| Galería / outfit | `visualGallery` | Imagen (estilo, no cara) |

**Importante:** borrar la descripción en la UI debe marcar `visualCleared` en disco. Si no, al reiniciar `restoreCharacterIdentityIfNeeded` la **vuelve a poner**.

## Ocultas / no listadas como “memoria”

| Capa | Prefijo / sitio | Notas |
|------|-----------------|-------|
| Lectura de documentos | `DOC_READ` / `DOC_INDEX` en facts | Solo si el turno habla del libro |
| Intimidad | `INTIMACY_*` en facts | Prioridad alta, no se podan igual |
| Continuidad de relación | `buildRelationshipContinuityBlock` | System extra |
| Core header (nombres) | `buildCoreMemoryHeader` | System |
| Pronombres | `buildPronounSystemHint` | System |
| Memoria del asistente | `assistantMemory.growthNotes` | Core header |
| Nicknames aceptados | `relationshipState.acceptedNicknames` | Core header |
| Estado de escena | `scenePhase` / intimacy | Chips + system de escena |
| Resumen de chat | heurístico / rolling | Contexto de historial, no “facts” |
| Clima / hora | settings weather + time layer | Solo si el turno lo pide |

## Visión

- **Usuario:** notas de apariencia (texto), no VLM continuo por turno.
- **Personaje:** “Regenerar descripción” (VLM) escribe `visualDescription` y disco; puede **sobrescribir** una ficha manual si no se desactiva.
- **Imagen FaceID:** referencia canónica de foto, no la prosa visual.
