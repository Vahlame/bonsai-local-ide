# Model Lab (sin visión) · 2026-10-31T06-49-17

| Modelo | Plan | Arranque | VRAM pico | Pruebas |
|---|---|---:|---:|---|
| qwen36-35b-a3b | 32768 tok · q8_0 | 9.3 s | 6835 MiB | 4/4 pruebas |

## qwen36-35b-a3b

- **saludo**: OK — BONSAI_OK
- **json**: OK — {"ok":true,"n":7}

- **codigo**: OK — function sumaPares(nums) {
  return nums.filter(n => n % 2 === 0).reduce((acc, n) => acc + n, 0);
}
- **herramienta**: OK — nativo: sumar({"a":17,"b":25})
