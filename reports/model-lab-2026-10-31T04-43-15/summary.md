# Model Lab · 2026-10-31T04-43-15

| Modelo | Plan | Arranque | VRAM pico | Pruebas |
|---|---|---:|---:|---|
| gemma4-e4b | 22528 tok · q8_0 · visión CPU | 7.6 s | 3367 MiB | 5/5 pruebas |

## gemma4-e4b

- **saludo**: OK — BONSAI_OK
- **json**: OK — {"ok":true,"n":7}
- **codigo**: OK — const sumaPares = (nums) => {
  return nums.reduce((acc, num) => {
    if (num % 2 === 0) {
      return acc + num;
    }
    return acc;
  }, 0);
};
- **herramienta**: OK — nativo: sumar({"a":17,"b":25})
- **vision**: OK — Here's a thinking process to arrive at the desired description:

1.  **Analyze the Request:**
    *   Describe what is seen in the image in one sentence.
    *   If there is legible text, mention one 
