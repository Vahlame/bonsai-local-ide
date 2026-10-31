# Model Lab · 2026-10-31T04-47-36

| Modelo | Plan | Arranque | VRAM pico | Pruebas |
|---|---|---:|---:|---|
| granite40-tiny | 131072 tok · f16 | 6.2 s | 5597 MiB | 4/4 pruebas |

## granite40-tiny

- **saludo**: OK — BONSAI_OK
- **json**: OK — {"ok":true,"n":7}
- **codigo**: OK — function sumaPares(nums) {
  return nums.filter(num => num % 2 === 0).reduce((sum, num) => sum + num, 0);
}
- **herramienta**: OK — nativo: sumar({"a": 17, "b": 25})
