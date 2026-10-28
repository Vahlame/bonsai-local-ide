# DOCUMENTO DE ARQUITECTURA Y PLAN MAESTRO: LOCAL AI 27B EN RTX 4060

> **DOCUMENTO AUTÓNOMO DE CONTINUIDAD TÉCNICA**  
> *Este documento contiene todas las especificaciones de hardware, matemáticas de VRAM, comandos de compilación, flags de runtime y protocolos de integración necesarios para continuar, auditar o completar este despliegue con Cursor o cualquier otro agente de IA sin necesidad de historial previo.*

---

## 1. Identidad del Proyecto y Filosofía de Diseño

* **Objetivo:** Desplegar localmente el modelo de código de 27 mil millones de parámetros **Ternary-Bonsai-2-27B-Abliterated (PTQ1_0)**, aprovechando la GPU dedicada **NVIDIA RTX 4060 (8GB VRAM)** y la CPU **AMD Ryzen 7 7840HS**, con **contexto automático de hasta ~77.824 tokens** (el mayor que arranca con la VRAM libre de ese momento; ver §4).
* **Velocidad (MEDIDA con llama-bench y el servidor real):** generación **28.3–28.6 t/s** (límite = ancho de banda: ~5.95 GB leídos por token, techo teórico ≈ 43 t/s; no cambia con `-ub`, hilos ni con el modo turbo del PC: la GPU sigue topada en 80 W) y lectura del prompt **626–649 t/s** con `-ub 256`. Con el contexto lleno baja: 8k → 26.0 t/s, 32k → 20.4 t/s. *(La cifra antigua de "35 a 45+ t/s" superaba el techo físico.)*
* **Propósito Primario:** Copiloto de programación autónomo, sin límites de cuota, sin censura ni filtros de seguridad corporativos intrusivos, y con latencia ultrabaja en Windows.

---

## 2. Auditoría Técnica del Hardware Real (Host)

| Parámetro | Valor Real Detectado | Configuración Específica de Rendimiento |
| :--- | :--- | :--- |
| **GPU Dedicada** | **NVIDIA GeForce RTX 4060 Laptop** | 8,188 MiB VRAM GDDR6, 80W TGP, Arquitectura Ada Lovelace (Compute 8.9), 3072 núcleos CUDA, 96 Tensor Cores 4ª Gen. Ancho de banda: ~256–272 GB/s. |
| **Estado de Pantalla** | **`Disp.A: Off`** | La GPU integrada (AMD Radeon 780M) gestiona los monitores y el escritorio de Windows. La RTX 4060 está libre para cómputo (Brave y el software de AMD abren la GPU con ~160 MiB). |
| **Procesador (CPU)** | **AMD Ryzen 7 7840HS** | 8 núcleos físicos / 16 lógicos, Zen 4 con **AVX-512** (VNNI y BF16). Con todo en GPU, la CPU solo orquesta. |
| **Memoria RAM** | **16.00 GB DDR5** (15,677 MiB visibles) | Compartida con Windows y las apps. La caché de prompt del servidor vive aquí (ver §4 y §9), por eso se escala a la RAM real. |
| **Almacenamiento** | **NVMe SSD PCIe 4.0** | >700 GB libres en Disco C:, lectura secuencial >4,000 MB/s para carga rápida del modelo. |
| **Sistema Operativo** | **Windows 10 Enterprise LTSC 2021 (19044) / Windows PowerShell 5.1** | Plan de energía "Alto rendimiento". Driver NVIDIA 617.14, CUDA 12.x (los binarios llevan `cudart64_12` / `cublas64_12`). |

---

## 3. Radiografía Técnica del Modelo y Cuantización

