# Model Lab (sin visión) · 2026-10-31T04-27-16

| Modelo | Plan | Arranque | VRAM pico | Pruebas |
|---|---|---:|---:|---|
| qwen35-9b | 131072 tok · q8_0 | 6.1 s | 7121 MiB | 4/4 pruebas |

## qwen35-9b

- **saludo**: OK — BONSAI_OK
- **json**: OK — {"ok":true,"n":7}
- **codigo**: OK — function sumaPares(nums) {
  return nums.filter(n => n % 2 === 0).reduce((a, b) => a + b, 0);
}
- **herramienta**: OK — nativo: sumar({"a":17,"b":25})
