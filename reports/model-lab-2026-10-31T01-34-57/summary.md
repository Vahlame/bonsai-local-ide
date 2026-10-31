# Model Lab · 2026-10-31T01-34-57

| Modelo | Plan | Arranque | VRAM pico | Pruebas |
|---|---|---:|---:|---|
| gemma3-4b | 131072 tok · f16 · visión CPU | 4.6 s | 5635 MiB | 5/6 pruebas |

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
