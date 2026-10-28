# 02 · Viabilidad real de GPU: ¿cabe, a qué velocidad y se puede codear?

**Tarea:** task-2 · **Responsable:** operador-gpu · **Fecha de la prueba:** 27–28 oct 2026, ~23:19–23:35 (hora local, America/Costa_Rica)
**Máquina:** DESKTOP-SCTPQ4D · Windows 11 (host reporta NT 10.0.19044) · Node v26.0.0 · Python 3.14.7
**Hardware:** NVIDIA GeForce RTX 4060 Laptop GPU (8.188 MiB, driver 617.14, CUDA UMD 13.4) · Ryzen 7 7840HS (8C/16T) · 16 GB RAM
**Modelo activo:** `models/Ornith-1.5-9B-Q4_K_M.gguf` (5.780.090.816 bytes, arquitectura qwen35, 34 capas) + `models/mmproj-Ornith-1.5-9B-BF16.gguf`
**Binario:** `bin/llama-server.exe` — llama.cpp `0.2.0-dev build 10743 (adfffbe41)`, MSVC 19.44, backend CUDA.

> Todas las cifras de esta página son medidas en esta máquina, no estimaciones. Los datos brutos de benchmark y
> logs completos quedaron en `%TEMP%\bonsai-gpu-medidas\` (no se añaden al repositorio). El código del proyecto
> no se modificó y no se hizo commit.

---

## 1. Veredicto (respuesta directa a la pregunta del usuario)

**Sí: en este PC se puede programar con IA local usando la GPU. No es el escenario "definitivamente no puede".**

| Pregunta | Respuesta medida |
|---|---|
| ¿Cabe entero en 8 GB? | **Sí.** 34/34 capas y el proyector de visión en CUDA0, `graph splits = 1` (ningún tensor ni capa en CPU). Ocupa **7.339 MiB de 8.188** (89,6 %); quedan **618 MiB libres** (7,5 %). |
| ¿A qué velocidad genera? | **≈ 41 tok/s estables** (40,5–41,5) en todas las pruebas, incluidas 500 tokens seguidos y visión. Un turno de chat simple responde en ~1,5 s. |
| ¿A qué velocidad procesa contexto? | Prompt processing **≈ 1.700 tok/s** en prompts grandes (3.375 tokens en 1,94 s; 11.823 tokens en 6,90 s). Prompts de 300–560 tokens: 1.200–1.400 tok/s en caliente. **TTFT** medido con streaming: **0,13–0,40 s** en prompts cortos. |
| ¿Funciona el flujo real del IDE? | **Sí**: `start-ui.ps1` arranca modelo + interfaz, `http://127.0.0.1:8787` responde 200, `/api/state` y `/api/stats` dan datos, y el chat responde por SSE. Parada limpia verificada (VRAM vuelve a 0 MiB). |
| ¿Funciona un agente de punta a punta? | **Sí: 3/3 tareas correctas en 62 s** (fizzbuzz con tests y autocorrección, página HTML verificada con el navegador real, script SQLite). 980+563+532 = 2.075 tokens generados, 40,8–41 t/s, GPU al 85–94 %. |
| ¿Es usable para codear? | **Sí, con matices**: velocidad de sobra para un agente que lee archivos, escribe y ejecuta; el límite real es el margen de VRAM (618 MiB), que solo deja sitio a este 9B Q4 en el perfil máximo, y el contexto efectivo de la interfaz (16.256 tokens de historial). La calidad del código no se juzga aquí (otros informes). |

**Conclusión en una frase:** la RTX 4060 de 8 GB ejecuta el modelo completo de 9B Q4_K_M + KV q8_0 de 32K + visión
a ~41 tok/s con 618 MiB de margen; se puede trabajar con el IDE y el agente a velocidad perfectamente utilizable,
siempre que no se intente subir de modelo sin bajar contexto/visión.

---

## 2. Configuración exacta probada (perfil recordado)

`logs/perfil-servidor-8080.json` (persistido por el propio script):

```json
{"modelo":"ornith9b","archivo":"Ornith-1.5-9B-Q4_K_M.gguf","puerto":8080,
 "contexto":32768,"kv":"q8_0","vision":true,"libreMiB":7956,"fecha":"2026-10-28T05:21:35Z"}
```

