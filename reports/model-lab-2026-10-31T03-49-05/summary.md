# Model Lab · 2026-10-31T03-49-05

| Modelo | Plan | Arranque | VRAM pico | Pruebas |
|---|---|---:|---:|---|
| qwen3vl-4b | 57344 tok · q8_0 · visión CPU | 5.4 s | 7069 MiB | 5/5 pruebas |

## qwen3vl-4b

- **saludo**: OK — BONSAI_OK
- **json**: OK — {"ok":true,"n":7}
- **codigo**: OK — function sumaPares(nums) {
    return nums.filter(n => n % 2 === 0).reduce((acc, n) => acc + n, 0);
}
- **herramienta**: OK — nativo: sumar({"a": 17, "b": 25})
- **vision**: OK — Se ve la interfaz de una aplicación de código abierto llamada Bonsai, con una lista de archivos de un proyecto de chat en el explorador y un área de conversación en la parte derecha.
