# Model Lab · 2026-10-31T08-07-15

| Modelo | Plan | Arranque | VRAM pico | Pruebas |
|---|---|---:|---:|---|
| qwen3-30b-a3b-2507 | 32768 tok · q8_0 | 8.2 s | 6863 MiB | 4/4 pruebas |

## qwen3-30b-a3b-2507

- **saludo**: OK — BONSAI_OK
- **json**: OK — {"ok":true,"n":7}
- **codigo**: OK — function sumaPares(nums) {
  return nums.reduce((acc, num) => num % 2 === 0 ? acc + num : acc, 0);
}
- **herramienta**: OK — nativo: sumar({"a": 17, "b": 25})
