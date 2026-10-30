# Complex project benchmark - 20261030194958

Proyecto multi-archivo (`taskforge`) generado por el modelo y validado ejecutando `node --test`.
Reps: 2 · pensamiento 2048 · max_tokens 8000 · vision on

| Perfil | Files | Tests | Pass | Fail | % | Todo OK | Vision |
|---|---:|---:|---:|---:|---:|:--:|:--:|
| 8GB-VISION-MAX-Q8 · T0.6 p0.90 k20 m0.05 | 10 | 18 | 6 | 12 | 33% | no | fail |
| 8GB-VISION-MAX-F16 · T0.6 p0.90 k20 m0.05 | 10 | 14 | 8 | 6 | 57% | no | fail |
| 8GB-VISION-MAX-Q4 · T0.6 p0.90 k20 m0.05 | 10 | 9 | 2 | 7 | 22% | no | fail |

## Detalle


### 8GB-VISION-MAX-Q8 · T0.6 p0.90 k20 m0.05

- run 1: files=5 tests=9 pass=2 fail=7 exit=1 gen_tokens=4524 
- run 2: files=5 tests=9 pass=4 fail=5 exit=1 gen_tokens=4352 
- vision: fail — error: HTTP 500: {"error":{"code":500,"message":"failed to process mtmd chunk","type":"

### 8GB-VISION-MAX-F16 · T0.6 p0.90 k20 m0.05

- run 1: files=5 tests=9 pass=4 fail=5 exit=1 gen_tokens=4729 
- run 2: files=5 tests=5 pass=4 fail=1 exit=1 gen_tokens=4295 
- vision: fail — Paneles/zonas visibles: **Encabezado del panel (MODELO Y RESPUESTA)**, Perfil de muestreo, Agente, Modo de respuesta, Motor · reinicia el modelo (con botón "Apl

### 8GB-VISION-MAX-Q4 · T0.6 p0.90 k20 m0.05

- run 1: files=5 tests=9 pass=2 fail=7 exit=1 gen_tokens=4526 
- run 2: files=5 tests=0 pass=0 fail=0 exit=1 gen_tokens=4733 
- vision: fail — error: HTTP 500: {"error":{"code":500,"message":"failed to process mtmd chunk","type":"