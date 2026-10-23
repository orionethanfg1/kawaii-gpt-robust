# Memoria contextual (sin romper el colector actual)

## Qué teníamos
- Extractores **deterministas** (regex) sobre un solo mensaje.
- Bien para «Mi color favorito es el verde».
- Fallan cuando el usuario dice «es una de mis favoritas» y el título está en el mensaje **anterior** del asistente.

## Buenas prácticas (industria)
- **Mem0 / AgentCore / papers**: extracción por LLM con JSON estructurado + reglas de qué NO guardar.
- Atribuir bien **quién** dijo el hecho (user vs assistant).
- No volcar todo el historial; preferencias duraderas sí, chit-chat no.
- Híbrido común: reglas rápidas + pasada LLM opcional/asíncrona.

## Enfoque Kawaii (seguro, etapa actual)
1. **Sigue el regex** para frases explícitas (no se toca).
2. **Par de turno** (`extractUserFactsFromTurnPair`): usuario afirma + contexto del asistente previo → favorito/gusto.
3. **Futuro (no implementado aún)**: pasada LLM ligera solo si el par no encontró señal y el turno parece rico en preferencias — con JSON schema, presupuesto de 1–3 hechos, y sin bloquear el chat.

## Por qué no LLM ahora en el camino crítico
- Latencia y costo en cada mensaje.
- Riesgo de alucinar recuerdos (prioridad «parecer humana» + memoria fiable).
- El colector actual ya está estabilizado; el par de turno cubre el caso «película favorita» sin red.
