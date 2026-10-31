# Model Lab (sin visión) · 2026-10-31T03-50-08

| Modelo | Plan | Arranque | VRAM pico | Pruebas |
|---|---|---:|---:|---|
| qwen3vl-4b | 57344 tok · q8_0 | 3.1 s | 7069 MiB | 4/4 pruebas |

## qwen3vl-4b

- **saludo**: OK — BONSAI_OK
- **json**: OK — {"ok":true,"n":7}
- **codigo**: OK — function sumaPares(nums) {
    return nums.filter(n => n % 2 === 0).reduce((acc, n) => acc + n, 0);
}
- **herramienta**: OK — nativo: sumar({"a": 17, "b": 25})
