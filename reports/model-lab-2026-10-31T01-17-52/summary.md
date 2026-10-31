# Model Lab · 2026-10-31T01-17-52

| Modelo | Plan | Arranque | VRAM pico | Pruebas |
|---|---|---:|---:|---|
| llama32-3b | 83968 tok · q8_0 | 3.7 s | 7289 MiB | 5/5 pruebas |

## llama32-3b

- **saludo**: OK — BONSAI_OK
- **json**: OK — {"ok":true,"n":7}
- **codigo**: OK — function sumaPares(nums) {
  return nums.filter(num => num % 2 === 0).reduce((a, b) => a + b, 0);
}
- **herramienta**: OK — sumar({"a": 17, "b": 25})
- **contexto8k**: OK — CLAVE-7391
