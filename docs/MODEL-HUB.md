# Model Hub: catálogo, descargas y plan por modelo

El Model Hub permite **buscar y descargar GGUF desde el IDE** (Hugging Face, URL
directa o catálogo curado), registrarlos sin reiniciar y calcular para cada uno
su propio plan de motor: contexto, tipo de KV, visión en GPU/CPU y reserva de
VRAM. No hay dependencias nuevas: usa `fetch`, `crypto` y streams de Node.

## 1. Abrir el Hub

- Botón **Modelos** de la barra superior.
- Menú del chip de modelo → **Catálogo de modelos…**
- Ajustes → perfil de motor → *Catálogo de modelos* (próximamente).

Pestañas:

| Pestaña | Qué hace |
|---|---|
| **Recomendados** | catálogo curado (`config/model-catalog.json`) con tamaño, plan estimado, licencia y visión |
| **Descubrir** | catálogo **online** en vivo: los GGUF con más tracción en Hugging Face ahora; se refresca sin actualizar el IDE |
| **Instalados** | modelos registrados en `models/hub-catalog.json`, con plan, pruebas y borrado |
| **Buscar en Hugging Face** | búsqueda real en la API de HF; al abrir un repo se eligen archivo y proyector |
| **Desde URL** | cualquier `.gguf` HTTPS con SHA-256 opcional |
| **Importar / escanear** | registra GGUF que ya estén en `models/` o copia uno de otra carpeta |

Las descargas muestran progreso, velocidad, ETA y se pueden **cancelar**. Al
terminar se verifica el SHA-256 (si el origen lo publica) y el modelo queda
disponible en el selector sin reiniciar el IDE.

## 2. Catálogo online

La pestaña **Descubrir** consulta en vivo la API pública de Hugging Face con
`filter=gguf&sort=trendingScore`. No hay una lista que envejezca: si mañana
aparece un modelo nuevo con tracción, aparece ahí y se puede abrir para ver sus
cuantizaciones. El botón **Actualizar catálogo online** vuelve a consultar.

Además del catálogo curado y de la búsqueda, esto da tres formas de descubrir:

1. **Recomendados** — lo que ya sabemos que cabe y está probado;
2. **Descubrir** — novedades de Hugging Face, sin descargar nada hasta elegir;
3. **Buscar** — consulta concreta por nombre o familia.

`config/model-catalog.json` sigue siendo la fuente de los recomendados; para
añadir un modelo fijo basta copiar una entrada. La lista online no necesita
mantenimiento.

## 3. Catálogo curado

`config/model-catalog.json` es la lista de modelos recomendados. Cada entrada
tiene:

```json
{
  "clave": "qwen3-4b-2507",
  "nombre": "Qwen3 4B Instruct 2507",
  "repo": "unsloth/Qwen3-4B-Instruct-2507-GGUF",
  "archivo": "Qwen3-4B-Instruct-2507-Q4_K_M.gguf",
  "bytes": 2497281120,
  "revision": "a06e946b…",
  "kvF16BytesPorToken": 147456,
  "ctxNativo": 262144,
  "licencia": "Apache-2.0",
  "pensar": { "compatible": true, "presupuesto": 2048 },
  "muestreo": { "codigo": { "temperature": 0.6, "top_p": 0.95, "top_k": 20 } },
  "vision": { "archivo": "mmproj-…gguf", "bytes": 851251104 }
}
```

`kvF16BytesPorToken` es la suma real de K+V por token en f16. Se puede calcular
con `node scripts/hub.mjs repo <repo>` y el GGUF descargado; el Hub lo recalcula
al registrar el archivo. La revisión fija evita que un cambio en `main` rompa
una descarga reproducible.

Para añadir un modelo: copia una entrada, pon su `repo`/`archivo`/`bytes` y, si
tiene visión, el `mmproj`. No hace falta tocar código.

## 4. Registro local

Los modelos descargados o importados se guardan en:

```
models/hub-catalog.json     # registro local (ignorado por Git)
models/<archivo>.gguf
models/<proyector>.gguf
```

