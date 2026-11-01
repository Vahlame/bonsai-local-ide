# Qwen3.8 27B — 4 bits entre 8 GB de VRAM y 16 GB de RAM

Qwen3.8-27B no cabe en esta máquina como los modelos anteriores. Este documento
explica por qué se eligió IQ4_XS, cómo se reparte entre GPU y RAM, qué runtime
hace falta y qué se midió. La integración está pensada para que el IDE lo trate
como un modelo más: se elige en la lista y se pulsa **Iniciar**.

## 1. El modelo

| Dato | Valor |
|---|---|
| Parámetros | 28B densos (no MoE) |
| Arquitectura | híbrida: 48 capas Gated DeltaNet + 16 de atención completa (64 en total) |
| Contexto nativo | 262.144 tokens |
| Visión | sí, con `mmproj` aparte |
| MTP | sí: cabeza `nextn` dentro del propio GGUF |
| Tool calls | plantilla nativa Qwen3-Coder (`<tool_call><function=...>`) |
| KV f16 | 64 KiB/token (solo las 16 capas de atención completa) |

La arquitectura híbrida es lo que hace viable el contexto largo: 48 de las 64
capas tienen estado recurrente de tamaño fijo, así que el KV no crece con cada
token en ellas. Aun así, los pesos son densos: **cada token recorre los 28B**.

## 2. Cuantización: por qué UD-IQ4_XS

| Quant | Tamaño | ¿Cabe con 16 GB de RAM? |
|---|---:|---|
| BF16 | ~54 GiB | no |
| Q8_0 | 27,05 GiB | no |
| UD-Q5_K_M | 18,41 GiB | no |
| UD-Q4_K_M | 15,33 GiB | al límite: 8,4 GiB de RAM libre, ~9,3 GiB en CPU |
| UD-Q4_K_S | 14,30 GiB | al límite |
| **UD-IQ4_XS** | **13,27 GiB** | **sí, con ~1 GiB de holgura** |

`UD-IQ4_XS` de Unsloth es una cuantización dinámica de 4,25 bits por peso: sigue
siendo 4 bits (no se baja a Q3/IQ3) y es la más pequeña de esa familia. Con
16 GB de RAM el margen no es un lujo: si los pesos que no caben en la GPU no
quedan residentes, Windows los vuelve a leer del NVMe en cada token y el decode
cae a 1–2 tok/s.

El GGUF original denominado IQ4_XS contiene IQ2/IQ3 en parte de sus pesos. El
candidato local **`qwen38-27b-perf-iq4_xs-floor4.gguf`** (15,17 GB) sustituye
esos tipos por IQ4_XS y conserva los pesos de mayor precisión. Es una
requantización de una fuente ya cuantizada: no recupera precisión perdida del
modelo de alta precisión. El original se conserva para rollback.

El proyector de visión **no se carga** por defecto. Ocupa 931 MiB que en esta
máquina salen del mismo presupuesto de RAM; el modelo funciona en texto.

## 3. Reparto GPU / RAM

llama.cpp asigna a la GPU las **últimas** `ngl` capas y, si `ngl > 0`, también
la capa de salida (`output.weight`, la más grande después del embedding). El
embedding de tokens se queda siempre en CPU: se lee una vez por token y no
compensa gastar VRAM.

Con 7.956 MiB libres de VRAM y 32.768 tokens de contexto:

| Concepto | MiB |
|---|---:|
| Pesos en GPU (`-ngl`) | ~5.8 GiB |
| KV q8_0 a 32k | ~1.1 GiB |
| Buffer de cómputo + gráficos CUDA | ~0.6 GiB |
| Margen de seguridad | ~0.2 GiB |
| **Total** | **~7.7 GiB** |

El resto de los pesos (embedding + capas que no caben) vive en RAM y se lee con
`--load-mode mmap`. El perfil de entrega usa `--cache-ram 512` con
`--cache-recurrent-prefix` y `LLAMA_MMAP_TRIM_GPU=1`: la caché recurrente vive
en 3 checkpoints de 149,626 MiB (448,878 MiB) y el trim retira del working set
las páginas que ya están en GPU.