* **Modelo Base:** `Override-6/Ternary-Bonsai-2-27B-abliterated-gguf` (predeterminado) y `BoldingBuilds/Ternary-Bonsai-2-27B-Abliterated-PTQ1_0-GGUF` (respaldo, `-Modelo bolding_v1`), ambos derivados de `prism-ml/Ternary-Bonsai-2-27B-gguf`, base `Qwen/Qwen3.8-27B`. Catálogo y motivos en `chat/modelo.json` e [INTEGRACION-MODELO.md](INTEGRACION-MODELO.md).
* **Tamaño Exacto del Archivo:** `5,946,648,928 bytes` ($\approx 5.538\text{ GiB} / 5.95\text{ GB}$).
* **Formato de Pesos:** `PTQ1_0` (grupos de 128 pesos en $\{-s, 0, +s\}$, ~1.75 bits por peso). `ssm_alpha` y `ssm_beta` van en BF16.
* **Abliteración Quirúrgica:** Eliminación del vector de rechazo únicamente en 98 tensores de escritura (`ffn_down`, `ssm_out`, `attn_output`) de los bloques 15 a 63. Según su ficha: MMLU 0.781 (stock 0.780) y HumanEval greedy 0.860 (stock 0.890).

### Datos medidos en el encabezado del GGUF (`qwen35.*`)

> Corrección: la versión anterior de este documento decía "64 cabezales Q, 8 KV, dimensión 128". El archivo dice otra cosa.

| Dato | Valor |
| :--- | :--- |
| Bloques | 64: **16 de atención completa** (bloques 3, 7, 11 … 63; `full_attention_interval = 4`) + **48 lineales** (Gated DeltaNet, tensores `ssm_*`) |
| Atención | 24 cabezas Q, **4 cabezas KV** (GQA 6:1), dimensión de cabeza **256**; `rope.freq_base` 10,000,000 |
| Tamaños | embedding 5120 · FFN 17,408 · vocabulario 248,320 (BPE `qwen35`) |
| Contexto nativo | **262,144** tokens |
| Tensores | 402 `PTQ1_0`, 96 `BF16`, 353 `F32` (851 en total) |
| Rotación Hadamard | `prism.hadamard.*` (bloque 1024, signos explícitos): por eso hace falta el fork |
| Muestreo en el GGUF | `general.sampling.*` = temp 1.0, top_k 20, top_p 0.95 (el del modo thinking) |
| Plantilla de chat | Qwen3.5-like: herramientas en XML (`<tool_call><function=…>`), `enable_thinking`, `reasoning_effort ∈ {xhigh, medium, low}`, `preserve_thinking` |

