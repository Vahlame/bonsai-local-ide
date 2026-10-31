# Model Lab · 2026-10-31T05-14-39

| Modelo | Plan | Arranque | VRAM pico | Pruebas |
|---|---|---:|---:|---|
| phi4-mini | 65536 tok · q8_0 | 4.4 s | 7129 MiB | 3/4 pruebas |

## phi4-mini

- **saludo**: OK — BONSAI_OK
- **json**: OK — {"ok":true,"n":7}
- **codigo**: OK — function sumaPares(nums) {
    return nums.reduce((acc, num) => (num % 2 === 0 ? acc + num : acc), 0);
}
- **herramienta**: FALLO — Claro, puedo simular una función de suma para calcular el resultado de 17+25. Aquí está una función simple en Python:

```python
def sum_two_numbers(a, b):
    
