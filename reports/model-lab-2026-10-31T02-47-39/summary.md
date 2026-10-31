# Model Lab · 2026-10-31T02-47-39

| Modelo | Plan | Arranque | VRAM pico | Pruebas |
|---|---|---:|---:|---|
| k2-horizon-7b-q4-k-m | 18432 tok · q8_0 | 7.6 s | 6363 MiB | 3/5 pruebas |
| deepseek-r1-qwen7b | 79872 tok · q8_0 | 6.0 s | 6865 MiB | 4/5 pruebas |
| gemma3-4b | 131072 tok · f16 · visión CPU | 7.6 s | 5769 MiB | 5/6 pruebas |
| k2-horizon-7b-bartowski-q4-k-m | 16384 tok · q8_0 | 7.4 s | 6377 MiB | 3/5 pruebas |
| llama32-3b | 83968 tok · q8_0 | 4.4 s | 7345 MiB | 5/5 pruebas |
| ornith9b | 110592 tok · q8_0 · visión CPU | 7.6 s | 7475 MiB | 6/6 pruebas |
| qwen25-coder-7b | 32768 tok · f16 | 7.4 s | 7065 MiB | 5/5 pruebas |
| qwen3-4b-2507 | 57344 tok · q8_0 | 5.4 s | 7215 MiB | 5/5 pruebas |

## k2-horizon-7b-q4-k-m

- **saludo**: FALLO — 
- **json**: FALLO — 
- **codigo**: OK — function sumaPares(nums) {
  return nums.reduce((sum, num) => sum + (num % 2 === 0 ? num : 0), 0);
}
- **herramienta**: OK — nativo: sumar({"a":17,"b":25})
- **contexto8k**: OK — CLAVE-7391

## deepseek-r1-qwen7b

- **saludo**: OK — 

</think>

BONSAI_OK
- **json**: OK — 

</think>

```json
{"ok":true,"n":7}
```
- **codigo**: OK — function sumaPares(nums) {
    return nums.reduce((acc, num) => num % 2 === 0 ? acc + num : acc, 0);
}
- **herramienta**: FALLO — 

</think>

Para calcular \(17 + 25\) usando la herramienta de suma, seguiremos estos pasos:

1. **Sumar las decenas:**
   \[
   10 + 20 = 30
   \]

2. **Sumar 
- **contexto8k**: OK — 

La clave de despliegue es CLAVE-7391.
</think>

CLAVE-7391

## gemma3-4b

- **saludo**: OK — BONSAI_OK

- **json**: OK — ```json
{"ok":true,"n":7}
```

- **codigo**: OK — function sumaPares(nums) {
  let suma = 0;
  for (let i = 0; i < nums.length; i++) {
    if (nums[i] % 2 === 0) {
      suma += nums[i];
    }
  }
  return suma;
}
- **herramienta**: FALLO — ```python
def sumar(a, b):
  """Calcula la suma de dos números.

  Args:
    a: El primer número.
    b: El segundo número.

  Returns:
    La suma de a y b.
  
- **contexto8k**: OK — CLAVE-7391

- **vision**: OK — La imagen muestra una ventana de terminal de Linux con una lista de archivos y directorios, probablemente un entorno de desarrollo o un sistema de archivos.

## k2-horizon-7b-bartowski-q4-k-m

- **saludo**: FALLO — 
- **json**: OK — {"ok":true,"n":7}
- **codigo**: FALLO — 
- **herramienta**: OK — nativo: sumar({"a":17,"b":25})
- **contexto8k**: OK — CLAVE-7391

## llama32-3b

- **saludo**: OK — BONSAI_OK
- **json**: OK — {"ok":true,"n":7}
- **codigo**: OK — function sumaPares(nums) {
  return nums.filter(num => num % 2 === 0).reduce((a, b) => a + b, 0);
}
- **herramienta**: OK — nativo: sumar({"a": 17, "b": 25})
- **contexto8k**: OK — CLAVE-7391

## ornith9b

- **saludo**: OK — BONSAI_OK
- **json**: OK — {"ok":true,"n":7}
- **codigo**: OK — function sumaPares(nums) {
  return nums.reduce((acc, n) => acc + (n % 2 === 0 ? n : 0), 0);
}
- **herramienta**: OK — nativo: sumar({"a":17,"b":25})
- **contexto8k**: OK — CLAVE-7391
- **vision**: OK — Interfaz de una aplicación de IA llamada Bonsai mostrando un explorador de archivos con una lista de archivos y carpetas del proyecto.

## qwen25-coder-7b

- **saludo**: OK — BONSAI_OK
- **json**: OK — {"ok":true,"n":7}
- **codigo**: OK — function sumaPares(nums) {
  return nums.filter(num => num % 2 === 0).reduce((acc, num) => acc + num, 0);
}
- **herramienta**: OK — function-call: sumar({"a":17,"b":25})
- **contexto8k**: OK — CLAVE-7391

## qwen3-4b-2507

- **saludo**: OK — BONSAI_OK
- **json**: OK — {"ok":true,"n":7}
- **codigo**: OK — function sumaPares(nums) {
  return nums.filter(num => num % 2 === 0).reduce((acc, num) => acc + num, 0);
}
- **herramienta**: OK — nativo: sumar({"a": 17, "b": 25})
- **contexto8k**: OK — CLAVE-7391
