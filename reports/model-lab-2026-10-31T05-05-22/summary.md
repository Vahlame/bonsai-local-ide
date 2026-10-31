# Model Lab · 2026-10-31T05-05-22

| Modelo | Plan | Arranque | VRAM pico | Pruebas |
|---|---|---:|---:|---|
| lfm3-omni-2b | 128000 tok · f16 · visión CPU | 3.1 s | 2857 MiB | 5/5 pruebas |

## lfm3-omni-2b

- **saludo**: OK — BONSAI_OK
- **json**: OK — {"ok":true,"n":7}
- **codigo**: OK — function sumaPares(nums) {
  return nums.filter(num => num % 2 === 0).reduce((sum, num) => sum + num, 0);
}
- **herramienta**: OK — nativo: sumar({"a":17,"b":25})
- **vision**: OK — En la imagen se ve una interfaz de software (probablemente un editor de código o gestor de conversaciones) con una lista vertical de archivos y documentos etiquetados como "Explorador", una barra cent
