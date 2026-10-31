# Model Lab · 2026-10-31T05-26-23

| Modelo | Plan | Arranque | VRAM pico | Pruebas |
|---|---|---:|---:|---|
| spark-x26-4b | 45056 tok · q8_0 | 3.7 s | 4041 MiB | 4/4 pruebas |

## spark-x26-4b

- **saludo**: OK — BONSAI_OK</think>
- **json**: OK — {"ok":true,"n":7}
- **codigo**: OK — function sumaPares(nums) {
    return nums.filter(num => num % 2 === 0).reduce((sum, num) => sum + num, 0);
}
- **herramienta**: OK — nativo: sumar({"a":17,"b":25})
