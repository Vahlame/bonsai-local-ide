"""
04_cache.py — el experimento que te ahorra dinero de verdad.

Hace la misma pregunta dos veces con el MISMO prefijo (instrucciones + documento).
La segunda llamada debería acertar en la caché y costar unas 50 veces menos
en su parte de entrada.

Ejecutar:  python 04_cache.py
"""

from cliente_comun import cliente

# --- Configuración del experimento -------------------------------------------------

INSTRUCCIONES = (
    "Eres un analista de contratos. Responde siempre en español, con lenguaje "
    "claro, y cita el párrafo exacto en el que te apoyas. Si algo no consta en el "
    "documento, escribe 'No consta en el documento'."
)

# Un documento largo y estable: en la vida real sería tu base de conocimiento,
# tu manual, tu código fuente o el histórico de una conversación.
DOCUMENTO = """
CONTRATO DE PRESTACIÓN DE SERVICIOS

Párrafo 1. El proveedor se compromete a entregar el sistema antes del 30 de
noviembre de 2026.

Párrafo 2. El pago se realizará en dos plazos: 40% a la firma y 60% contra
entrega aceptada por el cliente.

Párrafo 3. En caso de retraso imputable al proveedor, se aplicará una penalización
del 0,5% del importe total por cada semana de retraso, con un máximo del 10%.

Párrafo 4. La garantía cubre defectos de fabricación durante 24 meses desde la
entrega, pero excluye expresamente el desgaste por uso indebido.

Párrafo 5. Cualquiera de las partes podrá resolver el contrato con 60 días de
preaviso por escrito, sin penalización, salvo que existan entregas pendientes.
""" * 8  # repetido para que el prefijo pese lo suficiente y se note en los tokens


def preguntar(cli, pregunta):
    """Manda SIEMPRE el mismo prefijo y solo cambia la última línea."""
    return cli.chat.completions.create(
        model="deepseek-flash",
        messages=[
            {"role": "system", "content": INSTRUCCIONES},
            {"role": "user", "content": f"<documento>\n{DOCUMENTO}\n</documento>"},
            # Lo variable va al final: así el prefijo de arriba se reutiliza.
            {"role": "user", "content": pregunta},
        ],
        reasoning_effort="low",
        max_tokens=4000,
    )


cli = cliente()

for numero, pregunta in enumerate(
    [
        "¿Cuál es la penalización máxima por retraso?",
        "¿Cuánto se paga a la firma?",
    ],
    1,
):
    print("=" * 70)
    print(f"LLAMADA {numero}: {pregunta}")
    print("=" * 70)
    respuesta = preguntar(cli, pregunta)
    print(respuesta.choices[0].message.content)
    print()

    u = respuesta.usage
    aciertos = getattr(u, "prompt_cache_hit_tokens", 0) or 0
    fallos = getattr(u, "prompt_cache_miss_tokens", 0) or 0
    entrada = aciertos * 0.003 + fallos * 0.15
    print(f"entrada -> {aciertos} tokens de caché + {fallos} tokens nuevos")
    print(f"coste de la entrada: {entrada / 1_000_000:.6f} $")
    if numero == 2 and aciertos > 0:
        print("🎉 La segunda llamada acertó en la caché: el prefijo se reutilizó.")
    elif numero == 2:
        print("Aún no hubo acierto. La caché tarda unos segundos en construirse:")
        print("vuelve a ejecutar el script y mira la primera llamada.")
    print()

print("Para comparar, haz esta prueba mental:")
print("  - 100.000 tokens de entrada NUEVOS cuestan 0,015 $")
print("  - los mismos 100.000 tokens ACERTADOS cuestan 0,0003 $")
print("  - misma información, 50 veces más barata: eso es el orden del prompt.")
