# Skyblock model benchmark: plan y estado

Objetivo: encontrar modelos que puedan crear proyectos reales en esta máquina
**sin quedarse en 7-9 tok/s**. La prueba es la misma isla Skyblock que se usó
con Qwen3.8: el prompt `PROMPT-PHASE1A.md` (esqueleto de 120 líneas), con
pensamiento libre, motor optimizado y verificación en navegador.

## Hardware

- RTX 4060 Laptop 8 GB.
- Ryzen 7 7840HS, 8c/16t, 16 GB RAM.
- Windows 10, llama.cpp sm89.
- Disco libre: ~148 GB.

## Métricas

Por modelo:

- **wall_ms** de la tarea completa (modelo ya cargado).
- **decode tok/s** y **prompt tok/s** de los eventos `speed`.
- **saltos** y tool calls.
- **éxito**: `index.html` existe, `THREE.REVISION === 149`, canvas visible,
  consola sin errores.
- **calidad**: captura y revisión breve (isla, cielo, cámara, overlay).
- **errores externos**: ninguno atribuible al harness.

## Matriz

### Ya instalados, MoE (candidatos fuertes)

| Modelo | Tamaño | Activos | Esperado |
| --- | ---: | ---: | ---: |
| GPT-OSS 20B | 12,1 GB | 3,6B | ~33 tok/s |
| Qwen3 30B-A3B 2507 | 11,8 GB | 3B | ~44 tok/s |
| Qwen3.6 35B-A3B | 12,3 GB | 3B | ~43 tok/s |
| Nemotron 3 Nano 30B-A3B | 18,1 GB | 3B | ~30 tok/s |

### Ya instalados, densos pequeños

Qwen3.5 9B, Qwen3 4B, Qwen3.8 4B, Gemma 4 E4B, Phi-4 Mini, Llama 3.2 3B,
SmolLM3 3B, Granite 4.0 Tiny, Qwen2.5 Coder 7B, Ornith 9B, K2-Horizon 7B,
DeepSeek-R1-Distill-Qwen-7B.

### Control lento

Qwen3.8 27B IQ4_XS: la referencia de 7,2 tok/s.

### Descargas nuevas

| Modelo | GGUF | Tamaño | Motivo |
| --- | --- | ---: | --- |
| Qwen3-Coder-30B-A3B | UD-Q4_K_XL | 16,45 GiB | MoE 3B activos, especialista en código |
| DeepSeek-Coder-V2-Lite | Q4_K_M | 9,65 GiB | MoE 2,4B activos, código |
| Qwen3-8B | Q4_K_M | 4,68 GiB | denso 8B, cabe casi entero en GPU |

No se incluyen densos >12B ni modelos >20 GB: no pueden cumplir el objetivo de
velocidad con 8 GB de VRAM y 16 GB de RAM.

## Estado

- [x] GPT-OSS arrancado con motor optimizado, MoE offload, 65K, free thinking.
- [x] Smoke test de herramienta: `saludo.txt` creado y leído, 33 tok/s.
- [ ] GPT-OSS Skyblock fase 1a.
- [ ] Benchmark de los instalados.
- [ ] Descarga de Qwen3-Coder-30B-A3B, DeepSeek-Coder-V2-Lite y Qwen3-8B.
- [ ] Benchmark de los descargados.
- [ ] Ranking, capturas y recomendación.

## Correcciones externas necesarias

- `start-server.ps1` no delegaba los modelos `moe-hibrido` al lanzador
  optimizado; GPT-OSS se rechazaba como “sin perfil de GPU completa”.
- El perfil de GPT-OSS pedía `optimized-sm89`, una ruta relativa al proyecto
  inexistente; se usa `optimized-sm89-user` (`%USERPROFILE%`).
- `configurationFromMarker()` rechazaba `pensar=-1`; impedía cambiar de modelo
  con pensamiento libre.
- El catálogo de GPT-OSS apuntaba a `gpt-oss-20b-MXFP4.gguf`, que no existe; el
  archivo real es `gpt-oss-20b-gpt-oss-20b-MXFP4.gguf`.
