# Model Lab · 2026-10-31T03-42-21

| Modelo | Plan | Arranque | VRAM pico | Pruebas |
|---|---|---:|---:|---|
| lfm3-vl-2b | 128000 tok · f16 · visión CPU | 3.1 s | 2753 MiB | 5/5 pruebas |

## lfm3-vl-2b

- **saludo**: OK — BONSAI_OK
- **json**: OK — {"ok": true, "n": 7}
- **codigo**: OK — function sumaPares(nums) {
  return nums.reduce((sum, num) => (num % 2 === 0 ? sum + num : sum), 0);
}
- **herramienta**: OK — nativo: sumar({"a":17,"b":25})
- **vision**: OK — La imagen muestra una interfaz de código en un editor con una lista de archivos y texto de conversación visible.