**DryRun ejecutados** (`scripts/start-server.ps1 -DryRun` y `-DryRun -Vision`), con la GPU en reposo
(0 MiB usados, 7.956 MiB libres):

| Configuración | Perfil calculado | Presupuesto conservador | ¿Cabe? |
|---|---|---|---|
| Sin visión (auto) | **32.768 tokens · KV f16** | 7.401 MiB | sí (7.956 libres) |
| Con visión (auto) | **32.768 tokens · KV q8_0** | 7.821 MiB | sí (7.956 libres) |

Comando que genera el DryRun con visión (es el que se usó, verbatim):

```
bin\llama-server.exe -m models\Ornith-1.5-9B-Q4_K_M.gguf
  --gpu-layers all --override-tensor .*=CUDA0 --fit off --no-host --kv-offload
  --load-mode none --flash-attn on -c 32768 -ctk q8_0 -ctv q8_0 -np 1 -b 512 -ub 128 -t 4
  --host 127.0.0.1 --port 8080 --jinja --metrics --cache-ram 0 -lv 4
  --cors-origins http://127.0.0.1:8080,... --temp 0.6 --top-p 0.95 --top-k 20
  --min-p 0 --presence-penalty 0 --repeat-penalty 1 --reasoning off
  --mmproj models\mmproj-Ornith-1.5-9B-BF16.gguf --mmproj-offload --mmproj-device CUDA0
  --image-max-tokens 512
```

---

## 3. Arranque real y evidencia de que TODO está en la GPU

Arrancado directamente con `bin\llama-server.exe` + los argumentos de arriba, log redirigido a archivo y PID
guardado (23:21:44). `/health` respondió 200 a los **~6–8 s**; el log marca `listening` a los **8,08 s** del
arranque del proceso. No hace falta ni un reintento.

Evidencia del log de arranque (líneas literales de `llama-32768-vision.err.log`):

```
device_info:
  - CUDA0   : NVIDIA GeForce RTX 4060 Laptop GPU (8187 MiB, 7106 MiB free)
  - CPU     : AMD Ryzen 7 7840HS w/ Radeon 780M Graphics (15676 MiB, 5260 MiB free)
load_tensors: offloading output layer to GPU
load_tensors: offloading 32 repeating layers to GPU
load_tensors: offloaded 34/34 layers to GPU
load_tensors:        CUDA0 model buffer size =  5357.88 MiB
llama_context: n_ctx = 32768, n_batch = 512, n_ubatch = 128, flash_attn = enabled
llama_kv_cache:      CUDA0 KV buffer size =   544.00 MiB
llama_kv_cache: size = 544.00 MiB (32768 cells, 8 layers, 1/1 seqs), K (q8_0): 272.00 MiB, V (q8_0): 272.00 MiB
llama_memory_recurrent: CUDA0 RS buffer size = 50.25 MiB  (32 layers, estado Gated DeltaNet)
sched_reserve:       CUDA0 compute buffer size =   150.27 MiB   ->  248.10 MiB (tras cargar visión)
sched_reserve: CUDA_Runtime_Device_Allocation... graph splits = 1
clip_ctx: CLIP using CUDA0 backend
load_hparams: model size: 878.99 MiB        (proyector de visión BF16)
srv  llama_server: model loaded
srv  llama_server: listening on http://127.0.0.1:8080
```

- **34/34 capas offloaded a GPU**, `CUDA0 model buffer` de **5.357,88 MiB**, **`graph splits = 1`** ⇒ el grafo
  entero se ejecuta en CUDA0: no hay "offloaded X/Y" con capas sobrantes en CPU, ni fallback silencioso.
- Proyector de visión cargado en **CUDA0** (878,99 MiB de pesos BF16; el CLIP corre en CUDA).
- Pool de hilos de llama.cpp: `n_threads = 4` (solo se usa la CPU para el bucle HTTP/tokenización, no para matmul).

`GET /props` confirma lo que sirve el servidor:

| Campo | Valor real |
|---|---|
| `default_generation_settings.n_ctx` | **32768** |
| `model_ftype` | Q4_K - Medium |
| `modalities` | `{"vision": true, "video": true, "audio": false}` |
| `total_slots` | 1 |
| `chat_template` y muestreo | plantilla Qwen; temp 0.6 / top_p 0.95 / top_k 20 (los del catálogo) |

