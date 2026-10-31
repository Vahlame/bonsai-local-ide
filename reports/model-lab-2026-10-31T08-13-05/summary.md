# Model Lab · 2026-10-31T08-13-05

| Modelo | Plan | Arranque | VRAM pico | Pruebas |
|---|---|---:|---:|---|
| nemotron3-nano-30b | 32768 tok · q8_0 | 7.6 s | 6905 MiB | 2/4 pruebas |

## nemotron3-nano-30b

- **saludo**: FALLO — 
- **json**: OK — {"ok":true,"n":7}
- **codigo**: OK — function sumaPares(nums) {
  return nums.filter(n => n % 2 === 0).reduce((acc, n) => acc + n, 0);
}
- **herramienta**: FALLO — 
