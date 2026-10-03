# SearXNG local (P0.3)

Mejora drásticamente los hits de búsqueda web.

```bash
docker run -d --name searxng -p 8080:8080 searxng/searxng
```

En **Ajustes → Avanzado → Búsqueda web · SearXNG**:
`http://127.0.0.1:8080`

La app también prueba instancias públicas; si todas fallan, pie `web:0 hits`.
