# Model Lab · 2026-10-31T04-36-49

| Modelo | Plan | Arranque | VRAM pico | Pruebas |
|---|---|---:|---:|---|
| qwen3vl-8b | 26624 tok · q8_0 · visión CPU | 8.3 s | 6747 MiB | 5/5 pruebas |

## qwen3vl-8b

- **saludo**: OK — BONSAI_OK
- **json**: OK — {"ok":true,"n":7}
- **codigo**: OK — function sumaPares(nums) {
    return nums.filter(num => num % 2 === 0).reduce((acc, num) => acc + num, 0);
}
- **herramienta**: OK — nativo: sumar({"a": 17, "b": 25})
- **vision**: OK — Una interfaz de desarrollo de software con un explorador de archivos y una conversación de chat.
