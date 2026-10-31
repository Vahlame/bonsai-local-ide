# Model Lab (sin visión) · 2026-10-31T04-56-28

| Modelo | Plan | Arranque | VRAM pico | Pruebas |
|---|---|---:|---:|---|
| gemma3-4b | 131072 tok · f16 | 4.7 s | 5769 MiB | 3/4 pruebas |

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
  
