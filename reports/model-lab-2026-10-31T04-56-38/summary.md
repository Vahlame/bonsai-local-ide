# Model Lab (sin visión) · 2026-10-31T04-56-38

| Modelo | Plan | Arranque | VRAM pico | Pruebas |
|---|---|---:|---:|---|
| ornith9b | 110592 tok · q8_0 | 6.1 s | 7475 MiB | 4/4 pruebas |

## ornith9b

- **saludo**: OK — BONSAI_OK
- **json**: OK — {"ok":true,"n":7}
- **codigo**: OK — function sumaPares(nums) {
  return nums.reduce((acc, n) => acc + (n % 2 === 0 ? n : 0), 0);
}
- **herramienta**: OK — nativo: sumar({"a":17,"b":25})
