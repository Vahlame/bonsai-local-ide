# Model Lab · 2026-10-31T01-43-46

| Modelo | Plan | Arranque | VRAM pico | Pruebas |
|---|---|---:|---:|---|
| k2-horizon-7b-q4-k-m | 18432 tok · q8_0 | 7.5 s | 6363 MiB | 2/4 pruebas |

## k2-horizon-7b-q4-k-m

- **saludo**: FALLO — 
- **json**: FALLO — 
- **codigo**: OK — function sumaPares(nums) {
  return nums.reduce((sum, num) => sum + (num % 2 === 0 ? num : 0), 0);
}
- **herramienta**: OK — nativo: sumar({"a":17,"b":25})
