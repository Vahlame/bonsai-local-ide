# Hardware — Acer Nitro AN16-41

El inventario completo, con métodos y valores crudos, está en
[`hardware_report.md`](hardware_report.md) y [`machine_profile.json`](machine_profile.json).
Este documento es el resumen operativo.

| Componente | Valor |
|---|---|
| GPU | NVIDIA GeForce RTX 4060 Laptop GPU, Ada, `sm_89` |
| SMs / CUDA cores | 24 / 3,072 |
| Tensor Cores | 96 (4ª gen) |
| VRAM | 8,188 MiB (7,956 MiB libres en reposo) |
| Bus / reloj | 128-bit GDDR6, 7,851 MHz |
| VRAM teórica | 251.2 GB/s |
| **VRAM medida (lectura)** | **245.0 GB/s** (rango 244.2–245.0; 97.5% del teórico) |
| PCIe | 4.0 x8, ~13.3 GB/s H2D/D2H pinned |
| Resizable BAR | Sí (BAR1 8,192 MiB) |
| Power limit | 80 W (default 80, máximo 140) |
| Driver / CUDA | 617.14 / UMD 13.4 / toolkit 12.9.1 |
| CPU | AMD Ryzen 7 7840HS, Zen 4, 8C/16T |
| Cachés | L1 32+32 KiB/core, L2 8 MiB, L3 16 MiB |
| SIMD | AVX2, FMA, AVX-512F/BW/CD/DQ/VL (`/arch:AVX512`) |
| RAM | 16 GB (2×8) DDR5-5600, dual channel |
| RAM medida | 53.4 GB/s (`winsat mem`) |
| Almacenamiento | HFS001TEJ9X125N NVMe 1 TB, 4.3 GB/s seq read |
| OS | Windows 10 Enterprise LTSC 19044 |
| Power plan | High performance |

## Lo que estos números implican

- **Decode denso = ancho de banda.** Un 9B Q4 de 5.38 GiB no puede pasar de
  ~42 tok/s (244.2 / 5.77 GB). Se midieron 43.4 tok/s, es decir, 102.6% del
  límite de copia/lectura (el read-only real es ligeramente superior).
- **Prefill = potencia y Tensor Cores.** A 80 W, el 4B hace 4,200 tok/s de
  prefill; el límite es el board power, no la VRAM.
- **MoE = CPU + RAM.** GPT-OSS-20B con 12 capas de expertos en CPU usa ~315% de
  CPU, 22% de GPU y 27 W. El limitante es el Ryzen y la RAM, no PCIe.
- **No se cambia el power limit.** El máximo de 140 W existe, pero subirlo es
  una decisión térmica/de BIOS que este proyecto no ejecuta. Si el usuario
  activa el modo performance del portátil, los números de prefill pueden subir;
  no se asume.

## Reproducir

```powershell
python bench\inventory.py
powershell -ExecutionPolicy Bypass -File scripts\build-machine-probes.ps1
.\bin\probes\bandwidth.exe --size-mb 512 --json bench\results\bandwidth.json
```