El resultado es un modelo denso de 27B que genera a la velocidad que permite el
DDR5-5600 para la mitad que está en CPU. No es un MoE: no hay expertos que se
salten. La única palanca real es mover capas a la GPU, y la VRAM es el techo.

## 4. Runtime

El binario histórico del proyecto está fijado a llama.cpp **v0.8.0 (build
10743)**. Los GGUF de Qwen3.8 se generaron con **b10896** y necesitan:

1. El kernel CUDA de DeltaNet corregido (los builds anteriores generan basura).
2. Soporte de `--spec-type draft-mtp` para la cabeza MTP.
3. El parser de plantilla Qwen3-Coder (tool calls nativas).

Por eso hay un build aparte, sin tocar el optimizado de siempre:

```powershell
# Una vez. Compila master con CUDA para sm_89 (~20-30 min).
.\scripts\build-qwen38-runtime.ps1
```

El build de referencia partió de `dde879b` (master, 2026-11-01), CUDA 12.9.1,
`-DCMAKE_CUDA_ARCHITECTURES=89-real`. El runtime de entrega añade el kernel
IQ4 VNNI y las correcciones de caché recurrente (`d26e06a`, `4b612b4`). La
procedencia autorizada es `build-Qwen38-sm89/bin/qwen38-build.json` y el
SHA-256 del DLL; el `build_info` de `/props` puede quedar de un configure
anterior y no debe usarse como fuente única.

Sale en `.local/opt/bonsai-inference/build-Qwen38-sm89/bin/llama-server.exe` y
se registra en `config/llama-binaries.json` con el id `qwen38-sm89`. El perfil
del modelo lo selecciona con `servidor.binario`; el resto de modelos sigue
usando el binario optimizado.

## 5. Arranque

Desde el IDE: **Model Hub → Qwen3.8 27B → Iniciar**. El perfil de entrega es
**`qwen38-27b-perf-iq4`**; el perfil original **`qwen38-27b`** queda para
rollback. El plan medido (`gpu-parcial`) fija contexto 32.768, KV `q8_0`,
`ngl` 27, MTP 2, `--cache-ram 512` y `--cache-recurrent-prefix`. El acceso
directo `launch-ide.ps1` arranca el perfil guardado, incluido `gpu-parcial`,
sin dejar un servidor manual ajeno al lifecycle.

Equivalente por consola:

```powershell
& "$env:USERPROFILE\.local\opt\bonsai-inference\build-Qwen38-sm89\bin\llama-server.exe" `
  -m models\qwen38-27b-perf-iq4_xs-floor4.gguf `
  -ngl 27 -c 32768 -ctk q8_0 -ctv q8_0 -fa on `
  -b 512 -ub 256 -t 16 --fit off --load-mode mmap --cache-ram 512 `
  --cache-recurrent-prefix `
  --spec-type draft-mtp --spec-draft-n-max 2 --spec-draft-p-min 0 --parallel 1 `
  --jinja --metrics --no-context-shift --ctx-checkpoints 0 --no-reasoning-preserve `
  --reasoning-budget -1 --reasoning-format deepseek --reasoning-effort xhigh `
  --host 127.0.0.1 --port 8080
```

`--reasoning-budget -1` deja el pensamiento sin tope de tokens; el esfuerzo
`xhigh` se pasa también en cada petición. El tope total de salida del turno
sigue siendo la reserva de contexto del IDE. El perfil original
`qwen38-27b` y el GGUF original se conservan para rollback.

## 6. Medido en esta máquina

