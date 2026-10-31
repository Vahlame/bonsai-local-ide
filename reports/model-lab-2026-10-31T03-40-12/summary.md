# Model Lab · 2026-10-31T03-40-12

| Modelo | Plan | Arranque | VRAM pico | Pruebas |
|---|---|---:|---:|---|
| qwen3vl-2b | 98304 tok · q8_0 · visión CPU | 3.1 s | 7339 MiB | 5/5 pruebas |

## qwen3vl-2b

- **saludo**: OK — BONSAI_OK
- **json**: OK — {"ok":true,"n":7}
- **codigo**: OK — function sumaPares(nums) {
    return nums.reduce((acum, num) => {
        if (num % 2 === 0) {
            return acum + num;
        }
        return acum;
    }, 0);
}
- **herramienta**: OK — nativo: sumar({"a": 17, "b": 25})
- **vision**: OK — La imagen muestra una interfaz de un editor de código en la plataforma Bonsai, con una lista de archivos de explorador y una ventana de conversación, y se puede leer la palabra "ajustar" en el texto d
