# Model Lab · 2026-10-31T03-45-59

| Modelo | Plan | Arranque | VRAM pico | Pruebas |
|---|---|---:|---:|---|
| qwen38-4b-distill | 131072 tok · f16 | 3.8 s | 7087 MiB | 4/4 pruebas |

## qwen38-4b-distill

- **saludo**: OK — BONSAI_OK
- **json**: OK — {"ok":true,"n":7}
- **codigo**: OK — function sumaPares(nums) {
  return nums.reduce((acc, num) => acc + (num % 2 === 0 ? num : 0), 0);
}
- **herramienta**: OK — nativo: sumar({"a":17,"b":25})
