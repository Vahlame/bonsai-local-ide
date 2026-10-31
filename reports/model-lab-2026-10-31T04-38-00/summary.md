# Model Lab (sin visión) · 2026-10-31T04-38-00

| Modelo | Plan | Arranque | VRAM pico | Pruebas |
|---|---|---:|---:|---|
| qwen3vl-8b | 26624 tok · q8_0 | 3.8 s | 6747 MiB | 4/4 pruebas |

## qwen3vl-8b

- **saludo**: OK — BONSAI_OK
- **json**: OK — {"ok":true,"n":7}
- **codigo**: OK — function sumaPares(nums) {
    return nums.filter(num => num % 2 === 0).reduce((acc, num) => acc + num, 0);
}
- **herramienta**: OK — nativo: sumar({"a": 17, "b": 25})
