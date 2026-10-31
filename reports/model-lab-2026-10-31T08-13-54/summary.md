# Model Lab · 2026-10-31T08-13-54

| Modelo | Plan | Arranque | VRAM pico | Pruebas |
|---|---|---:|---:|---|
| nemotron3-nano-30b | 32768 tok · q8_0 | 8.0 s | 6905 MiB | 4/4 pruebas |

## nemotron3-nano-30b

- **saludo**: OK — BONSAI_OK
- **json**: OK — {
  "ok": true,
  "n": 7
}
```
- **codigo**: OK — function sumaPares(nums) {
  return nums.reduce((acc, n) => (n % 2 === 0 ? acc + n : acc), 0);
}
- **herramienta**: OK — nativo: sumar({"a":17,"b":25})
