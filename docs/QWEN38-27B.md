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
`--load-mode mmap`. `--cache-ram 0` evita que la caché de prompts se coma la RAM
que necesitan esas capas.

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

El build de referencia de este documento es el commit `dde879b` (master,
2026-11-01), CUDA 12.9.1, `-DCMAKE_CUDA_ARCHITECTURES=89-real`.

Sale en `.local/opt/bonsai-inference/build-Qwen38-sm89/bin/llama-server.exe` y
se registra en `config/llama-binaries.json` con el id `qwen38-sm89`. El perfil
del modelo lo selecciona con `servidor.binario`; el resto de modelos sigue
usando el binario optimizado.

## 5. Arranque

Desde el IDE: **Model Hub → Qwen3.8 27B → Iniciar**. El plan medido
(`gpu-parcial`) fija contexto 32.768, KV `q8_0`, `ngl` y MTP; no hay que tocar
presets.

Equivalente por consola:

```powershell
& "$env:USERPROFILE\.local\opt\bonsai-inference\build-Qwen38-sm89\bin\llama-server.exe" `
  -m models\Qwen3.8-27B-UD-IQ4_XS.gguf `
  -ngl <ngl> -c 32768 -ctk q8_0 -ctv q8_0 -fa on `
  -b 512 -ub 256 -t 8 --fit off --load-mode mmap --cache-ram 0 `
  --spec-type draft-mtp --spec-draft-n-max 2 --parallel 1 `
  --jinja --metrics --no-context-shift --ctx-checkpoints 0 `
  --host 127.0.0.1 --port 8080
```

## 6. Medido en esta máquina

| Métrica | Valor |
|---|---:|
| Carga (GGUF frío → `/health`) | `<pendiente>` |
| VRAM estable | `<pendiente>` |
| RAM del proceso | `<pendiente>` |
| Decode sin MTP | `<pendiente>` tok/s |
| Decode con MTP (`n-max 2`) | `<pendiente>` tok/s |
| Prefill 2k | `<pendiente>` tok/s |
| TTFT con prompt de 2k | `<pendiente>` ms |
| Aceptación MTP | `<pendiente>` |

Reproducir:

```powershell
node scripts\benchmark-local-engine.mjs --base-url http://127.0.0.1:8080 --quick `
  --out reports\qwen38-27b-engine.json
```

## 7. Integración en el IDE

| Pieza | Cambio |
|---|---|
| `config/model-catalog.json` | entrada `qwen38-27b` con repo, bytes, revisión y perfil medido |
| `models/hub-catalog.json` | registro local que escribe el Model Hub (no viaja en Git) |
| `config/llama-binaries.json` | binario `qwen38-sm89` |
| `scripts/start-gpu-model-rtx4060-optimized.ps1` | tipo `gpu-parcial`: `-ngl` medido, `--load-mode mmap`, `--fit off`, `--cache-ram 0`, MTP |
| `chat/model-hub.mjs` | el perfil `gpu-parcial` se conserva al volver a registrar el GGUF |
| `chat/modelo.mjs` | el techo de VRAM cuenta solo los pesos que van a la GPU |
| `chat/ui-server.mjs` | `gpu-parcial` es un modelo iniciable |

## 8. Límites conocidos

- **Texto primero.** La visión exige descargar `mmproj-BF16.gguf` (931 MiB) y
  cargarlo; con 16 GB de RAM hay que quitarle ese espacio a los pesos. Se puede
  activar subiendo el modelo a un quant menor, pero eso rompe el mínimo de 4
  bits. No se hace por defecto.
- **Contexto.** 32k es el equilibrio medido. Cada 8k extra de KV q8_0 cuesta
  ~270 MiB de VRAM, que salen de capas en GPU: más contexto = menos tok/s.
  El máximo práctico con este reparto es 65.536 tokens y deja el decode muy
  por debajo.
- **Pensamiento.** Qwen3.8 razona por defecto. El IDE manda
  `enable_thinking: false` en los turnos rutinarios y `reasoning_effort:
  medium` cuando se pide pensar. `high` no es un nivel válido para esta
  plantilla (xhigh/medium/low).
- **Un solo slot.** MTP exige `--parallel 1`. No hay concurrencia: el IDE
  serializa los turnos, que es lo que ya hace.
