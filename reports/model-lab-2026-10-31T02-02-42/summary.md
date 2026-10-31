# Model Lab · 2026-10-31T02-02-42

| Modelo | Plan | Arranque | VRAM pico | Pruebas |
|---|---|---:|---:|---|
| qwen25-coder-7b | 32768 tok · f16 | 6.1 s | 6945 MiB | 5/5 pruebas |

## qwen25-coder-7b

- **saludo**: OK — BONSAI_OK
- **json**: OK — {"ok":true,"n":7}
- **codigo**: OK — function sumaPares(nums) {
  return nums.filter(num => num % 2 === 0).reduce((acc, num) => acc + num, 0);
}
- **herramienta**: OK — function-call: sumar({"a":17,"b":25})
- **contexto8k**: OK — CLAVE-7391
