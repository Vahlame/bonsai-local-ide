# Strata y el arte de meter más modelo en menos memoria

> Investigación para Bonsai Local IDE · 30-oct-2026
>
> Fuentes principales: [Strata](https://github.com/Niko1221/Strata) (MIT),
> [HOW_IT_WORKS.md](https://github.com/Niko1221/Strata/blob/main/docs/HOW_IT_WORKS.md),
> [DETAILS.md](https://github.com/Niko1221/Strata/blob/main/docs/DETAILS.md),
> [MODELS.md](https://github.com/Niko1221/Strata/blob/main/docs/MODELS.md) y la
> explicación divulgativa de [Gnana Prasath](https://gnana70.medium.com/run-a-125b-ai-model-on-a-12-gb-gaming-pc-how-strata-works-169679522888).
> Los números son los publicados por el proyecto; no se han reproducido en esta
> máquina (RTX 4060 Laptop 8 GB, 16 GB de RAM), que no cumple los requisitos de
> Strata para Qwen3.8-Flash-Next.

---

## 1. Qué es Strata

Strata es un motor de inferencia local, escrito en C++/CUDA (con backend HIP y
ports para Intel y Apple), especializado en **modelos MoE gigantes en PCs de
consumidor**. Su caso estrella es Qwen3.8-Flash-Next: 125 000 millones de
parámetros, 48 capas y **24 576 expertos** (512 por capa), del que cada token
usa solo **10 expertos por capa** (~2 % de los pesos). El pack más pequeño pesa
66 GB; la máquina de referencia tiene una RTX 5070 de 12 GB, un Ryzen 5 7600 y
64 GB de RAM, y consigue ~93 tok/s en Q2_0.

La idea no es "comprimir el modelo hasta que quepa", sino **repartir el trabajo
por toda la jerarquía de memoria** y mantener ocupados a la vez GPU, CPU, RAM y
SSD. Strata lo llama la metáfora de la cocina:

| Cocina | Hardware | Qué guarda | Qué hace |
|---|---|---|---|
| Encimera | VRAM | atención, routers, expertos compartidos, cabeza de salida, capa MTP, caché de expertos y KV activo | lo que se usa en cada token, a máxima velocidad |
| Despensa | RAM (pinned) | **todos** los expertos | la CPU calcula los que no están en la GPU, en paralelo |
| Almacén | SSD | tabla n-gram de 28,8 GB | se leen unas pocas filas por token a través de la caché del sistema |

---

## 2. Cómo viajan los datos, componente a componente

### 2.1. Un token, capa por capa

1. **Embedding / entrada.** El token entra por la GPU. La tabla de embeddings y
   la cabeza de salida viven en VRAM.
2. **Router.** En cada capa, un router pequeño (GPU) calcula qué expertos
   necesita ese token. En Qwen3.8-Flash-Next elige 10 de 512.
3. **Atención y mezcladores.** La GPU hace la atención completa y los
   DeltaNet mixers; también los *shared experts* (los que usan todos los tokens)
   y las proyecciones comunes.
4. **Expertos.** Para cada experto elegido:
   - si está en la **caché de VRAM**, la GPU lo usa directamente;
   - si no, el motor lo busca en la **copia pinned de RAM** y lo calcula en la
     CPU con kernels AVX2/AVX-512 (ggml i-quants), **mientras la GPU sigue con
     los expertos que sí tiene**. No hay una barrera "GPU termina → CPU empieza".
   - según `--pcie-frac`, una parte de los expertos que faltan se **copian** por
     PCIe a la GPU en vez de calcularse en CPU. En un portátil con PCIe estrecho
     suele compensar menos; en una torre con PCIe rápido y CPU lenta, más.
5. **Caché de expertos.** La VRAM que no usan atención/KV se llena con los
   expertos más usados. El motor **aprende el routing de la conversación** y va
   cambiando qué expertos ocupa (`--adapt-every`, `--adapt-swaps`,
   `--adapt-decay`). Cada GB extra de VRAM son ~700 expertos más en la GPU.
6. **Salida.** La cabeza de salida (GPU) produce logits. La capa MTP draft
   propone los siguientes tokens y el modelo grande los verifica en una pasada.

### 2.2. La tabla n-gram del SSD

Además de los expertos, el modelo usa una tabla de **n-gram/Engram de 28,8 GB**
en el SSD. No se carga entera: se leen unas pocas filas por token y el sistema
operativo las mantiene en la página caché. Es el equivalente a consultar un
diccionario enorme sin traerlo a la mesa.

### 2.3. KV cache: lo que crece con la conversación

El KV es el otro gran consumidor. Strata lo trata como un sistema de niveles:

| Modo | Qué hace | Cuándo |
|---|---|---|
| `--kv int8` (default) | KV a 8 bits | siempre |
| `--kv q4_0` | 4 bits con rotación Hadamard; ~4 % más rápido a 128k, perplejidad +8–12 % | contextos muy largos con poca RAM/VRAM |
| `--kv k8v4` | claves 8 bits, valores 4 bits rotados; 23 % menos KV que int8, más preciso que q4_0 | contexto largo con buena calidad |
| `--kv-streaming on` | el KV completo vive en RAM y solo la ventana que la atención lee está en VRAM (`--kv-resident`) | desde 64k, si hay RAM |
| `--kv-grow` | el KV ocupa VRAM solo para las celdas que las peticiones alcanzan; el resto lo cede a la caché de expertos | una GPU, contexto ≥128k, todos los expertos en RAM |

En esta máquina, llama.cpp ya usa KV q8_0/q4_0 y el proyector de visión en CPU;
Strata añade la idea de **KV streaming**, que llama.cpp no tiene con la misma
profundidad. Es una línea de experimentación clara para el futuro.

### 2.4. Modos de poca RAM

Cuando los expertos no caben en RAM junto al sistema, Strata elige uno de estos:

| Modo | Flag | Comportamiento |
|---|---|---|
| Mapeado | `--mmap-experts` | los expertos se mapean desde `experts.bin` o los GGUF; la página caché del SO hace de RAM flexible. Con poca VRAM, muchos vienen del SSD: mucho más lento |
| Residente | `--resident-experts` | copia a RAM **solo** los expertos que la GPU no tiene; nada se lee del SSD mientras responde |
| Presupuesto | `--resident-budget-gib N` | copia a RAM los N GiB de expertos no residentes mejor clasificados; el resto se lee de archivo |

En Windows hay detalles que importan: `STRATA_FILE_RELEASE=1` recorta las
páginas de archivo tras subirlas a la GPU (es un hint, no libera memoria
comprometida), `STRATA_PIN_BY_NEED=1` registra por rango los expertos que más se
usan, y `STRATA_PIN_RESERVE_MIB` reserva memoria page-lockable para que CUDA no
se quede sin buffers. Los grandes pages de Windows necesitan privilegio
`SeLockMemoryPrivilege` y un nuevo inicio de sesión.

### 2.5. Guess, then check (MTP + prompt lookup)

- La capa **MTP** del modelo propone hasta 3 tokens.
- Una pasada del modelo grande verifica todos a la vez y acepta los que
  coinciden; el grande decide cada token, así que la calidad no cambia.
- Cuando la respuesta repite contexto (ediciones de código, citas), el
  **prompt lookup** propone hasta 5 tokens de la copia anterior; solo se activa
  donde su aceptación medida compensa.
- Resultado publicado: 1,6–1,8× menos tiempo; 2,4–3,2 tokens por pasada de
  media.

### 2.6. Prefill y solapamiento

- El prompt se lee en trozos de hasta 8 192 tokens.
- Mientras la GPU hace la atención de la capa actual, los expertos de la
  siguiente capa se **prefetch** por PCIe.
- En Linux hay *zero-copy* cuando las páginas del experto ya están en página
  caché, prefetch de I/O por capas y una compuerta que lo apaga si la página
  caché no tiene sitio. En Windows esas optimizaciones no están.
- Tras el primer turno se conserva la conversación y solo se procesa lo nuevo;
  de ahí que las respuestas de seguimiento empiecen en segundos.

---

## 3. Los números que publica Strata

Máquina: RTX 5070 12 GB, Ryzen 5 7600 (6 núcleos), 64 GB DDR5-5200, Windows,
Qwen3.8-Flash-Next ISTA-DASLab, MTP activo.

| Pack | Descarga | RAM de expertos | Salida (1k) | Salida (128k) | Prompt 32k |
|---|---:|---:|---:|---:|---:|
| Q2_0 | 66 GB | ~34 GB + 6 GB | 87–94 tok/s | 74 tok/s | 2 171 tok/s |
| IQ2_XS | 68 GB | ~36 GB + 6 GB | 79–80 tok/s | 63 tok/s | 2 092 tok/s |
| IQ3_XXS | 76 GB | ~43 GB + 6 GB | 62 tok/s | 49 tok/s | 1 745 tok/s |
| IQ3_S | 80 GB | ~50 GB + 6 GB | 52–53 tok/s | 45 tok/s | 1 624 tok/s |
| Coder (IQ1_M) | 29,6 GB | ~23 GB | 55–59 tok/s | 43 tok/s | 2 177 tok/s |

Lectura honesta: son números de **otra máquina** y de un modelo MoE con una
estructura muy concreta. No se trasladan a un 9B denso en una RTX 4060 de 8 GB.
Lo que sí se traslada es el **principio**: cada byte de VRAM debe contener lo
que más se usa, y el resto debe poder calcularse o leerse sin bloquear a la GPU.

---

## 4. Qué podemos aplicar en Bonsai (llama.cpp, 8 GB VRAM, 16 GB RAM)

### 4.1. Ya aplicado

- **KV cuantizado** (`q8_0` por defecto; `q4_0` para contexto máximo) y
  `--ctx-checkpoints 0`.
- **Proyector de visión en CPU** (`--no-mmproj-offload`): libera 879 MiB y sube
  la ventana de 71k a 110k, a costa de ~15 s por imagen.
- **Reparto automático de contexto** (`historial = ventana − salida − margen`).
- **Compactación estructurada** del historial.
- **Plan por modelo** en el Model Hub: lee la arquitectura del GGUF
  (`kvF16BytesPorToken`) y elige contexto/KV/visión con la VRAM real.
- **Muestreo recomendado por modelo** (Qwen3, Qwen2.5 Coder, Gemma 3, Llama 3.2)
  y presupuesto de razonamiento solo si el modelo lo admite.

### 4.2. Se puede probar ya, con llama.cpp

| Idea de Strata | Equivalente en llama.cpp | Cómo probarlo |
|---|---|---|
| KV streaming | `--no-kv-offload` + `--cache-ram` + `--kv-unified`; no es idéntico | medir contexto máximo y tok/s con KV en RAM vs VRAM |
| Caché de expertos / offload selectivo | `--n-cpu-moe N`, `--override-tensor`, `--cpu-moe` | medido con Qwen3.6-35B-A3B, Qwen3-30B-A3B, GPT-OSS-20B y Nemotron 3 Nano: `scripts/moe-bench.mjs` |
| Auto-fit de capas | `llama-fit-params.exe`, `--fit`, `--fit-params` | el build ya trae `llama-fit-params.exe`; comparar su plan con el nuestro |
| MTP / draft | `--spec-type draft-simple --draft-model … --draft-tokens 4` | Qwen3 4B + Qwen3 0.6B; Qwen2.5 Coder 7B + Qwen2.5 0.5B |
| Prefetch / mmap | `--mmap` (default), `--mlock`, `--no-mmap` | en densos gana mmap; en MoE con expertos en RAM gana `--load-mode none` (medido) |
| Batching | `-b`, `-ub`, `--parallel` | matriz por modelo con `llama-bench` y el Model Lab |
| Prioridad de hilos | `-t` | 4 hilos es el equilibrio medido en esta GPU; probar 6/8 por modelo |

### 4.3. Lo que NO aplica (y conviene decir)

- **Caché adaptativa de expertos**: Ornith 9B y los modelos densos del Hub no
  tienen 512 expertos por capa; no hay nada que cachear por routing.
- **Tabla n-gram de 28,8 GB**: es específica de Qwen3.8-Flash-Next.
- **Reparto multi-GPU / layer split**: esta máquina tiene una sola GPU.
- **Strix Halo / memoria unificada**: no es el hardware de este equipo.
- **Los 125B**: con 16 GB de RAM no se pueden tener los 34–50 GB de expertos.
  El modo mapeado leería del SSD en cada token y sería órdenes de magnitud más
  lento. No es una opción honesta para este portátil.

### 4.4. "Meter más en menos RAM": lista de palancas, de mayor a menor impacto

1. **Elegir el modelo y la cuantización adecuados.** Un 4B Q4 con 60k de
   contexto suele ser más útil que un 9B Q4 ahogado a 16k.
2. **KV quantization + contexto automático.** q8_0 casi sin pérdida; q4_0 para
   ventana máxima. Es la palanca que ya usa el IDE.
3. **Offload del proyector de visión a CPU.** 879 MiB = +39k tokens en Ornith.
4. **Speculative decoding con un draft pequeño.** Puede dar ~1,5–2× en
   generación si el draft acierta; cuesta ~0,4–0,8 GB de VRAM.
5. **MoE con offload de expertos** (`--n-cpu-moe`). Es la única forma realista
   de correr un modelo de 30B en 8 GB VRAM + 16 GB RAM, a costa de velocidad.
6. **mmap en vez de copiar a RAM.** Deja que el SO page lo que no se usa; en
   Windows el `working set` puede crecer y conviene medirlo.
7. **Contexto selectivo y compactación.** No mandar 100k tokens si 20k
   contienen la información; el `small-local-coder` ya lo hace.
8. **Prompt lookup / draft por sufijo.** Para ediciones de código que repiten
   texto; llama.cpp tiene `--lookup-cache`/`--lookup` en algunas builds.

### 4.5. MoE híbrido: lo que hace Bonsai con 8 GB VRAM y 16 GB RAM

Un MoE no se carga entero en la GPU. El plan separa tres cosas:

1. **Pesos densos** (atención, embeddings, router, experto compartido) → VRAM.
2. **Expertos** → las últimas capas que caben en la VRAM restante; el resto en RAM
   (`--n-cpu-moe N`). El reparto se recalcula en cada arranque con el contexto real,
   no se congela al descargar.
3. **KV** → VRAM, en `q8_0`. En MoE se prefiere q8_0 a f16 porque la mitad de KV
   que se ahorra se convierte en capas de expertos en la GPU, que es donde se gana
   velocidad. El contexto por defecto baja a **32k** por el mismo motivo.

Además:

- `--load-mode none` cuando los expertos de CPU caben en RAM: carga los pesos en
  memoria anónima y libera el búfer host de lo que ya está en VRAM. Medido en
  Qwen3.6-35B-A3B: **45 tok/s frente a 28 con mmap** y **817 frente a 390 tok/s**
  de prompt. Si no caben, `--load-mode mmap` deja que Windows pagine desde el SSD.
- `--fit off` + reparto explícito: el plan no delega en el auto-fit de llama.cpp.
- `--cache-ram 0`: el KV de host no roba RAM a los expertos.
- El proyector de visión va a CPU si con ello entra alguna capa de expertos más.
- Al proceso se le sube la prioridad de memoria y se le desactiva **EcoQoS**
  (`scripts/win-optimize-process.ps1`): en un portátil, Windows puede frenar un
  proceso lanzado en segundo plano justo cuando está leyendo expertos.
- Con `mmap`, `scripts/precargar-gguf.mjs` calienta solo las capas de expertos
  que se quedan en RAM. Para medir en frío de verdad:
  `scripts/win-cache.ps1 -PurgeStandby` purga la standby list (requiere admin).

Planes calculados con la cabecera real de cada GGUF (7956 MiB libres, 32k, KV q8):

| Modelo | Expertos totales | Capas GPU | Expertos GPU | Expertos RAM |
|---|---:|---:|---:|---:|
| Qwen3.6-35B-A3B Q2_K_XL | 9,80 GiB | 18/40 | 4.542 MiB | 5.498 MiB |
| Qwen3-30B-A3B 2507 Q2_K_XL | 9,96 GiB | 17/48 | 3.640 MiB | 6.579 MiB |
| GPT-OSS-20B MXFP4 | 9,46 GiB | 9/24 | 3.636 MiB | 6.060 MiB |
| Nemotron 3 Nano 30B-A3B Q2_K_L | 15,39 GiB | 15/52 | 4.802 MiB | 10.976 MiB |

El último es el caso límite: sus expertos en RAM (10,8 GiB) casi llenan los 16 GB
del equipo. Es el único que puede tocar SSD durante la generación; por eso se mide
aparte con `moe-bench`.

Medido en Qwen3.6-35B-A3B (32k, q8_0, 19/40 capas en GPU, 12 hilos, batch 1024/512):

| Modo | Generación | Prompt | RAM del proceso | VRAM |
|---|---:|---:|---:|---:|
| `--load-mode none` | **42,8 tok/s** | **815 tok/s** | 6,5 GiB | 6,9 GiB |
| `--load-mode mmap` | 18,3 tok/s | 384 tok/s | 10,7 GiB | 6,9 GiB |
| `--cpu-moe` (todo CPU) | 23,3 tok/s | 448 tok/s | 10,7 GiB | 2,4 GiB |
| 8 hilos en vez de 12 | 40,2 tok/s | 816 tok/s | 6,5 GiB | 6,9 GiB |

La diferencia no es del motor: `none` evita que los expertos se lean dos veces
(page cache + memoria del proceso) y elimina los page faults de la generación.

---

## 5. Plan de experimentos para este repositorio

El Model Lab (`scripts/model-lab.mjs`) ya mide arranque, VRAM pico, TTFT,
tok/s, JSON, código ejecutado, tool-calling, retrieval a ~8k y visión. Los
siguientes experimentos se pueden añadir sin tocar el motor:

| Experimento | Comando | Métrica |
|---|---|---|
| Contexto/KV por modelo | `node scripts/model-lab.mjs probe --all` | arranque, VRAM, pruebas |
| Draft especulativo | preset con `--spec-type draft-simple` + Qwen3 0.6B | tok/s y aceptación |
| Matriz `-ub`/`-b` | `llama-bench -m … -p 512,2048 -n 128 -r 2 -b 512 -ub 128/256/512` | pp/tg tok/s |
| MoE con offload | `node scripts/moe-bench.mjs --model qwen36-35b-a3b` | VRAM/RAM/tok/s y reparto de expertos |
| Contexto largo real | `scripts/probe-longctx.ps1` o 3 agujas | PASS/OOM y tokens reales |
| Calidad por modelo | `node scripts/bench-model-quality.mjs --model <clave>` | 18 tareas deterministas |

Regla de oro: **una sola variable por experimento**, misma semilla, misma
temperatura y al menos 2 repeticiones. El proyecto ya aprendió que una muestra
con suerte (94,4 % vs 88,9 %) no demuestra nada.

---

## 6. Lecciones de diseño que sí copiamos

1. **La memoria es una jerarquía, no un número.** VRAM > RAM > SSD, y cada
   nivel debe contener lo que se usa con esa frecuencia.
2. **Solapar, no esperar.** Mientras la GPU calcula, la CPU puede calcular
   expertos o preparar el siguiente chunk.
3. **Aprender el uso real.** Strata reordena expertos según el routing; nosotros
   podemos reordenar presets y contextos según las tareas reales del usuario.
4. **Medir el pico, no el reposo.** En esta GPU, el pico de arranque decide si
   el servidor vive; el uso estable engaña.
5. **La calidad del KV no se nota en 18 tareas.** Mejor elegir por VRAM y
   contexto, y reservar f16 para ventanas pequeñas.
6. **El mejor motor para un modelo no es el mismo para todos.** De ahí el plan
   por modelo del Hub y la matriz de benchmarks.

---

## 7. Enlaces

- [Strata (GitHub)](https://github.com/Niko1221/Strata)
- [Cómo funciona](https://github.com/Niko1221/Strata/blob/main/docs/HOW_IT_WORKS.md)
- [Referencia técnica y modos de memoria](https://github.com/Niko1221/Strata/blob/main/docs/DETAILS.md)
- [Modelos y requisitos](https://github.com/Niko1221/Strata/blob/main/docs/MODELS.md)
- [Artículo divulgativo](https://gnana70.medium.com/run-a-125b-ai-model-on-a-12-gb-gaming-pc-how-strata-works-169679522888)
- [Paper de Strata](https://github.com/Niko1221/Strata/blob/main/paper/Strata-Paper.pdf)
