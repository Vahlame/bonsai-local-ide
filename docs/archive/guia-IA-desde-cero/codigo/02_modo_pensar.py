"""
02_modo_pensar.py — el mando que casi nadie toca, medido en tiempo y dinero.

Compara la MISMA pregunta en tres configuraciones:
  1) modo directo (sin pensar)
  2) modo pensar con esfuerzo "low"
  3) modo pensar con esfuerzo "high" (el valor por defecto)

Ejecutar:  python 02_modo_pensar.py
"""

import time

from cliente_comun import cliente, coste, mostrar

PREGUNTA = (
    "Un tren sale de A a 80 km/h y otro de B a 100 km/h. La distancia entre A y B "
    "es de 360 km. ¿A qué distancia de A se cruzan? Da solo el número final."
)


def una_llamada(cli, etiqueta, **parametros):
    print("=" * 70)
    print(etiqueta)
    print("=" * 70)
    inicio = time.perf_counter()
    respuesta = cli.chat.completions.create(
        model="deepseek-flash",
        messages=[{"role": "user", "content": PREGUNTA}],
        **parametros,
    )
    segundos = time.perf_counter() - inicio
    mostrar(respuesta)
    coste(respuesta)
    print(f"tardó {segundos:.1f} segundos")
    print()
    return respuesta


# 1) Modo directo: contesta del tirón, sin borrador interno.
#    Aquí SÍ funcionan temperature y penalties.
una_llamada(cli, "1) MODO DIRECTO (sin pensar)", reasoning_effort="none", temperature=0.2)

# 2) Modo pensar con poco esfuerzo: piensa un poco y contesta.
una_llamada(cli, "2) PENSAR con esfuerzo LOW", reasoning_effort="low")

# 3) Modo pensar con esfuerzo alto (el valor por defecto de la API).
#    Nota: aquí temperature se ignora por completo.
una_llamada(cli, "3) PENSAR con esfuerzo HIGH (por defecto)", reasoning_effort="high")

print("CONCLUSIÓN que deberías ver con tus propios ojos:")
print("  - El modo directo es el más rápido y barato.")
print("  - 'high' gasta bastante más salida (el borrador interno se paga).")
print("  - Para una pregunta de un paso, el modo directo suele bastar.")
print("  - Si tu presupuesto de salida es corto en modo pensar, te llega vacío.")
