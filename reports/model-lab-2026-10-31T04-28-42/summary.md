# Model Lab (sin visión) · 2026-10-31T04-28-42

| Modelo | Plan | Arranque | VRAM pico | Pruebas |
|---|---|---:|---:|---|
| qwen25vl-3b | 128000 tok · f16 | 3.1 s | 6543 MiB | 3/4 pruebas |

## qwen25vl-3b

- **saludo**: OK — BONSAI_OK
- **json**: OK — {"ok":true,"n":7}
- **codigo**: OK — function sumaPares(nums) {
  return nums.filter(n => n % 2 === 0).reduce((acc, n) => acc + n, 0);
}
- **herramienta**: FALLO — ```python
def sumar(a, b):
    return a + b

resultado = sumar(17, 25)
print(resultado)
```
