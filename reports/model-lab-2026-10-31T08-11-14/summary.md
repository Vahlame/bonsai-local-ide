# Model Lab · 2026-10-31T08-11-14

| Modelo | Plan | Arranque | VRAM pico | Pruebas |
|---|---|---:|---:|---|
| gpt-oss-20b | 32768 tok · q8_0 | 9.1 s | 6045 MiB | 4/4 pruebas |

## gpt-oss-20b

- **saludo**: OK — BONSAI_OK
- **json**: OK — {"ok":true,"n":7}
- **codigo**: OK — function sumaPares(nums) {
  return nums.reduce((acc, num) => (num % 2 === 0 ? acc + num : acc), 0);
}
- **herramienta**: OK — nativo: sumar({"a":17,"b":25})