---

## 4. VRAM real medida (desglose)

`nvidia-smi` antes de cargar: **0 MiB usados / 7.956 MiB libres** (de 8.188; el driver/escritorio ya retiene ~232 MiB).

| Componente (medido en el log de llama.cpp) | MiB |
|---|---:|
| Pesos del modelo en CUDA0 (`CUDA0 model buffer`, 34/34 capas) | 5.357,88 |
| KV cache q8_0 (32.768 celdas, 8 capas de atención completa, K+V) | 544,00 |
| Estado recurrente Gated DeltaNet (`CUDA0 RS buffer`, 32 capas) | 50,25 |
| Compute buffers CUDA0 (con visión y prefill) | 248,10 |
| Proyector de visión BF16 (mmproj) en CUDA0 | 878,99 |
| Contexto CUDA + driver + escritorio (diferencia hasta el total) | ≈ 260 |
| **Total `nvidia-smi` con el servidor cargado en reposo** | **7.339** |
| **Libre restante** | **618** |

- Durante inferencia la VRAM usada sube como mucho a **7.387 MiB** (compute buffers según el prompt) ⇒ **≈ 570–615 MiB libres**.
- El proceso `llama-server.exe` consume además **~712 MiB de RAM** del sistema (de 15,3 GB visibles; quedaban 8,2 GB libres).
- El margen "conservador" del script (7.821 MiB de presupuesto) se queda **135 MiB por encima** de lo que realmente
  usa el servidor (7.339): el cálculo automático es honesto y no arriesga OOM.
- Nota técnica: llama.cpp reportó **7.106 MiB libres** al inicializar CUDA (no 7.956), porque el contexto CUDA consume
  ~850 MiB antes de asignar tensores; por eso el `reservaMiB: 864` del catálogo es necesario y acertado.

---

## 5. Rendimiento real medido (`/v1/chat/completions`, `timings` del servidor)

Metodología: peticiones JSON no-streaming contra `http://127.0.0.1:8080/v1/chat/completions` con `temperature 0.6`,
`top_p 0.95`, `top_k 20` (muestreo de código del catálogo). Se usan los `timings` que devuelve llama-server
(`prompt_per_second`, `predicted_per_second`) y se contrasta con el tiempo de reloj del cliente. Muestreo de GPU con
`nvidia-smi` cada 0,4 s.

### 5.1 Procesamiento de prompt (prefill) — prompts únicos para no falsear con caché

| Prompt (tokens reales) | Prefill medido | tok/s de prompt | Nota |
|---|---:|---:|---|
| 303 | 616,1 ms (1.ª pasada, fría) | 491,8 | primer impacto: arranque de kernels/grafos |
| 303 | 251,3 ms | 1.205,5 | ya en caliente |
| 559 | 781,9 ms (1.ª) / 398,0 ms | 714,9 / **1.404,5** | |
| 3.375 | 1.937,4 ms | **1.742,0** | |
| 11.823 | **6.896,2 ms** | **1.714,4** | petición de ~12K sin incidencias, contexto 32K |
| 518 (visión: 512 tokens de imagen + texto) | 913,5 ms | 567,0 | incluye codificación de imagen en CUDA |

**Asíntota de prefill ≈ 1,7K tok/s** para prompts grandes; en prompts pequeños manda el coste fijo
(por eso 1,2–1,4K tok/s). El prefill de primer token medido en streaming encaja: 303 tok → 0,255 s; 559 tok → 0,404 s.

### 5.2 Generación (decode) — velocidad sostenida y estabilidad

| Prueba | Tokens generados | Tiempo de generación | tok/s | Comprobación con reloj: wall |
|---|---:|---:|---:|---:|
| Respuesta corta tras prompt 321 | 96 | 2.324,9 ms | 40,86 | 2,81 s total |
| Respuesta tras prompt 3.375 | 96 | 2.344,9 ms | 40,51 | 4,29 s total |
| Generación de código | 400 | 9.697,1 ms | **41,15** | 9,83 s |
| Generación de código (repetición) | 400 | 9.698,6 ms | **41,14** | 9,77 s |
| Generación de código de 500 tokens (sostenido) | 500 | 12.133,6 ms | **41,13** | 12,26 s |
| Repeticiones con prompts de 300–560 tok | 96–128 c/u | — | 40,99 / 41,04 / 41,07 / 41,51 / 41,01 / 41,10 | — |
| Generación con prompt de 11.823 tok | 48 | 1.202,6 ms | 39,08 | 8,13 s total |
| Visión (imagen + texto) | 52 | 1.250,8 ms | 40,77 | 2,23 s total |