Ese archivo contiene, por modelo: metadatos del GGUF, arquitectura, plan,
muestreo, visión, origen, licencia, fechas y resultados de pruebas. Al importar
`chat/model-hub.mjs`, sus entradas se fusionan en `MODELO.catalogo`, así que el
selector, el lanzador, el cambio en caliente y las pruebas los ven como modelos
normales.

## 5. Plan automático (por qué cada modelo es distinto)

`chat/model-plan.mjs` lee la cabecera del GGUF (sin tensores) y calcula:

- `kvF16BytesPorToken` sumando **K+V por capa** (`head_count_kv`,
  `key_length`, `value_length`) y respetando `full_attention_interval` de los
  modelos híbridos (Qwen3.5/Gated DeltaNet).
- `ctxNativo` desde `<arquitectura>.context_length`.
- El plan con la VRAM libre real:
  1. si f16 y q8_0 llegan al contexto nativo, se queda **f16** (más preciso);
  2. si no, **q8_0** hasta donde llegue (mínimo 16k);
  3. si no, **q4_0** (mínimo 8k);
  4. si ni así, el mayor contexto por encima de 4k.
- Visión: prueba proyector en GPU y en CPU. Si el proyector es grande y el modo
  CPU gana ≥8k de contexto, lo manda a CPU (`--no-mmproj-offload`); si no, GPU.
- Reserva por defecto 850 MiB (contexto CUDA, buffers, grafo) y margen 300 MiB.
  Un modelo ya medido puede sobrescribir `servidor.reservaMiB` y su techo real
  (`vision.contextoMaximoManual`).
- **MoE**: además lee la tabla de tensores (solo nombres/offsets) y separa los
  expertos (`blk.N.ffn_*_exps.weight`) de los pesos densos. La VRAM se llena
  primero con densos + KV y las capas de expertos que caben; el resto queda en
  RAM con `--n-cpu-moe N`. El contexto por defecto de un MoE es 32k y el KV q8_0,
  para que el KV no se coma la VRAM de los expertos. El reparto se recalcula al
  arrancar con la ventana real. Si los expertos de CPU caben en RAM se usa
  `--load-mode none` (medido: 45 vs 28 tok/s frente a mmap); si no, `mmap` para
  que Windows pagine desde el SSD. Si el modelo trae visión, el proyector va a CPU
  cuando así entran más capas de expertos.

El plan se guarda en `models/hub-catalog.json → <clave>.plan` y se usa al pulsar
**Usar ahora** o al elegir **Automático** en la barra del servidor. También se
puede pedir desde la API:

```powershell
curl "http://127.0.0.1:8787/api/hub/plan?clave=qwen3-4b-2507"
```

### Plantillas de chat

Cada GGUF trae su `tokenizer.chat_template`; al registrarlo se guarda en
`models/hub-catalog.json` y el lanzador lo escribe en
`logs/chat_template_<puerto>.jinja` para pasarlo con `--chat-template-file`.
Así el IDE, el Model Lab y el benchmark de calidad hablan con el formato real
del modelo (system/user/assistant, herramientas y razonamiento), no con un
prompt genérico. La auditoría de todos los instalados:

```powershell
node scripts/chat-template-check.mjs
```

Comprueba que la plantilla existe y qué declara. Las pruebas de calidad y de
tool-calling usan `/v1/chat/completions` con mensajes `system` y `user`, de modo
que también validan el renderizado, no solo la presencia.

## 6. API

| Método | Ruta | Uso |
|---|---|---|
| GET | `/api/hub/status` | resumen, VRAM, rutas |
| GET | `/api/hub/catalog` | curado + instalados + trabajos + VRAM |
| GET | `/api/hub/search?q=` | búsqueda en Hugging Face |
| GET | `/api/hub/discover` | catálogo online: GGUF en tendencia (limit/sort) |
| GET | `/api/hub/repo?repo=` | archivos, tamaños, revisión y proyectores |
| GET | `/api/hub/plan?clave=` | plan calculado para un modelo |
| POST | `/api/hub/download` | `{clave}`, `{repo,archivo}` o `{url,nombre,sha256}` |
| GET | `/api/hub/downloads` | trabajos en curso y terminados |
| POST | `/api/hub/downloads` | `{id}` para cancelar |
| POST | `/api/hub/import` | `{scan:true}` o `{ruta}` |
| POST | `/api/hub/delete` | `{clave,confirmar:true}` |

