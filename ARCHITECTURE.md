# Arquitectura — RTX 4060 LLM lab

La pila es deliberadamente fina. **No se reimplementa un motor de inferencia**:
se usa llama.cpp, se mide, y se reemplazan/ajustan solo las capas donde hay una
ganancia demostrada.

```
┌─────────────────────────────────────────────────────────────────┐
│  UI / Open WebUI / Continue / Cline / Aider / scripts           │
│  OpenAI-compatible: /v1/models, /v1/chat/completions, /v1/completions
└──────────────────────────────┬──────────────────────────────────┘
                               │ HTTP + SSE
┌──────────────────────────────▼──────────────────────────────────┐
│  llama-server  (tools/server)                                    │
│  tokenizer · slot · prompt cache · streaming · OpenAI adapter    │
└──────────────────────────────┬──────────────────────────────────┘
                               │ llama_decode / llama_sampler
┌──────────────────────────────▼──────────────────────────────────┐
│  llama.cpp core (src/)                                           │
│  graph builder · KV cache · sampling · backend scheduler         │
└───────────────┬───────────────────────────────┬─────────────────┘
                │ CUDA                          │ CPU (MoE experts)
┌───────────────▼───────────────┐   ┌───────────▼─────────────────┐
│  ggml-cuda                     │   │  ggml-cpu + RAM              │
│  MMQ (prefill) · MMVQ (decode) │   │  expert FFN layers           │
│  FlashAttention · norms · rope │   │  (--n-cpu-moe N)             │
└───────────────┬───────────────┘   └───────────┬─────────────────┘
                │                               │
┌───────────────▼───────────────────────────────▼─────────────────┐
│  RTX 4060 8 GB · 24 SM · 244 GB/s · PCIe 4.0 x8 · 80 W           │
│  Ryzen 7 7840HS · 8C/16T · 16 GB DDR5-5600 · NVMe 4.3 GB/s       │
└─────────────────────────────────────────────────────────────────┘
```

## Capas del repositorio

| Capa | Ruta | Responsabilidad |
|---|---|---|
| Interfaz | `chat/` | UI, agente, editor, terminal, OpenAI client |
| Servidor | `llama-server` (externo) | API OpenAI, slots, cache de prompt, streaming |
| Launcher | `scripts/start-gpu-model-rtx4060-optimized.ps1` | elige binario, KV, contexto, reparto MoE, hilos |
| Presupuesto | `runtime/rtxllm.py` | estima VRAM/RAM y valida el perfil antes de arrancar |
| Perfiles | `profiles/*.json`, `config/measured-moe-profiles.json` | configuración medida por modelo/contexto |
| Bench | `bench/` | inventario, llama-bench, servidor, calidad, charts |
| Runtime | `forks/llama.cpp-4060` | fork local de llama.cpp (worktree) |
| Kernel lab | `forks/patches/`, `kernels/` | parches y sondas CUDA |

## Por qué prefill y decode usan rutas distintas

- **Prefill:** matrices grandes; llama.cpp elige `mul_mat_q` (MMQ) y
  FlashAttention. Es compute-bound y consume los 80 W.
- **Decode:** batch 1; llama.cpp elige `mul_mat_vec_q` (MMVQ) para pesos
  cuantizados. Es memory-bound: 88% del tiempo de GPU es GEMV.
- **MoE:** el router y la atención están en GPU; las capas de expertos
  `--n-cpu-moe` se ejecutan en CPU. El límite es CPU/RAM, no VRAM.

El parche `lab-mvq2` cambia **solo** el launch shape de MMVQ para K-quants en
sm_89; no toca prefill ni MoE.

## Memoria

El presupuesto seguro es **7,600 MiB** de los 8,188 MiB. La diferencia queda
para el compositor, el driver, el contexto CUDA y los buffers temporales.
`runtime/rtxllm.py budget` muestra el desglose; para los MoE medidos usa el pico
real de `nvidia-smi`, no una fórmula.

La tabla `config/measured-moe-profiles.json` es la fuente de verdad para:

- GPT-OSS-20B: 32k/64k/96k/128k → 11/12/13/14 capas CPU.
- Qwen3.6-35B-A3B: 32k/64k → 19/21 capas CPU.
- Qwen3-30B-A3B: 32k → 26 capas CPU.

Si otra app usa la dGPU, el launcher suma capas CPU automáticamente para
mantener el margen.

## Perfiles

`profiles/<modelo>.json` contiene `balanced`, `max_speed`, `max_quality`,
`long_context` y `max_model`, cada uno con contexto, KV, reparto, hilos,
batch/ubatch y métricas esperadas. `runtime/rtxllm.py plan` imprime el perfil y
`command` imprime la línea exacta de llama-server.

## Compatibilidad

El servidor es OpenAI-compatible; no se acopla a la UI. Se puede usar desde
Open WebUI, Continue, Cline, Aider o scripts. La UI del proyecto es solo un
cliente. El motor y la API están separados de la UI.

## Lo que no se hizo (a propósito)

- No se reescribió el motor ni el scheduler.
- No se implementaron kernels FlashAttention nuevos: el 26% del prefill ya está
  en `fattn-mma-f16` y no se encontró una ganancia clara.
- No se tocaron clocks, voltajes, BIOS ni firmware.
- No se usó vLLM/TensorRT-LLM/ExLlamaV2 en Windows nativo: no son viables en
  este entorno y no se finge que se midieron.