### ⚠️ Reglas Críticas del Modelo:
1. **Kernel Obligatorio:** requiere el fork `PrismML-Eng/llama.cpp` (FWHT + `PTQ1_0`). Ollama, LM Studio, vLLM y llama.cpp upstream fallan o dan basura. El `llama-server.exe` de `bin\` es el build 10743 (`adfffbe41`).
2. **Thinking mode: APAGADO por defecto (decisión del dueño del proyecto).** El autor de la versión abliterada documenta que en thinking mode el modelo a veces "redacta la respuesta dentro del razonamiento y nunca la termina" (24 % de prompts sin respuesta con el muestreo por defecto, 63 % con greedy), y el fabricante avisa de respuestas vacías o truncadas sobre todo en idiomas distintos del inglés. Por eso: `--reasoning off` en el servidor y `enable_thinking:false` en cada petición. Existe un modo **opt-in y experimental** (`-Pensar N`, ver §9) que nunca se activa solo.
3. **KV solo en parejas iguales** (`f16/f16`, `q8_0/q8_0`, `q4_0/q4_0`). Las mezclas (p. ej. K `q8_0` + V `q4_0`) necesitan compilar con `GGML_CUDA_FA_ALL_QUANTS=ON` y `q5_x` es varias veces más lento (KNOWN_ISSUES de prism-ml). Con `--kv-mean-center` la K debe ser `q4_0`.
4. **CUDA 12.4 en Windows.** Los builds con CUDA 13.3 se cierran en silencio (KNOWN_ISSUES). No actualizar `cudart`/`cublas` por su cuenta.
5. **Sin efecto en este modelo:** la especulación `ngram-*` (no acelera nada) y la cabeza MTP (+1.6 % medido en `PTQ1_0`). No gastar tiempo ahí.
6. **Muestreo explícito.** Un servidor sin opciones explícitas pierde `presence_penalty`/`repetition_penalty` de la ficha, y el GGUF trae el muestreo del modo thinking. Se fija en el servidor (`scripts\start-server.ps1`) y en cada petición del chat (perfil `codigo`).
7. **`reasoning_effort: "high"` devuelve HTTP 500** (la plantilla solo acepta `xhigh`, `medium`, `low`; `low` no reduce nada). El presupuesto de razonamiento va como `thinking_budget_tokens` en la raíz de la petición, no dentro de `chat_template_kwargs`.

---

## 4. Ingeniería de Memoria VRAM y Matemáticas de Contexto

El límite físico de la RTX 4060 son **8,188 MiB**. Si se pasa, el servidor falla al cargar (`cudaMalloc`, con "Prefer No Sysmem Fallback") o, sin ese ajuste, Windows desborda a la RAM y la velocidad se desploma. `start-server.ps1` hace la cuenta **antes** de arrancar y se niega si no cabe.

### Modelo de VRAM (calibrado con `nvidia-smi` en el servidor real; datos en `chat/modelo.json`, mismas cuentas en `chat/modelo.mjs` y `start-server.ps1`)

**En uso** = pesos **5395** (los 276 MiB de `token_embd` se quedan en RAM) + estado recurrente **150** (48 capas × ~3.1 MiB, f32) + CUDA **138** + KV(ctx) + cómputo(ctx, `-ub`).
* KV solo en las **16 capas de atención**: 16 × 4 cabezas × 256 × 2 valores por token → **64 KiB** (`f16`), **34 KiB** (`q8_0`), **18 KiB** (`q4_0`).
* Cómputo = máx(255, 40 + 4.5·ctx/1024) MiB, más 0.302 MiB por cada token de `-ub` por encima de 256 (la atención descuantiza el KV a f16 en un temporal que crece con la ventana).
* **Medido** (`-ub 256`, q4_0): **7163 / 7253 / 7343 / 7433 / 7523 MiB** a 64k / 68k / 72k / 76k / 80k, es decir 22 MiB por cada 1k; con `-ub 1024` a 64k: 7394.
* **Al arrancar**, el servidor reserva dos veces la parte del cómputo que depende de la ventana, así que lo que decide si arranca es el **pico** = en uso + cómputo(ctx). Con 7956 MiB libres: 81920 arranca (pico 7923) y **83968 falla**. Por eso el contexto automático con esa VRAM es **77,824**.

| Ventana | KV | En uso | Pico al arrancar | ¿Arranca con ~7.9 GB libres? |
| :--- | :--- | :--- | :--- | :--- |
| 16,384 | `f16` | 6,962 | 7,217 | sí |
| 32,768 | `q8_0` | 7,026 | 7,281 | sí |
| 65,536 | `q4_0` | 7,163 | 7,491 | sí |
| **77,824 [AUTO]** | `q4_0` | **7,433** | 7,813 | sí |
| 65,536 | `q8_0` | 8,187 | 8,515 | **no** |
| 98,304 | `q4_0` | 7,883 | 8,355 | **no** |

`node chat\modelo.mjs --tabla <MiB libres>` imprime la tabla completa. `-ContextSize auto` (por defecto) toma la mayor ventana que arranca (múltiplos de 4096, KV q4_0) y, si el servidor se cae al cargar, reintenta con 8192 tokens menos.

> **Arquitectura híbrida:** solo 16 de 64 capas tienen KV, así que el contexto crece a 1/4 de la tasa de un Transformer puro. Los 262,144 tokens nativos no caben en 8 GB; el techo práctico es ~80k con q4_0.

### Memoria de sistema (caché de prompt)
Medido con el servidor real (prompt de ~4.8k tokens, varios turnos y mensaje anterior reescrito): **los valores por defecto de llama.cpp ya reutilizan el prefijo** (4,749 de 4,839 tokens en caché). Solo se limita `-cram` a ¼ de la RAM (≈3.9 GiB aquí) para no ahogar la máquina de 16 GB: el proceso ya ocupa ~6.7 GB residentes. Las pruebas con `-ctxcp/-cms` propios no aportaron nada y se quitaron.

---

## 5. Estructura del Proyecto y Archivos

Ubicación raíz: `c:\Users\user\Documents\prject_local_AI`

```text
prject_local_AI/
├── bin/                                # Motor PrismML llama.cpp (CUDA 12.x)
│   ├── llama-server.exe                # Servidor API compatible con OpenAI
│   ├── llama-cli.exe / llama-bench.exe / llama-perplexity.exe / llama-kv-mean-center.exe
│   ├── ggml-cuda.dll                   # Kernels CUDA con soporte FWHT para PTQ1_0
│   ├── cublas64_12.dll / cudart64_12.dll
│   └── cloudflared.exe                 # Túnel seguro para conexión con Cursor IDE
│
├── models/                             # Pesos GGUF (+ sesgo KV si se calcula)
│   └── Ternary-Bonsai-2-27B-Abliterated-PTQ1_0.gguf (~5.95 GB)
│
├── chat/                               # Cliente propio (Node)
│   ├── modelo.json                     # FUENTE ÚNICA: datos del GGUF, VRAM, muestreo, caché
│   ├── modelo.mjs                      # Cuentas de VRAM y perfiles de muestreo (+ pruebas)
│   ├── bonsai-chat.mjs                 # Cliente de terminal y núcleo (BonsaiChat)
│   ├── context.mjs                     # Empaquetado del historial (pliega con histéresis)
│   ├── actions.mjs                     # Herramientas: archivos, comandos, búsqueda
│   ├── ui-server.mjs + ui/index.html   # Interfaz de navegador
│   ├── prueba-sin-gpu.mjs              # Prueba el cliente contra un servidor FALSO (sin GPU)
│   └── timings.jsonl                   # (generado) velocidad y caché por petición
│
├── scripts/
│   ├── start-server.ps1                # Servidor local: comprueba VRAM, KV auto, muestreo, caché
│   ├── start-ui.ps1 / start-chat.ps1   # Servidor + interfaz de navegador / terminal
│   ├── start-aider.ps1 + aider/        # Aider con ventana y muestreo declarados
│   ├── start-cursor-bridge.ps1         # Servidor + túnel Cloudflare para Cursor
│   ├── optimizar.ps1 + calibracion.txt # Calibración única con la GPU libre
│   └── test-cli.ps1                    # Benchmark rápido de tokens/segundo
│
├── config/optimo.json                  # (generado por optimizar.ps1) -ub, hilos, ¿usar sesgo?
├── .cursor/rules/lean-code.mdc         # System prompt minimalista para Cursor
├── .cursorignore
├── README.md
└── ARQUITECTURA-Y-PLAN-MAESTRO.md      # Este documento maestro
```

---

## 6. Comandos Maestros de Ejecución

### A. Servidor Local API (OpenAI compatible en Puerto 8080)
```powershell
.\scripts\start-server.ps1            # 64k, sin razonamiento, comprueba la VRAM
.\scripts\start-server.ps1 -DryRun    # solo comprueba y muestra el comando exacto
```
El comando que construye (contexto automático con ~7.9 GB libres, `-ub 256 -t 4` de `configoptimo.json`, sin razonamiento):
```powershell
.\bin\llama-server.exe -m .\models\Ternary-Bonsai-2-27B-Abliterated-PTQ1_0.gguf `
  -ngl 99 -c 77824 -ctk q4_0 -ctv q4_0 --flash-attn on -np 1 -b 2048 -ub 256 -t 4 `
  --host 127.0.0.1 --port 8080 --jinja --metrics `
  --temp 0.5 --top-p 0.85 --top-k 20 --min-p 0 --presence-penalty 0 --repeat-penalty 1 `
  -cram 3919 --reasoning off
