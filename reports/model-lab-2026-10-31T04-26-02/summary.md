# Model Lab · 2026-10-31T04-26-02

| Modelo | Plan | Arranque | VRAM pico | Pruebas |
|---|---|---:|---:|---|
| qwen35-9b | 131072 tok · q8_0 · visión CPU | 8.4 s | 7121 MiB | 5/5 pruebas |

## qwen35-9b

- **saludo**: OK — BONSAI_OK
- **json**: OK — {"ok":true,"n":7}
- **codigo**: OK — function sumaPares(nums) {
  return nums.filter(n => n % 2 === 0).reduce((a, b) => a + b, 0);
}
- **herramienta**: OK — nativo: sumar({"a":17,"b":25})
- **vision**: OK — La imagen muestra la interfaz de una aplicación de desarrollo llamado "Bonsai", donde se visualiza un explorador de archivos con nombres de archivos como "chat/actions.mjs" y "chat/modelo.json", junto
