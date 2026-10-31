# Optimización por modelo · 2026-10-31T01-37-28

| Modelo | Elegido | tg t/s | pp t/s | Variantes |
|---|---|---:|---:|---:|
| k2-horizon-7b-q4-k-m | error | - | - | - |
| gemma3-4b | ub 512 · t 4 · b 512 | 83.14 | 4256 | 2 |
| k2-horizon-7b-bartowski-q4-k-m | error | - | - | - |
| llama32-3b | ub 512 · t 4 · b 512 | 104.03 | 4937 | 2 |
| ornith9b | ub 512 · t 4 · b 512 | 42.77 | 1935 | 2 |
| qwen25-coder-7b | ub 512 · t 4 · b 512 | 52.25 | 2472 | 2 |
| qwen3-4b-2507 | ub 256 · t 4 · b 512 | 82.38 | 3703 | 2 |

## k2-horizon-7b-q4-k-m

ninguna variante de llama-bench arrancó

## gemma3-4b

- ub=256 t=4: pp 4198.1 · tg 83.18
- ub=512 t=4: pp 4255.5 · tg 83.14

## k2-horizon-7b-bartowski-q4-k-m

ninguna variante de llama-bench arrancó

## llama32-3b

- ub=256 t=4: pp 4964.0 · tg 103.87
- ub=512 t=4: pp 4936.6 · tg 104.03

## ornith9b

- ub=256 t=4: pp 1831.3 · tg 42.45
- ub=512 t=4: pp 1935.2 · tg 42.77

## qwen25-coder-7b

- ub=256 t=4: pp 2270.2 · tg 51.79
- ub=512 t=4: pp 2471.8 · tg 52.25

## qwen3-4b-2507

- ub=256 t=4: pp 3703.0 · tg 82.38
- ub=512 t=4: pp 3667.0 · tg 82.30
