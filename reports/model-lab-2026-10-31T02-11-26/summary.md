# Model Lab · 2026-10-31T02-11-26

| Modelo | Plan | Arranque | VRAM pico | Pruebas |
|---|---|---:|---:|---|
| qwen3-4b-2507 | 57344 tok · q8_0 | 3.8 s | 7039 MiB | 4/4 pruebas |

## qwen3-4b-2507

- **saludo**: OK — BONSAI_OK
- **json**: OK — {"ok":true,"n":7}
- **codigo**: OK — function sumaPares(nums) {
  return nums.filter(num => num % 2 === 0).reduce((acc, num) => acc + num, 0);
}
- **herramienta**: OK — nativo: sumar({"a": 17, "b": 25})
