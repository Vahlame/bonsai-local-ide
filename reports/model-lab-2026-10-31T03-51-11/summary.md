# Model Lab · 2026-10-31T03-51-11

| Modelo | Plan | Arranque | VRAM pico | Pruebas |
|---|---|---:|---:|---|
| qwen35-4b | 131072 tok · f16 · visión CPU | 6.1 s | 7117 MiB | 5/5 pruebas |

## qwen35-4b

- **saludo**: OK — BONSAI_OK
- **json**: OK — {"ok":true,"n":7}
- **codigo**: OK — function sumaPares(nums) {
  return nums.reduce((acc, num) => num % 2 === 0 ? acc + num : acc, 0);
}
- **herramienta**: OK — nativo: sumar({"a":17,"b":25})
- **vision**: OK — La imagen muestra una interfaz de código oscuro con una lista de archivos en el explorador y un panel de chat a la derecha.
