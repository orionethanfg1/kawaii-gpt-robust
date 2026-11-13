# Estado del proyecto

| Campo | Valor |
|-------|--------|
| Versión | **0.12.0-beta** |
| Revisión | **rev.ij** |
| Un residente LLM | **rev.gj + rev.gk** (sin reload por Auto suave) |

Última actualización docs: **rev.ij**.

## Rev.ij — Memoria contextual

- La recuperación de memoria queda acotada al tema de la consulta; los saludos no reciben inventarios ni anclas irrelevantes.
- La revisión LLM del recuerdo del usuario se ejecuta solo ante señales explícitas y usa el runtime local; aplica solo datos fundamentados en el mensaje y descarta resultados si la memoria cambió mientras tanto.
- Los estados emocionales pasajeros permanecen en la memoria temporal con vencimiento, no como hechos biográficos permanentes.