- **Generación ≈ 41 tok/s, estable** (desviación < 1 % entre repeticiones; 500 tokens seguidos idénticos).
- **TTFT** (streaming, medido en el cliente): **0,133 s** (prompt 90 tok), **0,255 s** (303 tok), **0,404 s** (559 tok).
  Para un prompt de 11,8K, el prefill de 6,9 s es la latencia dominante; el primer token llega a continuación.
- **Visión real**: con una captura de pantalla del IDE (`capturas/12-vision.png`, 150 KB) el modelo respondió en 2,23 s
  describiendo correctamente "la interfaz de una aplicación de IA llamada Bonsai, con explorador de código a la
  izquierda y paneles de edición/chat": prompt de 518 tokens (512 de imagen), 41 tok/s de generación.
- **GPU durante las pruebas**: utilización 74–94 %, reloj 2.400–2.655 MHz, temperatura máxima **66 °C**, sin throttling
  perceptible (velocidad plana de principio a fin). Potencia leída 47–78 W (ver aviso en §8).
- Un turno típico de agente/código de ~500–1.000 tokens generados tarda **12–25 s**; una respuesta corta, ~2–3 s.

### 5.3 Nota sobre la caché de prompts (importante para no leer mal los números)

El servidor arranca con `--cache-ram 0`, pero **reutiliza checkpoints del slot**: si se repite exactamente el mismo
prompt, la segunda petición informa `prompt_n=4, cache_n=317` y su `prompt_per_second` ya no mide prefill real.
Por eso la tabla 5.1 usa prompts únicos (variando la primera frase). En el uso real esa caché es una ventaja enorme:
en la prueba de agente de §7 el servidor reutilizó **28.832 tokens de caché** frente a 9.470 leídos, y eso es lo que
hace viable un bucle de agente con muchos saltos.

---

## 6. Contexto máximo fiable

| Prueba | Resultado |
|---|---|
| Ventana declarada por el catálogo | 32.768 tokens (techo; el modelo soporta 262.144 nativos pero no caben en VRAM) |
| **32.768 + KV q8_0 + visión (perfil recordado)** | **Arranca, sirve `/props` con `n_ctx=32768` y responde**: contexto máximo real y fiable en este equipo. |
| Petición de ~12K tokens con ese contexto | **OK**: 11.823 tokens procesados en 6,90 s, sin errores de memoria ni reinicios. VRAM máxima 7.387 MiB. |
| VRAM que deja libre | **618 MiB en reposo**, ≈570–615 MiB durante inferencia. |
| Alternativa sin visión | El perfil automático sin visión calculado por el script es **32.768 · KV f16 (presupuesto 7.401 MiB)**; no se cargó porque el perfil con visión ya cubre la prueba, pero el propio script lo valida como opción. |
| 32.768 + visión + KV f16 | **No cabe por cálculo del script** (7.401 + 900 de visión = 8.301 > 7.956 libres); el arranque se negaría en vez de usar CPU. Con visión el perfil auto elige q8_0, que es justo el que se probó. |

La interfaz reparte la ventana así (`/api/state` real): **ventana 32.768 · solicitado 32.768 · historial efectivo
16.256 · reserva de salida 16.512**. Es decir, el usuario tiene 16K de contexto útil de conversación/archivos aunque
el servidor tenga 32K: suficiente para código normal, pero es un límite de producto a tener en cuenta.

---

## 7. Flujo real de usuario (`scripts/start-ui.ps1`) — validado

Ejecutado tal cual (en segundo plano, sin tocar nada más):

1. `start-ui.ps1` → DryRun: *"Perfil recordado para el puerto 8080: contexto 32768 | KV q8_0; VRAM libre 7956 MiB;
   presupuesto conservador 7821 MiB; Vision GPU: True"*.
2. Arranca llama-server administrado (**PID 18372**) y escribe su marcador `logs/servidor-administrado-8080.json`.
3. Interfaz Node en **`http://127.0.0.1:8787` (PID 22060)**. Lista para usar a los **~10 s** del lanzamiento.

