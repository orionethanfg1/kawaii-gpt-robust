# Agencia del modelo (no de la app sola)

> Complementa [HUMAN-PRIORITY.md](./HUMAN-PRIORITY.md): **parecer humana** en la voz; **aprovechar el modelo** en la inteligencia.

## Principio

La app es un **agente** entre el usuario y los modelos (locales y cloud). No debe resolver por plantillas lo que un modelo de razonamiento, código o visión puede hacer mejor.

| Capacidad del modelo | Qué debe hacer la app | Qué no debe hacer |
|----------------------|------------------------|-------------------|
| **Razonar** | Dar contexto, memoria selectiva, tiempo | Cerrar siempre con scripts fijos |
| **Código** | Tools de archivos, harness, sandbox | Inventar diffs sin pasar por el modelo |
| **Visión** | Adjuntar imagen + pedir análisis al modelo vision | Solo etiquetar “hay una imagen” sin verla |
| **Herramientas** | Catálogo claro, permisos, resultados legibles | Simular éxito de tools en texto plantilla |

## Relación con “parecer humana”

No chocan:

1. El **modelo** piensa, ve, escribe código y responde en personaje.
2. La **app** enruta, carga el modelo apto, inyecta memoria/tools y oculta la fontanería.
3. El usuario percibe a una persona capaz, no a un formulario ni a un dump de logs.

## Orden de decisión

1. ¿Se siente humana la interacción? ([HUMAN-PRIORITY](./HUMAN-PRIORITY.md))
2. ¿Estamos usando el modelo adecuado y todo su potencial para esta tarea?
3. Solo entonces: atajos de app (agenda create side-effect, listo, etc.) cuando aporten sin robóticar.

## Historial

- **rev.cy**: principio fijado (2026-10-10).
