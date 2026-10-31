# Model Lab (sin visión) · 2026-10-31T05-05-33

| Modelo | Plan | Arranque | VRAM pico | Pruebas |
|---|---|---:|---:|---|
| lfm3-omni-2b | 128000 tok · f16 | 2.3 s | 2753 MiB | 4/4 pruebas |

## lfm3-omni-2b

- **saludo**: OK — BONSAI_OK
- **json**: OK — {"ok":true,"n":7}
- **codigo**: OK — function sumaPares(nums) {
  return nums.filter(num => num % 2 === 0).reduce((sum, num) => sum + num, 0);
}
- **herramienta**: OK — nativo: sumar({"a":17,"b":25})