Ejemplos:

```powershell
# catálogo
node scripts/hub.mjs list
node scripts/hub.mjs scan
node scripts/hub.mjs discover --limit 30
node scripts/hub.mjs search "qwen2.5 coder"
node scripts/chat-template-check.mjs
node scripts/moe-bench.mjs --model qwen36-35b-a3b
node scripts/bench-coding.mjs --models gpt-oss-20b,qwen36-35b-a3b --reps 2
node scripts/coding-report.mjs
node scripts/bench-webapp.mjs --models gpt-oss-20b,qwen36-35b-a3b
node scripts/webapp-report.mjs
node scripts/engine-report.mjs
node scripts/fast-download.mjs --models qwen36-35b-a3b
node scripts/hub.mjs repo unsloth/Qwen3-4B-Instruct-2507-GGUF

# descargar una entrada curada (con su proyector si lo tiene)
node scripts/hub.mjs download qwen3-4b-2507

# un archivo concreto de un repo
node scripts/hub.mjs download unsloth/Qwen3-4B-Instruct-2507-GGUF `
  --file Qwen3-4B-Instruct-2507-Q4_K_M.gguf

# URL directa
node scripts/hub.mjs download-url https://…/modelo.gguf --name modelo.gguf

# plan y pruebas
node scripts/hub.mjs plan qwen3-4b-2507
node scripts/model-lab.mjs probe --model qwen3-4b-2507
```

## 7. Descarga reanudable y verificación

- Se escribe en `models/<archivo>.gguf.part`; si se corta, la siguiente descarga
  pide `Range: bytes=<tamaño>-` y continúa.
- Si el servidor ignora el `Range` y devuelve 200, el `.part` se reescribe desde
  cero (nunca se concatenan bytes en orden incorrecto).
- Al terminar se comprueba el tamaño y el SHA-256. Si no coincide, el archivo no
  se publica como modelo: se conserva el `.part` para reintentar.
- HF expone el SHA-256 del blob en `x-linked-etag` **de la redirección**; el Hub
  pide la cabecera con `redirect:"manual"` para no perderlo.
- La revisión se fija al commit (`resolve/<sha>/…`), no a `main`.

## 8. Seguridad

- Solo HTTPS; se rechazan hosts privados (`127.0.0.1`, `10.*`, `192.168.*`,
  `172.16-31.*`, `169.254.*`, `.local`, loopback IPv6) salvo que se active
  `BONSAI_HUB_ALLOW_PRIVATE=1` para pruebas.
- Nombres de archivo saneados: sin rutas, sin `..`, solo `.gguf`. Todo se escribe
  dentro de `models/`.
- No se ejecuta nada del modelo al descargarlo: solo se lee la cabecera GGUF.
- `POST /api/hub/delete` exige `confirmar: true`.
- El catálogo y los pesos son datos locales; el IDE solo sale a Internet para
  buscar/descargar cuando el usuario lo pide.

## 9. Pruebas

```powershell
node chat/model-plan.mjs               # parser, planes, nombres seguros
node chat/prueba-model-hub.mjs         # descarga reanudable + registro + API
node scripts/model-lab.mjs probe --all # arranca cada modelo y mide
node scripts/bench-model-quality.mjs --model qwen3-4b-2507
```

`model-lab` escribe `reports/model-lab-<fecha>/` y actualiza el resumen de
pruebas en el registro. `bench-model-quality` acepta `--model` y usa el plan
AUTO del modelo, no el preset de Ornith.

Evidencia de esta máquina: [reports/MODEL-CATALOG-2026-10-31.md](../reports/MODEL-CATALOG-2026-10-31.md)
(catálogo completo, 30 modelos usables y visión con/sin proyector) y
[reports/MOE-2026-10-31.md](../reports/MOE-2026-10-31.md) (MoE de 30–35B con
reparto VRAM/RAM/SSD).

### Resultados medidos en esta máquina (31-oct-2026)

RTX 4060 Laptop 8 GB, Ryzen 7 7840HS, 16 GB RAM. Una pasada por modelo; las
tareas de calidad son 5 de las 18 del benchmark (código, SQL, JSON anidado,
tool-calling y retrieval). No es una comparación estadística: es una prueba de
que cada modelo arranca, cabe y hace lo que promete.

| Modelo | Plan (contexto/KV) | VRAM pico | Sondas | Calidad 5 tareas | Notas |
|---|---:|---:|---:|---:|---|
| Ornith 1.5 9B | 110.592 / q8_0 | 7.475 MiB | 6/6 | — | visión CPU ~12 s; tool calls nativas |
| Qwen3 4B Instruct 2507 | 57.344 / q8_0 | 7.215 MiB | 5/5 | 4/5 | el mejor equilibrio; razona y tools nativas |
| Qwen2.5 Coder 7B | 32.768 / f16 + draft | 7.065 MiB | 5/5 | 3/5 | tool calls en texto (`function-call`/`xml`/`tools`), ya parseadas; **draft Qwen2.5 0.5B = 1,5× generación** |
| Gemma 3 4B IT | **131.072 / f16** | 5.769 MiB | 5/6 | 3/5 | **ventana deslizante**: el KV real es mucho menor; visión CPU ~28 s; tools débiles |
| Llama 3.2 3B | 83.968 / q8_0 | 7.345 MiB | 5/5 | 2/5 | muy rápido (~100 t/s), tool nativa, flojo en matemáticas |
| DeepSeek R1 Distill 7B | 79.872 / q8_0 | 6.865 MiB | 4/5 | 3/5 | razona antes de contestar; tool calls no, SQL/JSON/retrieval bien |
| K2-Horizon 7B (×2) | 16–18k / q8_0 | ~6.370 MiB | 3/5 | — | respuestas vacías intermitentes; no recomendado para el agente |

### Ampliación 1.8.0 (catálogo completo en el informe)

| Modelo | Plan | VRAM pico | Calidad* | Nota |
|---|---:|---:|---:|---|
| Nemotron 3.5 Bolt E4B | 36.864 / q8_0 · visión CPU | 2.709 MiB | **5/5** | mejor del lote nuevo |
| Qwen3.5 4B | 131.072 / f16 · visión CPU | 7.117 MiB | 4/5 | 131k y visión |
| Qwen3.5 9B | 131.072 / q8_0 · visión CPU | 7.121 MiB | 4/5 | 9B moderno |
| Qwen3-VL 4B | 57.344 / q8_0 · visión CPU | 7.069 MiB | 4/5 | visión de calidad |
| Qwen3-VL 8B | 26.624 / q8_0 · visión CPU | 6.747 MiB | — | 8B de visión |
| Gemma 4 E4B | 22.528 / q8_0 · visión CPU | 3.367 MiB | 4/5 | tool calls nativas |
| Granite 4.0 H Tiny | 131.072 / f16 | 5.597 MiB | 4/5 | 147 tok/s |
| Qwen3.8 4B Distill | 131.072 / f16 | 7.087 MiB | 4/5 | texto moderno |
| MiniCPM-V 4.7 1B | 131.072 / f16 · visión CPU | 2.305 MiB | — | 180+ tok/s |
| LFM3-VL / Omni 2B | 128.000 / f16 · visión CPU | ~2.800 MiB | — | visión rápida |
| Qwen2.5-VL 3B | 128.000 / f16 · visión CPU | 6.543 MiB | — | visión estable |

### MoE 1.9.0 (detalle en el informe MOE)

| Modelo | Plan | Carga | Generación | Calidad* | Nota |
|---|---|---:|---:|---:|---|
| Qwen3.6-35B-A3B | 32.768 / q8_0 · visión CPU · 18/40 GPU | none | 42,5 tok/s | 4/5 | 35B con visión y 6,5 GiB RAM |
| Qwen3-30B-A3B 2507 | 32.768 / q8_0 · 19/48 GPU | none | 44,2 tok/s | 4/5 | el más rápido; coding 5/5 |
| GPT-OSS-20B | 32.768 / q8_0 · 10/24 GPU | none | 32,6 tok/s | **5/5** | razonamiento y tools |
| Nemotron 3 Nano 30B | 32.768 / q8_0 · 15/52 GPU | mmap | 29,9 tok/s | 4/5 | no cabe en RAM; caso SSD |

\* 5 tareas, una pasada. El detalle de VRAM/RAM/SSD y del modo chat está en
[reports/MOE-2026-10-31.md](../reports/MOE-2026-10-31.md).

### Coding real (proyecto + tests ocultos)

Benchmark de proyecto multifichero (`PriorityQueue` + `Scheduler`) y bugfix, con
tests ocultos ejecutados con `node --test`. El modelo no escribe los tests.

| Modelo | Global | Proyecto | Bugfix | Reps |
|---|---:|---:|---:|---:|
| **GPT-OSS 20B** | **100 %** | 18/18 | 10/10 | 2 |
| Qwen3.6 35B-A3B | 96 % | 17/18 | 10/10 | 2 |
| Qwen3 30B-A3B 2507 | 86 % | 14/18 | 10/10 | 2 |
| Qwen3 4B 2507 | 64 % | 4/9 | 5/5 | 1 |
| Qwen3.5 9B | 57 % | 3/9 | 5/5 | 1 |
| Qwen2.5 Coder 7B | 49 % | 2/9 | 5/5 | 1 |
| Ornith 1.5 9B | 35 % | 0/9 | 5/5 | 1 |

**Recomendación:** GPT-OSS-20B para arquitectura desde cero; Qwen3.6-35B-A3B
para bugfix y código guiado (100 % en bugfix y ~39 tok/s); Qwen3-30B-A3B si
manda la velocidad (~42 tok/s). Los densos pequeños sirven para ediciones, no
para diseñar un proyecto entero.

El informe incluye los hallazgos de pipeline (cercas markdown, rutas sin `src/`,
timeout de tests, `max_tokens` y continuación) y los gráficos:
[reports/CODING-2026-10-31.md](../reports/CODING-2026-10-31.md).

En el **bucle real del IDE** (`chat/evaluar/coder.mjs`), GPT-OSS pasó 3/3 tareas.
El perfil opt-in `chat/coder-profile-moe.json` (sin snippets) reduce `cross-file`
de 133,6 s a 43,1 s y `failing-test` de 66,6 s a 28,9 s. Detalle:
[reports/CODER-PIPELINE-2026-10-31.md](../reports/CODER-PIPELINE-2026-10-31.md).

### Web app real (API + UI en navegador)

Taskboard full-stack sin dependencias: API CRUD + stats + persistencia y UI de
tablero. Tests ocultos de API (8) y Playwright/Edge (3).

| Modelo | Global | API | UI | Captura |
|---|---:|---:|---:|---|
| **GPT-OSS 20B** | **100 %** | 8/8 | 3/3 | [ver](../docs/graficos/webapp-gpt-oss-20b.png) |
| Qwen3.6 35B-A3B | 91 % | 7/8 | 3/3 | [ver](../docs/graficos/webapp-qwen36-35b-a3b.png) |
| Qwen3 30B-A3B 2507 | 55 % | 4/8 | 2/3 | [ver](../docs/graficos/webapp-qwen3-30b-a3b-2507.png) |

GPT-OSS es el que mejor sigue el contrato de archivos y API. Qwen3.6 funciona
pero inlinó los estáticos; Qwen3-30B falla PATCH/DELETE por un `slice(13)`.
Informe: [reports/WEBAPP-2026-10-31.md](../reports/WEBAPP-2026-10-31.md).

### GPT-OSS: perfil recomendado

GPT-OSS es el modelo principal para coding/web app de este equipo. El perfil
automático usa **Harmony**, muestreo oficial (`temp 1.0`, `top_p 1.0`,
`top_k 0`, `min_p 0.01`) y `--reasoning-effort high`. El contexto por defecto es
**64k**; el Hub ofrece 32k/64k/96k/128k y recalcula las capas de expertos.

| Contexto | KV | Capas CPU | Generación | RAM |
|---:|---|---:|---:|---:|
| 32k | q8_0 | 14 | 32,5 tok/s | 6,9 GiB |
| **64k** | q8_0 | 16 | **29,2 tok/s** | 7,7 GiB |
| 96k | q8_0 | 18 | 24,1 tok/s | 8,6 GiB |
| 128k | q8_0 | 20 | 22,5 tok/s | 9,4 GiB |
| 128k | q4_0 | 17 | 25,6 tok/s | 8,2 GiB |

El máximo real probado es 128k; 128k+q4 es más rápido pero q4 puede degradar
calidad. `-GpuExtra 3` da +4,7 % a 32k, con riesgo de OOM.
Detalle: [reports/GPTOSS-2026-10-31.md](../reports/GPTOSS-2026-10-31.md).

### Tuning del motor

`reports/ENGINE-2026-10-31.md`: `ngram-simple` acelera la generación cruda
(71,6 tok/s) pero no el chat real (44,5); el draft Qwen3 0.6B no compensa; 3
capas más de expertos en GPU dan +4,7 % (46,4 tok/s) y 4 capas ya producen OOM.
La base sigue siendo `--load-mode none` + 12 hilos + batch 1024/512. El lanzador
acepta `-GpuExtra 3` para meter 3 capas más de expertos en GPU (+4,7 % medido,
con riesgo de OOM).

El catálogo completo, con los 30 modelos y las pruebas con/sin visión, está en
[reports/MODEL-CATALOG-2026-10-31.md](../reports/MODEL-CATALOG-2026-10-31.md).

La lectura honesta: **más contexto no es mejor si el modelo falla**. Gemma cabe a
131k gracias a su atención local, pero su tool-calling no sirve para el agente;
Qwen2.5 Coder rinde mejor con 32k f16 y su formato de tool call hay que
traducirlo; Qwen3 4B es el que mejor combina contexto, herramientas y calidad.
Ornith sigue siendo el modelo principal por su visión y su agente ya ajustado.

### Decodificación especulativa medida (Qwen2.5 Coder + draft)

Con el mismo prompt de código, 256 tokens, temperatura 0 y el mismo contexto de
32.768/f16:

| Configuración | Generación | VRAM pico |
|---|---:|---:|
| Sin draft | 47,2 tok/s | 6.151 MiB |
| Con `qwen2.5-0.5b-instruct-q4_k_m` | **68,8–71,8 tok/s** | 6.945 MiB |

Es **1,46–1,52×** a cambio de 469 MiB de VRAM. El borrador se declara en
`config/model-catalog.json → draft`, el plan lo resta de la VRAM disponible y
el lanzador añade:

```text
--spec-type draft-simple
--spec-draft-model models/qwen2.5-0.5b-instruct-q4_k_m.gguf
--spec-draft-n-max 4
```

El modelo grande sigue verificando todos los tokens: la calidad no cambia, solo
se ahorra tiempo. Es opcional; si el draft no está descargado, el plan y el
arranque funcionan igual sin él.

No todos los borradores sirven: el Qwen3 0.6B tiene 112 KiB de KV por token y,
a 49k de contexto, pide ~4,5 GB solo para su caché; no cabe junto al 4B. Por eso
el draft se declara por modelo y el plan lo descarta si no hay VRAM. El de
Qwen2.5 0.5B (12 KiB/token) sí cabe.

## 10. Limitaciones conocidas

- GGUF partidos (`-00001-of-00002.gguf`) todavía no se agrupan; se puede
  descargar cada parte, pero el registro espera un archivo principal.
- Modelos con arquitecturas que llama.cpp no soporte arrancarán y fallarán; el
  Hub los registra y el Model Lab lo dice con el log.
- El plan es conservador: la reserva de 850 MiB puede quedarse corta en modelos
  con buffers de cómputo grandes. El Model Lab mide el pico y actualiza el
  registro; si un modelo falla al arrancar, baja `servidor.reservaMiB` o el
  contexto y vuelve a probar.
- Los modelos con licencia gated de Hugging Face necesitan un token; el Hub no
  gestiona credenciales todavía. Descarga el archivo manualmente y usa
  **Importar**.
