# Companion smoke (A1-A3) — v0.10.10 rev.ds+

Pruebas manuales cortas. Prioridad: parecer humana (HUMAN-PRIORITY).

## A1 — Memoria viva (asistente)

1. Revisa Ajustes → Memoria → Asistente.
2. Di: Cuéntame algo que te guste a ti.
3. Cuando diga un gusto claro (me gusta… / mi color favorito es…), revisa el panel: likes/favoritos.
4. Nuevo turno: Hola — tono puede mencionar un favorito de pasada, sin inventario.
5. Pregunta: ¿Qué te gusta a ti? — no debe copiar gustos del usuario.

## A2 — Iniciativa

1. Activa iniciativa (minutos bajos si pruebas).
2. Mensaje normal; espera el timer.
3. Tras harness (revisa Ollama), la iniciativa debe reprogramarse (post-harness).
4. Meta sin etiqueta de plantilla como voz del personaje.

## A3 — Tres charlas

| # | Guion | Esperado |
|---|--------|----------|
| 1 | Hola + 5 turnos sin tools | Sin burbujas duplicadas; español mexicano; sin JSON |
| 2 | busca en la web noticias de hoy | Pie web:N o intento real; no inventar si 0 hits |
| 3 | Adjunta docx o pdf y pregunta qué dice | Texto en contexto; responde al contenido |

## Host / JSON

- arranca Ollama / diagnóstico: respuesta humanizada, sin JSON crudo en la burbuja.
- Auto-start Ollama en Windows puede fallar: guía menú Inicio + LM Studio.

## Documentos

- docx: tools/doc_read.py (stdlib zip/xml).
- pdf: pypdf o pdftotext.
- Plugin: plugins/doc-read/plugin.json.
