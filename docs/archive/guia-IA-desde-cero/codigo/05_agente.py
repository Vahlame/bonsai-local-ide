"""
05_agente.py — un mini-agente con herramientas, el bucle de la sección 8.

Demuestra las reglas que hacen que un agente funcione de verdad:
  1) se reenvía el mensaje del asistente COMPLETO (incluido `reasoning_content`)
  2) se ejecutan TODAS las herramientas que pida, no solo la primera
  3) las salidas de las herramientas se recortan para no reventar el contexto
  4) hay un tope de pasos y una salida hacia el humano

Las dos herramientas que verás NO tocan tu ordenador: una es un reloj simulado
y la otra una calculadora con una lista blanca de operaciones. Es a propósito:
así puedes leer y ejecutar el ejemplo sin riesgo.

Ejecutar:  python 05_agente.py
"""

import ast
import json

from cliente_comun import cliente

MAX_PASOS = 10

# --- Las herramientas (versión de juguete, sin tocar el sistema) --------------------

def consultar_temperatura(ciudad: str, dia: str) -> str:
    """Devuelve una temperatura simulada, sin llamar a ninguna API externa."""
    temperaturas = {"Madrid": 24, "Bogotá": 17, "Ciudad de México": 21, "Lima": 19}
    return f"Temperatura simulada en {ciudad} para {dia}: {temperaturas.get(ciudad, 20)} grados"


def calcular(expresion: str) -> str:
    """Calculadora con lista blanca: solo dígitos, paréntesis y operadores básicos.

    Nota de seguridad: no basta con filtrar caracteres, porque '**' son dos
    asteriscos y se colaría como exponenciación. Por eso además se analiza la
    expresión y se rechazan potencias y números gigantes.
    """
    permitido = set("0123456789+-*/(). ")
    if not set(expresion) <= permitido:
        return "ERROR: la expresión contiene caracteres no permitidos."
    if "**" in expresion:
        return "ERROR: las potencias (**) no están permitidas."
    try:
        arbol = ast.parse(expresion, mode="eval")
    except SyntaxError:
        return "ERROR: no entiendo esa expresión."

    for nodo in ast.walk(arbol):
        if not isinstance(nodo, (ast.Expression, ast.BinOp, ast.UnaryOp, ast.Constant,
                                 ast.Add, ast.Sub, ast.Mult, ast.Div, ast.USub, ast.UAdd)):
            return "ERROR: la expresión usa algo que no está permitido."
        if isinstance(nodo, ast.Constant):
            if not isinstance(nodo.value, (int, float)):
                return "ERROR: solo se admiten números."
            if abs(nodo.value) > 1e15:
                return "ERROR: número demasiado grande."

    try:
        resultado = eval(compile(arbol, "<calculadora>", "eval"),
                         {"__builtins__": {}}, {})  # noqa: S307
        if abs(resultado) > 1e15:
            return "ERROR: el resultado es demasiado grande."
        return f"{expresion} = {resultado}"
    except ZeroDivisionError:
        return "ERROR: división entre cero."
    except Exception as error:  # noqa: BLE001
        return f"ERROR al calcular: {error}. Revisa la expresión."


HERRAMIENTAS = [
    {
        "type": "function",
        "function": {
            "name": "consultar_temperatura",
            "description": (
                "Devuelve la temperatura de una ciudad en un día concreto. "
                "Úsala solo si el usuario pregunta por el tiempo."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "ciudad": {"type": "string", "description": "Nombre de la ciudad"},
                    "dia": {"type": "string", "description": "La fecha en formato AAAA-MM-DD"},
                },
                "required": ["ciudad", "dia"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "calcular",
            "description": (
                "Evalúa una operación aritmética sencilla, por ejemplo (24+21)/2. "
                "Úsala cuando necesites una cuenta exacta en vez de calcularla de cabeza."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "expresion": {
                        "type": "string",
                        "description": "La operación, solo con números y + - * / ( )",
                    }
                },
                "required": ["expresion"],
            },
        },
    },
]

FUNCIONES = {"consultar_temperatura": consultar_temperatura, "calcular": calcular}


def ejecutar(nombre: str, argumentos_json: str) -> str:
    """Ejecuta una herramienta y devuelve SIEMPRE texto, incluso si falla."""
    funcion = FUNCIONES.get(nombre)
    if funcion is None:
        return f"ERROR: la herramienta '{nombre}' no existe. Usa solo: {list(FUNCIONES)}"
    try:
        argumentos = json.loads(argumentos_json)
    except json.JSONDecodeError:
        return f"ERROR: los argumentos no eran JSON válido: {argumentos_json!r}"
    try:
        return str(funcion(**argumentos))
    except TypeError as error:
        return f"ERROR: argumentos incorrectos ({error}). Revisa el esquema."


# --- El bucle del agente ------------------------------------------------------------

PREGUNTA = (
    "¿Cuál es la temperatura en Madrid el 2026-10-06 y en Bogotá el mismo día? "
    "Después calcula la media de las dos."
)


def main() -> None:
    cli = cliente()
    mensajes = [{"role": "user", "content": PREGUNTA}]

    for paso in range(1, MAX_PASOS + 1):
        print("=" * 70)
        print(f"PASO {paso}")
        print("=" * 70)

        respuesta = cli.chat.completions.create(
            model="deepseek-flash",
            messages=mensajes,
            tools=HERRAMIENTAS,
            reasoning_effort="high",
            max_tokens=8192,
        )
        mensaje = respuesta.choices[0].message

        # REGLA 1: se añade el mensaje COMPLETO (content + reasoning_content + tool_calls).
        # Si en vez de esto construyes a mano un dict con solo 'content' y 'tool_calls',
        # la API responde 400: "The reasoning_content in the thinking mode must be
        # passed back to the API".
        mensajes.append(mensaje)

        if not mensaje.tool_calls:
            print("--- RESPUESTA FINAL ---")
            print(mensaje.content)
            print(f"\nel agente terminó en {paso} paso(s).")
            return

        # REGLA 2: pueden llegar VARIAS herramientas en el mismo turno.
        for llamada in mensaje.tool_calls:
            nombre = llamada.function.name
            argumentos = llamada.function.arguments
            print(f"-> el modelo pide: {nombre}({argumentos})")

            resultado = ejecutar(nombre, argumentos)

            # REGLA 3: se recorta la salida antes de devolverla al modelo.
            recortado = resultado if len(resultado) <= 2000 else resultado[:2000] + "…[recortado]"
            print(f"   resultado: {recortado}")

            mensajes.append(
                {"role": "tool", "tool_call_id": llamada.id, "content": recortado}
            )
        print()

    # REGLA 4: tope de pasos alcanzado -> se avisa al humano, no se sigue dando vueltas.
    print(f"Se alcanzó el límite de {MAX_PASOS} pasos sin respuesta final.")
    print("Escalando al humano: revisa el historial y ajusta el prompt o las herramientas.")


if __name__ == "__main__":
    main()
