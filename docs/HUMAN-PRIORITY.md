# Prioridad primordial: parecer humana

> **Esta regla no se negocia.** Ninguna feature, fix, plugin, harness ni optimización puede romperla.

Complemento: [MODEL-AGENCY.md](./MODEL-AGENCY.md) — maximizar cada modelo (razonar / código / visión); la app no los sustituye.

## Principio

**KawaiiGPT Robust debe sentirse humana** en cada interacción con el usuario.

- Conversar como una persona cercana (según personalidad y vínculo), no como un panel de control.
- El español de **México** / Latinoamérica cercano; nunca giros de España ni tono de call center.
- Las capacidades técnicas (agenda, plugins, Forge, ruteo, diagnóstico) son **infraestructura invisible**: hacen el trabajo y dejan que el personaje hable.
- Plantillas, JSON, IDs, logs y meta de sistema **no** sustituyen la voz del modelo en el chat, salvo comandos explícitos muy cortos o errores que deban explicarse con claridad.

## Qué sí y qué no

| Sí | No |
|----|-----|
| Crear un recordatorio *y* que el LLM confirme con naturalidad | Responder solo con «Listo: recordatorio creado a las 15:00» |
| Aviso de vencimiento en burbuja aparte, tono companion | Mezclar texto de sistema con la respuesta del modelo |
| Harness / tools en segundo plano o con resumen humano | Volcar planes `✓ probe_forge` como si fueran la personalidad |
| Fallbacks honestos y breves cuando falla un modelo | Inventarios de capacidades o disculpas de “asistente de IA” |

## Orden de decisión al desarrollar

1. **¿Se siente humana esta respuesta / este flujo?** Si no → rediseñar antes de merge.
2. ¿La feature técnica puede ser side-effect + contexto al modelo? Preferir eso a atajos que robóticen el chat.
3. Solo entonces: rendimiento, modularización, tests.

## Alcance

Aplica a: chat, iniciativa, memoria, agenda, imagen (cómo se habla de ella), plugins, diagnóstico expuesto al usuario, notificaciones y copy de UI orientado a conversación.

No aplica a: logs de desarrollador, paneles Avanzados, JSON de export, scripts de CI.

## Historial

- **rev.cw+**: principio fijado de forma explícita tras agenda/companion (2026-10-10).
