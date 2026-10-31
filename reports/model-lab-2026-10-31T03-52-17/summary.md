# Model Lab (sin visión) · 2026-10-31T03-52-17

| Modelo | Plan | Arranque | VRAM pico | Pruebas |
|---|---|---:|---:|---|
| qwen35-4b | 131072 tok · f16 | 3.9 s | 7117 MiB | 4/4 pruebas |

## qwen35-4b

- **saludo**: OK — BONSAI_OK
- **json**: OK — {"ok":true,"n":7}
- **codigo**: OK — function sumaPares(nums) {
  return nums.reduce((acc, num) => num % 2 === 0 ? acc + num : acc, 0);
}
- **herramienta**: OK — nativo: sumar({"a":17,"b":25})
