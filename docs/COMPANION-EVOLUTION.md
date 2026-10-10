# Evolución del asistente (companion)

**Prioridad primordial:** [HUMAN-PRIORITY.md](./HUMAN-PRIORITY.md) — parecer humana; no se rompe por ninguna feature.
**Agencia del modelo:** [MODEL-AGENCY.md](./MODEL-AGENCY.md) — aprovechar razonamiento, código y visión; la app es el agente, no el sustituto.

**Objetivo canónico (alineado con el README):** companion de escritorio con identidad propia; la personalidad define la *meta* de relación; memoria dual (usuario ≠ asistente); local-first + harness (autodiagnóstico → autocorrección); calidez sin perder ingeniería.

Documento de **propósito** y estado: por qué existe el personaje, cómo crece la relación y hacia dónde va la inteligencia de la app.

Relacionado: [MEMORY-STACK.md](./MEMORY-STACK.md) · [COMPANION-MEMORY-RELIABILITY-PLAN.md](./COMPANION-MEMORY-RELIABILITY-PLAN.md) · [ENGINEERING.md](./ENGINEERING.md) · [ROADMAP.md](./ROADMAP.md) · [HARNESS.md](./HARNESS.md)

---

## 1. Propósito de ser *companion*

KawaiiGPT Robust no es solo un chat genérico con un modelo local.

El objetivo es un **compañero de escritorio con identidad propia**:

| Dimensión | Qué significa en la práctica |
|-----------|------------------------------|
| **Personalidad** | Rol (p. ej. novia / amiga), estilo, traits y voz coherentes en el tiempo |
| **Presencia** | Misma “persona” en texto, imagen (FaceID/refs) y, cuando hay capas, voz |
| **Calidez** | Trato personal, memoria del usuario y del propio personaje, espontaneidad controlada |
| **Autonomía local** | Preferencia por Ollama / LM Studio / Forge; cloud como apoyo, no como dueño |

La app combina esa calidez con un **harness profesional**: ruteo de modelos, herramientas, plugins y recuperación de datos.

---

## 2. Evolución de relación y confianza

La relación no es un interruptor en ajustes: es un **objetivo vivo** anclado a la personalidad.

### Cómo se conecta

```
Personalidad (rol, estilo, traits)
        ↓
relationshipState (etapa, turnos, apodos aceptados/rechazados)
        ↓
Comportamiento (tono, iniciativa, propuesta de apodos, continuidad)
        ↓
Meta de vínculo (p. ej. “novia”) = dirección, no inventar intimidad al primer “hola”
```

| Concepto | Módulo / dato | Rol |
|----------|---------------|-----|
| Rol deseado | `character.relationshipRole` | Meta de personalidad (hacia dónde tiende el vínculo) |
| Etapa de confianza | `relationshipState.stage` | stranger → known → close → intimate (aprox.) |
| Turnos juntos | `relationshipState.turnsTogether` | Señal de tiempo compartido |
| Apodos | propuesta → aceptación/rechazo | Confianza **escrita** solo con consentimiento |
| Memoria dual | `userMemory` / `assistantMemory` | Él y ella no se mezclan |

### Principios

1. **Proponer no es grabar** — un apodo o un “¿te llamo amor?” solo entra en memoria si el usuario acepta.
2. **Rol ≠ memoria llena** — sin datos del usuario, el rol es *meta* (cómo quiere relacionarse el personaje), no excusa para fingir que ya lo conoce todo.
3. **Individualidad del asistente** — si preguntan *qué le gusta a ella*, no debe copiar los gustos del usuario (`asksAboutAssistantSelf` + prompts selectivos).
4. **Evolución, no reentrenamiento** — hechos, etapas y preferencias en stores locales; el modelo base no se fine-tunea.

---

## 3. Inteligencia: autodiagnóstico y autocorrección

Visión en dos capas:

### Ya orientado / en marcha

| Capacidad | Qué hace | Estado aproximado |
|-----------|----------|-------------------|
| **Autodiagnóstico** | Tools/host: estado Ollama, LM, Forge, FaceID, red, keys | Funcional vía harness / `run_diagnosis` / probes |
| **Mensajes humanos de error** | Traducir fallos técnicos a lenguaje claro + siguiente paso | Parcial (Forge, FaceID, runtime) |
| **Recuperación de datos** | Backups / restore de ajustes y memoria | Base (gate al borrar, recovery) |
| **Circuit breaker / failover** | Local ↔ cloud sin tumbar la UI | Implementado; afinar falsos positivos |

### Posterior (autocorrección)

