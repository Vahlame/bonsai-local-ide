# Model Lab (sin visión) · 2026-10-31T04-44-29

| Modelo | Plan | Arranque | VRAM pico | Pruebas |
|---|---|---:|---:|---|
| gemma4-e4b | 22528 tok · q8_0 | 3.9 s | 3367 MiB | 4/4 pruebas |

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