```
Opciones: `-ContextSize`, `-KVCacheType auto|f16|q8_0|q4_0`, `-Pensar N` (opt-in), `-DormirSeg N` (libera la VRAM tras N s sin uso), `-Diagnostico` (log para ver si la caché reutiliza el prompt), `-Forzar`.

### B. Interfaz, terminal y Aider
```powershell
.\scripts\start-ui.ps1     # navegador (http://127.0.0.1:8787)
.\scripts\start-chat.ps1   # terminal; /vel muestra velocidad y caché de la última petición
.\scripts\start-aider.ps1
```

### C. Puente para Cursor IDE
```powershell
.\scripts\start-cursor-bridge.ps1
```
*Inicia el servidor y genera una URL HTTPS gratuita `https://xxxx.trycloudflare.com`. Se pega en Cursor Settings → Models → Override OpenAI Base URL. Cursor usa el muestreo del servidor, por eso va fijado en `start-server.ps1`.*

### D. Pruebas que NO necesitan la GPU
```powershell
node chat\bonsai-chat.mjs --self-test   # empaquetado del historial
node chat\actions.mjs                   # acciones
node chat\modelo.mjs                    # datos y cuentas del modelo
node chat\prueba-sin-gpu.mjs            # cliente contra un llama-server falso
```

