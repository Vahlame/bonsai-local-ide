# Model Lab (sin visión) · 2026-10-31T03-31-16

| Modelo | Plan | Arranque | VRAM pico | Pruebas |
|---|---|---:|---:|---|
| minicpm-v47-1b | 131072 tok · f16 | 2.3 s | 2305 MiB | 4/4 pruebas |

## minicpm-v47-1b

- **saludo**: OK — BONSAI_OK
- **json**: OK — {
  "ok": true,
  "n": 7
}
- **codigo**: OK — function sumaPares(nums) {
  return nums.filter(n => n % 2 === 0).reduce((a, b) => a + b);
}
- **herramienta**: OK — nativo: sumar({"a":17,"b":25})
