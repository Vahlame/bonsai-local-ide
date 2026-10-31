# Model Lab · 2026-10-31T04-02-08

| Modelo | Plan | Arranque | VRAM pico | Pruebas |
|---|---|---:|---:|---|
| minicpm-v47-1b | 131072 tok · f16 · visión CPU | 8.4 s | 2305 MiB | 5/5 pruebas |

## minicpm-v47-1b

- **saludo**: OK — BONSAI_OK
- **json**: OK — {
  "ok": true,
  "n": 7
}
- **codigo**: OK — function sumaPares(nums) {
  return nums.filter(n => n % 2 === 0).reduce((a, b) => a + b);
}
- **herramienta**: OK — nativo: sumar({"a":17,"b":25})
- **vision**: OK — La imagen muestra un panel de herramientas de Bonsai de Ventana 77244 con una lista de archivos de conversaciones.
