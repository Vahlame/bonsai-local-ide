# Model Lab · 2026-10-31T02-46-20

| Modelo | Plan | Arranque | VRAM pico | Pruebas |
|---|---|---:|---:|---|
| ornith9b | 110592 tok · q8_0 · visión CPU | 6.1 s | 7475 MiB | 6/6 pruebas |

## ornith9b

- **saludo**: OK — BONSAI_OK
- **json**: OK — {"ok":true,"n":7}
- **codigo**: OK — function sumaPares(nums) {
  return nums.reduce((acc, n) => acc + (n % 2 === 0 ? n : 0), 0);
}
- **herramienta**: OK — nativo: sumar({"a":17,"b":25})
- **contexto8k**: OK — CLAVE-7391
- **vision**: OK — Interfaz de una aplicación de IA llamada Bonsai mostrando un explorador de archivos con una lista de archivos y carpetas del proyecto.
