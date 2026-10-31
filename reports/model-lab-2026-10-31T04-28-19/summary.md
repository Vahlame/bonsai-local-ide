# Model Lab · 2026-10-31T04-28-19

| Modelo | Plan | Arranque | VRAM pico | Pruebas |
|---|---|---:|---:|---|
| qwen25vl-3b | 128000 tok · f16 · visión CPU | 6.8 s | 6543 MiB | 4/5 pruebas |

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
- **vision**: OK — En la imagen se ve un explorador de archivos con varios archivos y carpetas, incluyendo "chat/modelo.js" y "chat/variables.js".