| Métrica | Valor medido |
|---|---:|
| Lectura del GGUF en carga | ~13 s (ETW, 3.9-12.9 s); arranque administrado validado dentro del timeout de 180 s |
| VRAM | plan 7.505 MiB; ~8,08 GiB usados en GPU con el escritorio |
| RAM | working set ~9,6 GB; privado ~10,86 GB; física disponible ~2,26 GB |
| Decode código | 8,9-9,3 tok/s (varía con el estado térmico) |
| Decode prosa | 6,0-7,1 tok/s |
| Prefill 512 | 202-207 tok/s |
| Prefill frío 6K/12K/25K | 29,7 / 58,1 / 122,3 s |
| Caché 25K | 24.997 tokens reutilizados; TTFT 0,42-0,45 s |
| Segundo paso de agente | `cache_n 6508`; prefill 12,4 s |
| Follow-up nuevo | `cache_n 4551`; pared 41,0 s |
| Aceptación MTP | 73 % en agente; 100 % en prompt repetitivo |

Los informes, manifiestos y comandos exactos están en el fork:
`reports/2026-11-01-qwen38/`. La caché de 25K es un prefijo repetido/residente,
no una promesa para cualquier turno con herramientas.

## 7. Integración en el IDE

| Pieza | Cambio |
|---|---|
| `config/model-catalog.json` | entradas `qwen38-27b` y `qwen38-27b-perf-iq4` con `pensar.presupuesto: -1`, nivel `xhigh` y perfil medido |
| `models/hub-catalog.json` | registro local que escribe el Model Hub (no viaja en Git) |
| `config/llama-binaries.json` | binario `qwen38-sm89` |
| `scripts/start-gpu-model-rtx4060-optimized.ps1` | `gpu-parcial`: `-ngl` medido, `--load-mode mmap`, `--fit off`, `--cache-ram 512`, `--cache-recurrent-prefix`, `--reasoning-budget -1`, `--reasoning-effort xhigh`, MTP |
| `scripts/start-ui.ps1`, `scripts/start-server.ps1` | el lanzador oficial acepta presets optimizados y delega `gpu-parcial` al lanzador medido |
| `chat/bonsai-chat.mjs` | `-1` = pensamiento sin tope; `thinking_budget_tokens: -1`; esfuerzo por modelo |
| `chat/ui-server.mjs` | el ajuste del usuario manda sobre el preset; guarda el `pensar` real; cancelación honesta |
| `chat/ui/app.js`, `chat/ui/hub.js` | opción **Sin límite (Qwen3.8)** y avisos de razonamiento |

## 8. Límites conocidos

- **Texto primero.** La visión exige descargar `mmproj-BF16.gguf` (931 MiB) y
  cargarlo; con 16 GB de RAM hay que quitarle ese espacio a los pesos. Se puede
  activar subiendo el modelo a un quant menor, pero eso rompe el mínimo de 4
  bits. No se hace por defecto.
- **Contexto.** 32k es el equilibrio medido. Cada 8k extra de KV q8_0 cuesta
  ~270 MiB de VRAM, que salen de capas en GPU: más contexto = menos tok/s.
  El máximo práctico con este reparto es 65.536 tokens y deja el decode muy
  por debajo.
- **Pensamiento.** Qwen3.8 razona sin tope de tokens (`--reasoning-budget -1`,
  `thinking_budget_tokens: -1`) y con esfuerzo `xhigh`. El agente decide
  **cuándo** pensar (planificación y tras un fallo) para no convertir cada
  salto rutinario en minutos de espera; el tope total de salida del turno
  sigue aplicándose. El ajuste **Sin límite (Qwen3.8)** está en Ajustes →
  Modo razonamiento. `high` no es un nivel válido para esta plantilla
  (xhigh/medium/low). En una prueba, un plan de migración usó 9.523 tokens de
  una slice libre y tardó 25 minutos; para turnos rápidos elige 512/1024/2048.
- **Caché.** Los checkpoints son residentes, no persistentes tras reiniciar;
  el prefijo debe seguir siendo válido en el slot. Con `--cache-ram 512` caben
  3 checkpoints de 149,626 MiB; con 64 MiB el servidor avisa, no asigna
  checkpoint y reprocesa el prompt sin caerse.
- **Un solo slot.** MTP exige `--parallel 1`. No hay concurrencia: el IDE
  serializa los turnos, que es lo que ya hace.
