# Razonamiento separado de la burbuja (rev.dq)

## Práctica (Ollama / Qwen / OpenAI)

- **Ollama**: `think: true` → `message.thinking` + `message.content` ([docs](https://docs.ollama.com/capabilities/thinking)).
- **LM Studio / OpenAI-compat**: `reasoning_content` o `reasoning` vs `content`.
- **UI**: traza de razonamiento en panel plegable; la burbuja principal solo muestra la respuesta.
- **Historial multi-turno**: solo `content` (el thinking no se reinyecta como si fuera diálogo).

## En KawaiiGPT

1. Proveedores rellenan `ChatResult.thinking` / `ChatChunk.thinking`.
2. `meta.thinking` en el mensaje del asistente.
3. `MessageBubble` → panel «💭 Pensó».
4. Si el runtime mezcla todo en `content`, `splitThinkingFromParts` + `strip-thinking` separan tags/CJK/CoT.

No desactivamos el razonamiento por defecto; solo lo **separamos** de la respuesta visible.