### E. Calibración con la GPU libre (una vez)
```powershell
.\scripts\optimizar.ps1 -Plan -Todo   # ver los comandos sin ejecutar nada
.\scripts\optimizar.ps1 -Todo         # ~10-15 min: -ub/-t óptimos, sesgo KV y perplejidad f16/q8_0/q4_0
```
Se niega a correr si hay un `llama-server` abierto o si la GPU no tiene VRAM libre.

---

## 7. Configuración del Driver NVIDIA (Sysmem Fallback)

Para asegurar que Windows nunca ralentice la inferencia:
1. Abrir **NVIDIA Control Panel** → **Controlar la configuración 3D**.
2. Parámetro: **CUDA - Sysmem Fallback Policy**.
3. Valor: **`Prefer No Sysmem Fallback`** (Preferir no usar reserva de memoria del sistema).
4. Guardar cambios.

*(El preflight de `start-server.ps1` evita llegar a ese desborde; este ajuste es la segunda barrera.)*

---

## 8. Guía para Continuar con Otra IA en Cursor

Si continúas este proyecto en Cursor con otro modelo o agente:
1. **Verificar que el modelo esté descargado:**
   ```powershell
   Get-Item ".\models\Ternary-Bonsai-2-27B-Abliterated-PTQ1_0.gguf" | Select-Object Length
   # Debe tener exactamente 5,946,648,928 bytes
   ```
2. **Iniciar el servidor:** ejecuta `.\scripts\start-cursor-bridge.ps1` en una terminal de Cursor.
3. **Vincular Cursor:** pega la URL de Cloudflare (`https://xxxx.trycloudflare.com/v1`) en `Cursor Settings (Ctrl + Shift + J) -> Models`.
4. **Validación:** cualquier ajuste futuro debe consultar las secciones 3, 4 y 9 de este archivo para no alterar los balances de VRAM, el kernel FWHT ni la regla de thinking apagado.

---

## 9. Optimización guiada por la documentación del modelo (registro de decisiones)

Hecha **sin cargar el modelo** (la GPU estaba ocupada): se leyeron la ficha del modelo, `docs.prismml.com`, el repo `Bonsai-demo`, `KNOWN_ISSUES.md` de `prism-ml/Ternary-Bonsai-2-27B-gguf` y el encabezado del propio GGUF; el `--help` de los binarios se leyó con la GPU oculta (`CUDA_VISIBLE_DEVICES=-1`, sin contexto CUDA).

