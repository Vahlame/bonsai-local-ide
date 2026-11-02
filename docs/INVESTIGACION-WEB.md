# Investigación web del agente

El agente ya tiene dos herramientas nativas:

| Tool | Uso |
| --- | --- |
| `buscar` | Busca fuentes en internet y devuelve título, URL y resumen |
| `leer_web` | Lee una fuente HTTP/HTTPS, la pagina y extrae el artículo principal |

Las dos pasan por `chat/investigacion.mjs`. El resultado se marca siempre como
**dato no confiable**: una página puede intentar inyectar instrucciones, pero el
contenido no se ejecuta ni se trata como una orden del usuario.

## Proveedor recomendado: SearXNG

[`searxng/searxng`](https://github.com/searxng/searxng) es el metasearch libre
más conocido para este uso: agrega resultados de decenas de motores, no necesita
clave de API, se ejecuta en la propia máquina y expone un JSON API sencillo.
Es una elección razonable frente a depender de una API comercial o de un
buscador público que puede devolver captchas.

No es una dependencia obligatoria de Bonsai: si no está configurado, se mantiene
el camino anterior DuckDuckGo HTML → Bing RSS.

### Puesta en marcha segura

1. Ejecuta SearXNG en local, escuchando solo en loopback.
2. Activa el formato JSON en `settings.yml`:

```yaml
search:
  formats:
    - html
    - json
```

3. Arranca Bonsai con la URL de esa instancia:

```powershell
$env:BONSAI_SEARXNG_URL = "http://127.0.0.1:8888/"
node chat/ui-server.mjs
```

No hay que editar código ni instalar paquetes de Node. La variable también se
puede pasar desde el lanzador de PowerShell.

### Qué hace Bonsai con SearXNG

`buscarWeb()` intenta primero la instancia configurada:

```text
GET {BONSAI_SEARXNG_URL}/search?q=...&format=json&language=es&safesearch=1
```

- Si devuelve resultados HTTP válidos, se usan.
- Si falla, no responde o no trae resultados, continúa con DuckDuckGo y Bing RSS.
- La URL configurada es de confianza local: solo para ella se permite el acceso a
  loopback/red privada. Las URLs que devuelve el buscador siguen pasando por las
  mismas comprobaciones anti-SSRF y de puertos protegidos.
- Los metadatos de nube (`169.254.169.254`, `fd00:ec2::254`,
  `metadata.google.internal`) se bloquean siempre, incluso en el camino de
  confianza de SearXNG. También se bloquean loopback e IPv6 privadas cuando el
  acceso privado no está permitido.
- Los resultados se recortan y se deduplican; el modelo debe leer la fuente con
  `leer_web` antes de citar o aplicar un detalle técnico.

## Seguridad

- No expongas SearXNG a Internet. Bíndalo a `127.0.0.1` o a una interfaz de
  confianza y protégelo con el cortafuegos.
- No pongas credenciales en la URL de SearXNG; el cliente rechaza URLs con
  usuario/contraseña.
- El contenido de las fuentes es hostil por defecto: se marca como no confiable y
  nunca se ejecuta.
- La búsqueda no sustituye la lectura de la fuente ni la verificación local.

## Prueba

```powershell
node chat/prueba-investigacion.mjs
node scripts/run-tests.mjs
```
