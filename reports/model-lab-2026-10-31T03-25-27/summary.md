# Model Lab · 2026-10-31T03-25-27

| Modelo | Plan | Arranque | VRAM pico | Pruebas |
|---|---|---:|---:|---|
| lfm3-17b | 131072 tok · f16 | 3.1 s | 2791 MiB | 4/4 pruebas |

## lfm3-17b

- **saludo**: OK — BONSAI_OK
- **json**: OK — {"ok":true,"n":7}
- **codigo**: OK — function sumaPares(nums) {
  return nums.filter(num => num % 2 === 0).reduce((sum, num) => sum + num, 0);
}
- **herramienta**: OK — nativo: sumar({"a":17,"b":25})