| Capacidad | Objetivo |
|-----------|----------|
| **Detectar → proponer → ejecutar** | Ante error repetible (Forge apagado, FaceID ausente, modelo no cargado), sugerir acción y, con confirmación o política segura, ejecutar tool (`start_forge`, `ensure_faceid`, pull de modelo) |
| **Aprender de fallos de sesión** | No solo log: recordar “esta ruta falló” y evitar el mismo failover ciego |
| **Autotest en chat** | El asistente valida contratos internos tras cambios (ya hay smoke/verify en CI; falta cerrar el loop “dile esto al chat”) |
| **Plugins como extensiones** | Nuevas capacidades sin engordar `useChat` |

La regla de ingeniería se mantiene: **diagnóstico y corrección viven en módulos/plugins**, no en el monolito del chat.

---

## 4. Etapa actual y qué falta

**Versión de producto:** 0.10.x (revisiones `rev.*` en `src/shared/version.ts`).

### Dónde estamos

| Área | Etapa | Notas |
|------|-------|-------|
| Companion / personalidad | **Base sólida** | Character, rol, estilo, iniciativa |
| Memoria dual usuario/asistente | **M0–M5 hechos** | Onboarding, chips, extract, confianza/apodos |
| Individualidad al hablar de gustos | **Reciente** | No inyectar likes del usuario cuando preguntan *a ti* |
| Relación evolutiva | **Parcial** | Stages + nicknames; aún poca “vida” espontánea estable |
| Autodiagnóstico | **Útil** | Harness y probes; UX a veces ruidosa |
| Autocorrección | **Temprana** | Más “sugerir” que “arreglar solo con criterio” |
| Identidad visual | **Baseline congelada** | FaceID/refs; no priorizar más prompts a ciegas |
| Ingeniería / monolitos | **Avanzada** | Fases de send, postReplyFinalize, orchestration turn |

### Memoria del asistente (carril activo)

Plan de implementación: [COMPANION-MEMORY-RELIABILITY-PLAN.md](./COMPANION-MEMORY-RELIABILITY-PLAN.md).

| Bloque | Estado |
|--------|--------|
| B0 Diagnóstico runtime (respuesta → store → panel → reinicio) | En curso |
| B1 Postproceso sin cortar gustos distintos | Parcial (Copilot + tests) |
| B2 Categorías stable / relational | Hecho (rev.cf) |
| B2b Estados afectivos («hoy me siento…», TTL) | Diferido |
| temporary en likes (omitir) | Hecho; B2b los reutilizará con caducidad |
| B3–B6 Reconciliación, UI, uso selectivo, validación E2E | Pendiente |

### Qué falta (prioridad razonable)

1. **Cerrar el loop companion** — que la memoria del asistente se llene de verdad en uso diario y se note en el tono (sin lists robóticas).
2. **Iniciativa estable** — mensajes propios con calidez, sin plantillas visibles ni desactivarse tras harness.
3. **Autocorrección guiada** — de “Forge en error” a plan corto + tool, sin saturar el chat.
4. **Pruebas de convivencia** — conversaciones largas con 14B: sin repetición de burbuja, sin mezclar gustos, sin perder nombre/rol.
5. **Camino a 1.0** — instalador, E2E smoke del flujo principal, plugins de terceros documentados.

### Qué no es prioritario ahora

- Reabrir FaceID con más tags a ciegas  
- Paridad total con ChatGPT  
- Reentrenamiento del LLM local  

---

## Lectura rápida para contribuidores

- **Companion** = identidad + calidez + local-first.  
- **Relación** = personalidad como *meta* + `relationshipState` + memoria dual.  
- **Inteligencia operativa** = diagnosticar ya; autocorregir después, con tools.  
- **Código nuevo** = módulo o plugin; no crecer el hook del chat.

Última actualización orientativa: documentación alineada a la línea 0.10.10 (evolución companion + memoria).

## Prioridad de producto (ley)

1. **Parecer humana** — ver [HUMAN-PRIORITY.md](./HUMAN-PRIORITY.md). Inquebrantable.
2. Companion (iniciativa, vínculo, memoria dual).
3. Plugins modulares.
4. Identidad de imagen.
5. Agenda y harness como *infraestructura*, no como voz del personaje.

## Avance Companion (rev.cz)

- Iniciativa LLM con `HUMAN_PRIORITY` + `MODEL_AGENCY` y etapa de vínculo.
- `bumpTurns` en cada respuesta completada → stage stranger→…→intimate con uso real.
- Templates solo como respaldo si el modelo local no responde; preferencia modelo con timeout más amplio.


## Companion uso diario (rev.db)

- Límite diario de iniciativa según etapa de vínculo (intimate un poco más).
- Snooze expirado se limpia solo (no queda bloqueada).
- Stage pasa al gate de iniciativa; timeout LLM más generoso.