Comprobaciones reales:

| Comprobación | Resultado |
|---|---|
| `GET /` | **HTTP 200**, 28.356 bytes, título `Bonsai`, 0,02 s |
| `GET /api/state` | **HTTP 200**: `nCtx 32768`, `historyCap 16256`, presupuesto `{ventana:32768, solicitado:32768, efectivo:16256, reservaSalida:16512}`, historial con 197 turnos |
| `GET /api/stats` | **HTTP 200**: modelo Ornith Q4_K_M, `vision:true`, `workspace:9`, servidor con 13 s encendido |
| `POST /api/workspace` (carpeta temporal) | **HTTP 200**, workspace aceptado |
| `POST /api/chat` ("Responde únicamente: hola") | **HTTP 200**: respuesta `hola` en **1,52 s**, eventos SSE `start → token … → replace → speed → done` (`motivo: completed`, 1 salto, `incompleto:false`) |
| Parada | `scripts/stop-managed-server.ps1 -Port 8080` → exit 0, marcador borrado; servidor y UI cerrados |
| VRAM tras parar | **0 MiB usados / 7.956 MiB libres** (verificado también con `tasklist`: sin `llama-server.exe`) |

Detalles y avisos:

- `start-ui.ps1` abre el navegador del sistema (`--open`): se abrió **Brave** y consumía 84 MiB de VRAM; se cerró
  manualmente y la VRAM volvió a 0. Es comportamiento esperado del flujo, no un fallo.
- **No hay script documentado para detener la UI** (`stop-managed-server.ps1` solo cierra `llama-server`); el
  proceso `node ui-server.mjs --port 8787` lo cerré por PID al ser mío. Pequeño hueco de ergonomía del producto.
- La prueba de chat se hizo sobre el estado real de la UI del usuario: añadió 2 turnos y cambió la carpeta de trabajo
  temporalmente. **Se restauraron ambos desde copia de seguridad** al terminar (`chat/ui-session.json`,
  `chat/ui-chats/…json`, `chat/ui-workspace.json`, todos archivos de estado ignorados por git): el usuario encontrará
  su conversación y su carpeta como estaban.

---

## 8. Prueba de agente de punta a punta (la más importante)

Comando real (evaluador del propio proyecto; crea copia aislada de la app y workspaces temporales):

```bash
node chat/evaluar/ejecutar.mjs --tareas fizzbuzz,html-contador,sqlite \
  --max-min 4 --llama-port 8080 --ui-port 8791 \
  --salida reports/viabilidad-2026-10-27/eval-agente
```

### 8.1 Resultados

| Tarea | Nivel | Resultado | Tiempo | Saltos | Acciones | tok/s | GPU media | Artefacto |
|---|---|---|---:|---:|---:|---:|---:|---|
| `fizzbuzz` | fácil | **OK** | 26,7 s | 5 | 5 | 40,8 | 94 % | `ws/fizzbuzz/fizzbuzz.py` + `test_fizzbuzz.py` |
| `html-contador` | fácil | **OK** | 21,6 s | 6 | 5 | 40,8 | 85 % | `ws/html-contador/contador.html` |
| `sqlite` | medio | **OK** | 13,5 s | 3 | 2 | 41,0 | 94 % | `ws/sqlite/inventario.py` + `inventario.db` |

**3/3 correctas en 1 min 2 s** · **2.075 tokens generados** · 9.470 leídos + **28.832 de caché** · razonamiento
apagado · VRAM máxima durante la evaluación **7.387 MiB** · 0 errores de servidor.

### 8.2 Calidad del artefacto generado (archivos abiertos y validados)

- **fizzbuzz** — función correcta (`i % 15 == 0 → "FizzBuzz"` antes de 3/5; devuelve lista de 1..n), docstring,
  y 7 tests `unittest`. Los validadores del evaluador ejecutaron la función y los tests con Python real: **pasan**.
  Detalle interesante de agente: el primer `python -m unittest` **salió con código 1**, el modelo leyó el fallo,
  reescribió el archivo de tests y a la segunda ejecución salió 0. Se autocorrigió dentro de la tarea (5 saltos).
