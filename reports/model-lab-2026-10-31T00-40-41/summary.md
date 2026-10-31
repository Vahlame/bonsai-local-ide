# Model Lab · 2026-10-31T00-40-41

| Modelo | Plan | Arranque | VRAM pico | Pruebas |
|---|---|---:|---:|---|
| ornith9b | 110592 tok · q8_0 · visión CPU | 7.6 s | 7431 MiB | 5/5 pruebas |

## ornith9b

- **saludo**: OK — BONSAI_OK
- **json**: OK — {"ok":true,"n":7}
- **codigo**: OK — function sumaPares(nums) {
  return nums.reduce((acc, n) => acc + (n % 2 === 0 ? n : 0), 0);
}
- **herramienta**: OK — sumar({"a":17,"b":25})
- **vision**: OK — Interfaz de una aplicación de IA llamada Bonsai mostrando un explorador de archivos con una lista de archivos y carpetas del proyecto, junto a un panel de conversación vacío.
