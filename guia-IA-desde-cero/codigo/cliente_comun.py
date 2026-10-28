"""
cliente_comun.py — configuración y ayudas que comparten todos los ejemplos.

No hace nada por sí solo: aquí está el cliente y las dos funciones auxiliares
(mostrar la respuesta y calcular lo que costó).
"""

import os
import sys

from openai import OpenAI

# En Windows la consola usa cp1252 por defecto y no puede imprimir emojis ni
# algunos caracteres. Esto fuerza UTF-8 para que los ejemplos no revienten.
for flujo in (sys.stdout, sys.stderr):
    try:
        flujo.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

MODELO = "deepseek-flash"
BASE_URL = "https://api.deepseek.com"


def cliente() -> OpenAI:
    """Crea el cliente usando la clave que está en la variable de entorno."""
    clave = os.environ.get("DEEPSEEK_API_KEY")
    if not clave:
        raise SystemExit(
            "Falta la clave.\n"
            "  PowerShell:  $env:DEEPSEEK_API_KEY = 'sk-tu-clave'\n"
            "  Git Bash:    export DEEPSEEK_API_KEY='sk-tu-clave'"
        )
    return OpenAI(api_key=clave, base_url=BASE_URL)


def mostrar(respuesta) -> None:
    """Imprime la respuesta separando el borrador interno de la respuesta final."""
    mensaje = respuesta.choices[0].message

    razonamiento = getattr(mensaje, "reasoning_content", None)
    if razonamiento:
        print("--- BORRADOR INTERNO (no es la respuesta) ---")
        print(razonamiento[:600], "..." if len(razonamiento) > 600 else "")
        print()

    print("--- RESPUESTA ---")
    print(mensaje.content)


def coste(respuesta) -> None:
    """Imprime tokens y coste, separando aciertos de caché de los fallos.

    Precios oficiales por millón de tokens (horario valle):
      entrada con acierto de caché: 0,003 $   entrada que falla: 0,15 $
      salida: 0,60 $
    """
    u = respuesta.usage
    aciertos = getattr(u, "prompt_cache_hit_tokens", 0) or 0
    fallos = getattr(u, "prompt_cache_miss_tokens", 0) or 0
    salida = u.completion_tokens

    dolares = (aciertos * 0.003 + fallos * 0.15 + salida * 0.60) / 1_000_000

    print(
        f"tokens -> entrada: {u.prompt_tokens} "
        f"(caché: {aciertos} aciertos / {fallos} fallos) | salida: {salida}"
    )
    print(f"coste aproximado de esta llamada: {dolares:.6f} $")