| # | Cambio | Por qué (fuente) | Verificado sin GPU |
| :-- | :--- | :--- | :--- |
| 1 | Muestreo del fabricante en el servidor **y** en cada petición (perfil `codigo`: 0.5 / 0.85 / 20 / 0) | Docs PrismML (llama.cpp) y KNOWN_ISSUES (sin opciones explícitas se pierden las penalizaciones; el GGUF trae el muestreo de thinking). Antes el chat mandaba solo `temperature 0.3`; Aider/Cursor dependían del GGUF | sí (cuerpo de la petición) |
| 2 | Preflight de VRAM + KV `auto` + contexto automático + `-DryRun` | Modelo de VRAM calibrado con `nvidia-smi` (ver §4); el contexto automático usa la VRAM libre y reintenta si falla | sí (servidor real: predijo 7433 MiB a 77824 y midió 7433) |
| 3 | Solo `-cram` = ¼ de la RAM | Se probó `-ctxcp 16 -cms 1024` y no aportó nada: los valores por defecto ya reutilizan el prefijo (medido). Se quitó | sí (servidor real) |
| 4 | El historial se pliega hasta el 60 % del tope (histéresis) | Cada pliegue = un resumen generado + reprocesar todo el prompt (las notas viven en el mensaje de sistema). Antes se plegaba en cada turno una vez lleno | sí (autotests) |
| 5 | `parallel_tool_calls: true` | llama.cpp lo trae desactivado por defecto (`docs/function-calling.md`). El prompt del chat ya le dice al modelo que puede llamar varias funciones y el cliente las procesa. Si aparecen más llamadas mal formadas (KNOWN_ISSUES las lista), se apaga con `BONSAI_PARALLEL_TOOLS=0` | sí (cuerpo); **efecto: medir** |
| 6 | Velocidad y caché visibles (`timings.jsonl`, `/vel`, barra de la interfaz) | Para comprobar con datos si la caché reutiliza el prefijo (`cache_n` alto) | sí (servidor falso) |
| 7 | Aider: ventana 65,536 declarada, mapa del repo 2048, muestreo, espera real a `/health` | Aider no conocía el modelo (`Unknown context window size`, ver `.aider.chat.history.md`), usaba un mapa de 1024 tokens y manda `temperature 0` por defecto | sintaxis |
| 8 | `-DormirSeg` (`--sleep-idle-seconds`) | Descarga el modelo tras N s sin peticiones (`/health` y `/props` no cuentan) y lo recarga con la siguiente: encaja con una GPU compartida | solo flag, sin probar |
| 9 | **Razonamiento opt-in** (`-Pensar N`, `--think N`) | Capacidad principal del modelo base; presupuesto vía `thinking_budget_tokens`, esfuerzo `medium`, muestreo `razonar`, nunca se devuelve al historial. **Apagado por defecto** | sí (servidor falso) |
| 10 | `scripts\optimizar.ps1` (sesgo KV, `llama-bench`, perplejidad) | `--kv-mean-center` es la receta del fabricante para el KV `q4_0` (KV-CACHE.md); no hay sesgo calculado en `models\` | `-Plan` y análisis con datos de ejemplo |

**Sin cambio a propósito:** `-b 2048 -ub 512 -t 8` (hasta medir con `-Medir`), `--flash-attn on`, `-np 1`, `-ngl 99`, `--jinja`, `--reasoning off`.

**Descartado:** especulación `ngram-*` y MTP (sin efecto, ver §3); KV mezclado y `q5_x`; subir el tope de historial (8192) o el contexto sin medir la lectura del prompt.

**Sobre la receta del sesgo KV:** el fabricante sirve el KV `q4_0` con `LLAMA_ATTN_ROT_DISABLE=1` y el sesgo calculado sin rotar; el build actual rota la K por defecto en cachés cuantizadas. No hay números publicados de cuál es mejor, por eso `optimizar.ps1 -Calidad` mide los dos con perplejidad y deja escrito en `config\optimo.json` si usar el sesgo.

---

## 10. Pendiente

La calibración, la medición de velocidad, la comprobación de la caché y el evaluador del agente **ya se hicieron**. El estado vivo, los resultados y la lista priorizada de lo que falta (editor con pestañas, deshacer cambios, reglas del proyecto, ajustes, edición en línea, git, búsqueda, y el arreglo de seguridad del `Origin`) está en **[HANDOFF.md](HANDOFF.md)**. Decisiones que son del usuario: visión (`mmproj`), especulación DSpark (no hay drafter publicado para Bonsai 2) y exponer el modo razonamiento.

### Fuentes
Ficha: `huggingface.co/BoldingBuilds/Ternary-Bonsai-2-27B-Abliterated-PTQ1_0-GGUF` · Base: `huggingface.co/prism-ml/Ternary-Bonsai-2-27B-gguf` (incl. `KNOWN_ISSUES.md`) · `docs.prismml.com` (`run/llamacpp`, `run/server`, `bonsai-2-27b`) · `github.com/PrismML-Eng/Bonsai-demo` (`SPECULATIVE.md`, `KV-CACHE.md`, `scripts/start_llama_server.*`) · `github.com/PrismML-Eng/llama.cpp` (`docs/kv-mean-center.md`) · llama.cpp #20225, #22384 (caché de prompt en modelos híbridos).
