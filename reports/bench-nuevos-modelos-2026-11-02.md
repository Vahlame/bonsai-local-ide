# Benchmark de los dos modelos nuevos — 2026-11-02

Máquina: RTX 4060 Laptop 8 GB, Ryzen 7 7840HS, Windows 11. Runtime base:
`bin/llama-server.exe` (b10743) y, para el ternario, el fork PrismML
`prism-b10822` (b10822, CUDA 12.4) instalado en
`.local/opt/bonsai-inference/prism-b10822/bin/`.

Regla aplicada: si la generación no llega a **20 tok/s**, se reporta la medición
y **no** se ejecuta el benchmark de calidad.

## 1. Qwen3.8 27B TURBO Fable Cold Fusion — LOW-MTP IQ4_XS

- Repo: `DavidAU/Qwen3.8-27B-TURBO-Fable-Cold-Fusion-735-882-Heretic-Uncensored-NEO-CODER-MAX-MTP-GGUF`
- Archivo: `models/qwen38-27b-fable-cold-fusion-low-mtp-iq4_xs.gguf` (15 309 039 136 B)
- Clave IDE: `qwen38-27b-fable-cold-fusion-low-mtp-iq4-xs`
- Perfil: `gpu-parcial`, 24/65 capas en VRAM, KV q4_0, 16 384 tok, 8 hilos.
- Comando: `llama-bench -m <gguf> -ngl 24 -t 8 -p 512 -n 128 -r 3 -ctk q4_0 -ctv q4_0 -fa on`
- Resultado: **2,62 tok/s** (mediana de tg128).
- Decisión: **por debajo del umbral de 20 tok/s**. Se reporta y **no se ejecuta
  el benchmark de calidad**.

El modelo no cabe entero en 8 GB. El resto de capas va por mmap/CPU y el decode
cae a ~2,6 tok/s; no es interactivo para el agente en esta GPU. Con más VRAM
(24 GB o más) el mismo GGUF debería ser mucho más rápido, pero eso no se midió
aquí.

Evidencia: `reports/bench-qwen38-fable-low-mtp.json`.

## 2. Ternary Bonsai 2 27B — PTQ1_0

- Repo: `prism-ml/Ternary-Bonsai-2-27B-gguf`
- Archivo: `models/Ternary-Bonsai-2-27B-PTQ1_0.gguf` (5 946 648 928 B)
- Clave IDE: `ternary-bonsai-2-27b-ptq1-0`
- Runtime: **PrismML b10822** (`servidor.binario = prism-b10822`). El llama.cpp
  stock rechaza el tipo de tensor ternario (`invalid ggml type 143`).
- Perfil: GPU completa, 24 576 tok, KV q8_0, 8 hilos, sin visión.
- Velocidad (`llama-bench`, ngl 99, -p 512 -n 128, q4_0): **27,64 tok/s**.
- VRAM pico medida por `model-lab`: **7 013 MiB**; arranque 11,3 s.
- Benchmark de calidad (`model-lab probe`, sin visión): **4/5**.

| Prueba | Resultado | TTFT | tok/s |
|---|---|---:|---:|
| saludo (`BONSAI_OK`) | OK | 363 ms | 25,51 |
| JSON exacto | OK | 202 ms | 30,66 |
| código `sumaPares` | OK | 255 ms | 32,98 |
| tool calling nativo `sumar(17,25)` | OK | 636 ms | 18,41 |
| retrieval 8k (aguja `CLAVE-7391`) | FALLO | 9 773 ms | 6,63 |

El retrieval 8k se quedó sin respuesta con el tope de 80 tokens del arnés; el
modelo es de razonamiento y puede gastar el hueco antes de contestar. No se
interpreta como una regresión del modelo, pero queda anotado y no se maquilla.
La velocidad de generación sostenida sí supera el umbral (27,64 tok/s), así que
el benchmark de calidad se ejecutó.

Evidencia: `reports/model-lab-2026-11-03T05-13-00/ternary-bonsai-2-27b-ptq1-0-sin-vision.json`
y `reports/bench-ternary-bonsai-ptq1.json`.

## Conclusión

- **Ternary Bonsai 2 27B PTQ1_0**: viable en la RTX 4060 con el runtime PrismML;
  27,6 tok/s de generación y 4/5 pruebas. Es el único de los dos que se puede
  recomendar para el agente en esta máquina.
- **Qwen3.8 27B Fable Cold Fusion LOW-MTP IQ4_XS**: no viable a 20 tok/s en 8 GB;
  se deja instalado y catalogado como `gpu-parcial`, pero no se usa como modelo
  principal ni se le ejecuta el benchmark de calidad.