- **html-contador** — un único archivo, sin librerías: botón "Sumar", contador a 0, `addEventListener` que incrementa
  y actualiza `textContent`. Además el agente **lo verificó abriéndolo en el navegador headless y haciendo clic dos
  veces** (4 acciones de navegador: abrir, clic, clic, cerrar): no solo escribió el HTML, comprobó que funciona.
- **sqlite** — `inventario.py` crea `inventario.db` con tabla `productos(id, nombre, stock)`, inserta tornillo 120,
  tuerca 3, arandela 40, clavo 2 y muestra los de stock < 5. El validador consultó la base de datos real con
  `sqlite3` y comprobó los datos y la salida del comando: **correcto**.
- Referencia: `reports/viabilidad-2026-10-27/eval-agente/informe.md` e `informe.json` (generados por el evaluador).

**Lectura de usabilidad:** un agente que escribe, ejecuta, ve el error, corrige y verifica en navegador completa
tareas reales de 13–27 s cada una con el modelo entero en la GPU. A 41 tok/s, 400 tokens de código son ~10 s: es
velocidad de trabajo usable (no "de juguete"), aunque obviamente por debajo de un modelo en la nube.

> Honestidad sobre el alcance: estas 3 tareas son 2 fáciles y 1 media. Tareas más duras del catálogo
> (`lru-cache`, `paquete`, `tres-pasos`) no se ejecutaron aquí; la calidad/capacidad del modelo la evalúan los otros
> informes de este equipo. Este informe mide **hardware y flujo**, no la inteligencia del modelo.

---

## 9. Límite: modelo más grande y margen real

- **Margen actual: 618 MiB** (7.339 usados de 8.188; el driver ya retiene ~232 MiB que nvidia-smi nunca da como libres).
- El buffer de pesos del modelo es de 5.357,88 MiB. Para seguir cabiendo sin tocar contexto/visión, un GGUF más
  grande tendría que producir un buffer de hasta ~5.976 MiB, es decir **un archivo de ~6,4 GB como máximo**
  (el buffer CUDA es ~0,97× el tamaño del archivo). El actual es de 5,78 GB: el margen de "modelo más grande" es de
  **~+0,6 GB de pesos, un 11 %**, y sin contar modelos con buffers de cómputo distintos.
- Alternativas para meter algo más grande (a costa de otra cosa):
  - quitar visión: libera ~879 MiB del proyector + ~100 MiB de compute ⇒ ~1.0 GB más de pesos;
  - KV q4_0 en vez de q8_0: libera 272 MiB a 32K;
  - bajar a 16K de contexto: libera 272 MiB (q8_0);
  - combinando, se podría aspirar a un GGUF de ~7,4–7,5 GB (p. ej. un 12B Q4_K_M justo), pero con 16K de contexto
    y sin visión.
- Un 13B/14B Q4_K_M (~7,5–8+ GB) **no cabe** en esta GPU con el perfil del IDE. Los GGUF históricos de 27B
  (Ternary-Bonsai PTQ1_0, 5,9 GB) están en `models/` pero el catálogo los marca como **"historico (CPU)" con
  `servidor: null`**: `start-server.ps1` los rechaza ("no tiene un perfil verificado de GPU completa"). No son una
  opción por la vía soportada.
- Comportamiento cuando no cabe: **el arranque se niega con un error explícito** en vez de tirar de CPU
  (`"No cabe todo en GPU: hacen falta ~N MiB y hay M MiB libres. No se usa CPU como respaldo."`). Es una decisión de
  diseño correcta para la velocidad, pero implica: si otro programa (juego, vídeo, navegador con aceleración) ocupa
  VRAM, el IDE no arranca; hay que cerrar apps que usen GPU. Durante esta prueba, Brave abierto consumía 84 MiB.

---

## 10. Errores, avisos y limitaciones encontrados (sin maquillar)

1. **Sensor de potencia de nvidia-smi inconsistente en este portátil**: en reposo llegó a reportar `590,01 W` con tope
   declarado de 80 W (imposible), luego 1,5–4 W en reposo y 47–78 W en carga. No se usa como evidencia; temperatura
   (40→66 °C) y frecuencia (2.400–2.655 MHz) sí fueron coherentes y estables. Ya estaba documentado en el README.
