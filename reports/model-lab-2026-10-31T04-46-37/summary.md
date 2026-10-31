# Model Lab (sin visión) · 2026-10-31T04-46-37

| Modelo | Plan | Arranque | VRAM pico | Pruebas |
|---|---|---:|---:|---|
| nemotron35-e4b | 36864 tok · q8_0 | 3.9 s | 2709 MiB | 4/4 pruebas |

## nemotron35-e4b

- **saludo**: OK — BONSAI_OK
- **json**: OK — {"ok":true,"n":7}
- **codigo**: OK — function sumaPares(nums) {
  return nums.reduce((sum, num) => (num % 2 === 0 ? sum + num : sum), 0);
}
- **herramienta**: OK — nativo: sumar({"a":17,"b":25})
