# Model Lab · 2026-10-31T04-45-29

| Modelo | Plan | Arranque | VRAM pico | Pruebas |
|---|---|---:|---:|---|
| nemotron35-e4b | 36864 tok · q8_0 · visión CPU | 6.9 s | 2709 MiB | 5/5 pruebas |

## nemotron35-e4b

- **saludo**: OK — BONSAI_OK
- **json**: OK — {"ok":true,"n":7}
- **codigo**: OK — function sumaPares(nums) {
  return nums.reduce((sum, num) => (num % 2 === 0 ? sum + num : sum), 0);
}
- **herramienta**: OK — nativo: sumar({"a":17,"b":25})
- **vision**: OK — Thinking Process:

1.  **Analyze the Request:** The user wants a one-sentence description of the image. If there is legible text, they must mention one word.
2.  **Examine the Image:** The image is a 