2. **Sin errores CUDA/OOM en toda la sesión**: ningún arranque fallido, ninguna petición perdida, ningún tensor en CPU.
   Los 34/34 capas y `graph splits = 1` se confirmaron en el log y se repitieron en dos arranques (manual y vía UI).
3. **Prefill frío vs caliente**: la primera petición tras cargar el modelo mide 490–715 tok/s; en caliente 1.200–1.400.
   No es inestabilidad, es coste de arranque de kernels; conviene saberlo para no leer un primer benchmark como si
   fuera la velocidad sostenida.
4. **La caché de checkpoints del slot invalida benchmarks repetidos con el mismo prompt** (ver §5.3); documentado y
   evitado en las mediciones de prefill.
5. **No hay mecanismo documentado de parada de la interfaz**: `stop-managed-server.ps1` solo cubre `llama-server`.
   Cerré el `node ui-server.mjs` por PID (proceso propio). Recomendación para el producto: script `stop-ui.ps1`.
6. **`start-ui.ps1 --open` deja un navegador abierto** (Brave en esta prueba) consumiendo ~84 MiB de VRAM y RAM.
   Cerrado manualmente; en un uso normal simplemente es una pestaña más.
7. **Estado de la UI restaurado**: la prueba de chat real escribió 2 turnos y la carpeta de trabajo en los archivos de
   estado del usuario; se revirtieron con copia previa (archivos `.json` ignorados por git). No se tocó código.
8. **Alcance**: solo se probó el modelo soportado (Ornith 9B Q4_K_M); no se probaron cargas de >30 min ni otros
   modelos, ni la calidad comparativa del KV q8_0 (hay otro informe del equipo para eso).

---

## 11. Reproducción (comandos usados)

```powershell
# 1) Perfil y comando sin lanzar nada (GPU en reposo)
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\start-server.ps1 -DryRun
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\start-server.ps1 -DryRun -Vision

# 2) Arranque controlado con el comando del DryRun (log + PID), salud y props
#    (se lanzó bin\llama-server.exe con los argumentos de la sección 2, salida a %TEMP%\bonsai-gpu-medidas\*.log)
curl http://127.0.0.1:8080/health
curl http://127.0.0.1:8080/props
nvidia-smi --query-gpu=memory.used,memory.free,temperature.gpu,utilization.gpu --format=csv

# 3) Benchmarks reales (Python stdlib, llamadas reales al servidor)
#    POST http://127.0.0.1:8080/v1/chat/completions  {"stream":false, "max_tokens":N, ...}
#    -> timings.prompt_per_second / timings.predicted_per_second / timings.prompt_ms
#    (script y JSON crudos en %TEMP%\bonsai-gpu-medidas\bench*.json)

# 4) Flujo de usuario real
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\start-ui.ps1
curl http://127.0.0.1:8787/            # 200, titulo Bonsai
curl http://127.0.0.1:8787/api/state
curl -X POST http://127.0.0.1:8787/api/chat -H "Content-Type: application/json" -d '{"text":"..."}'
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\stop-managed-server.ps1 -Port 8080

# 5) Agente de punta a punta
node chat\evaluar\ejecutar.mjs --tareas fizzbuzz,html-contador,sqlite --max-min 4 `
  --llama-port 8080 --ui-port 8791 --salida reports\viabilidad-2026-10-27\eval-agente

# 6) Limpieza y verificación (resultado final: 0 procesos, 0 MiB usados)
tasklist | findstr /i llama-server          # vacio
nvidia-smi --query-gpu=memory.used,memory.free --format=csv   # 0 MiB, 7956 MiB
netstat -ano | findstr ":8080 :8787"        # sin LISTEN
```

---

## 12. Conclusión final para el usuario

Con la RTX 4060 Laptop de 8 GB **sí se puede programar con IA 100 % local**: el modelo Ornith 9B Q4_K_M entra
completo en la GPU (34/34 capas, visión incluida, 32K de contexto, 618 MiB de margen), genera a ~41 tok/s estables,
procesa prompts de 12K en ~7 s y el agente del IDE resolvió 3/3 tareas reales en 62 s. El límite no es "no puede":
es que **el margen de VRAM solo permite este tamaño de modelo** (o alternativas más pequeñas); un modelo más grande
obligaría a recortar contexto/visión o directamente no arrancaría. La respuesta a "¿definitivamente no puede?" es
**no**: puede, y a una velocidad usable.
