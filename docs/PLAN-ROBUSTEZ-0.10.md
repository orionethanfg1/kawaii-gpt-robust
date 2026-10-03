**Estado:** pasos 1–6 aplicados → **v0.10.0** (2026-10-01).

# Plan de robustez — KawaiiGPT Robust → 0.10 fiable

**Fecha:** 2026-10-01  
**Premisa:** el producto vale la pena; el riesgo es alcance > estabilidad.  
Este plan no añade features decorativas. Ataca fallos que hacen la app poco fiable.

**Reglas no negociables**

1. Cada bloque tiene criterio de hecho medible (pasa / no pasa).
2. Prioridad absoluta: no romper build, no wipe de userData, chat local usable.
3. Paralelo limitado: como máximo 2 carriles activos a la vez (A+B o B+C).
4. Nada nuevo en useChat / main monolítico: plugin o módulo con contrato.
5. Si un bloque no se puede validar en una sesión de prueba, no se da por cerrado.

---

## Diagnóstico: 5 problemas principales

| # | Problema | Evidencia | Impacto |
|---|----------|-----------|---------|
| P1 | Web search no fiable | Pie sin web / 0 hits; modelo niega internet | Feature mentirosa |
| P2 | Integración frágil | Strings rotos, imports, wipe settings | App inutilizable |
| P3 | Identidad visual inestable | Autorretrato distinto del avatar | Promesa de personaje rota |
| P4 | Router / tools por heurística | Failovers, tools espontáneos | Comportamiento impredecible |
| P5 | Monolito + deuda | useChat, orchestrator hinchados | Cada fix genera otro bug |

**Objetivo 0.10 (definición estrecha):** P1 cerrado o degradación honesta; P2 bajo control; P3 es ella o aviso; P4 rutas en pie; P5 base plugin.

Fuera de 0.10: InstantID, marketplace, docx perfecto, empaquetado polished.

---

## Carriles (máximo 2 activos)

- **CARRIL A — Web (P1):** tool host + backends fiables + pie medible + honestidad del modelo
- **CARRIL B — Core estable (P2+P4):** build, datos, router, tools sin falsos, smoke E2E
- **CARRIL C — Identidad + plugins (P3+P5):** registry, migrar web/face, política FaceID, doc plugins

Orden: A+B en paralelo → C cuando A o B tenga bloques verdes.

---

## CARRIL A — Web search de verdad

| ID | Entrega | Criterio de hecho |
|----|---------|-------------------|
| A1 | Tool único web_search → JSON | Invocable harness + orchestrator |
| A2 | Cascada Wiki → SearXNG → DDG/Bing | hits.length >= 1 en query de prueba |
| A3 | Intent explícito siempre ejecuta tool; pie web:N/0/sin | Pedir buscar nunca sin web |
| A4 | Modelo no niega internet si N>0 | Prueba manual con hits |
| A5 | SearXNG local documentado (0.10.x) | README + pie estable |

Si A2 falla siempre (0 hits): no seguir features; solo backend (SearXNG/API) hasta hits > 0.

---

## CARRIL B — Core estable

| ID | Entrega | Criterio de hecho |
|----|---------|-------------------|
| B1 | Freeze regresiones build | 2 arranques sin error esbuild/vite |
| B2 | Datos sagrados + recovery | Prueba recovery documentada |
| B3 | Router con prioridades fijas + pie | 5 prompts → rutas esperadas |
| B4 | Tools solo comandos explícitos | Charla afectiva = cero harness status |
| B5 | Smoke E2E mínimo | abrir → hola → respuesta |

---

## CARRIL C — Identidad + plugins

| ID | Entrega | Criterio de hecho |
|----|---------|-------------------|
| C1 | plugins/ + manifiestos | Plugin dummy en panel sin tocar chat |
| C2 | web + face_score bajo contrato plugin | Sin hardcode eterno |
| C3 | Autorretrato: FaceID o aviso; meta refs/score | 3 pruebas a ojo del usuario |
| C4 | Doc cómo escribir un plugin | 1 página usable por terceros |

---

## Secuencia de pasos

| Paso | A | B | Avanzar si |
|------|---|---|------------|
| 1 | A1+A2 | B1+B3 | hits>=1; build OK; pie ruta OK |
| 2 | A3+A4 | B4 | nunca sin web al pedir busca; sin tools falsos |
| 3 | A5 si hace falta | B2+B5 | recovery + smoke |
| 4 | — | — | Activar C1+C2 |
| 5 | — | — | C3 identidad |
| 6 | — | — | Tag 0.10.0 |

---

## Checklist 0.10.0

- [ ] busca en la web → web:N (N>=1) o web:0 con explicación; nunca sin web si se pidió
- [ ] Con N>=1 el modelo no dice que no tiene internet
- [ ] Chat local hola funciona
- [ ] Charla casual sin harness de estado/plugins
- [ ] Arranque sin error transform/import
- [ ] Recovery no destruye character
- [ ] Autorretrato: FaceID o aviso explícito
- [ ] Registry plugins mínimo existe
- [ ] CHANGELOG 0.10.0 con limitaciones honestas

---

## Anti-plan (no hacer en este ciclo)

- UI estética grande / más cariño
- Catálogo HF completo / más modelos
- Refactor total de useChat de una vez
- Tool-calling LLM completo sin tools host estables
- Prometer biometría o paridad ChatGPT

---

**Fiabilidad primero; potencia después.** Dos carriles, criterios binarios, 0.10 estrecho pero creíble.
