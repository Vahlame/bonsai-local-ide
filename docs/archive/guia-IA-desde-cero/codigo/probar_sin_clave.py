"""
probar_sin_clave.py — verifica los ejemplos SIN gastar tokens ni tener clave.

Comprueba:
  1) que el cliente avisa correctamente cuando falta la clave
  2) que el cálculo de coste (incluida la separación caché acierto/fallo) es correcto
  3) que la calculadora del agente rechaza lo que debe rechazar

Ejecutar:  python probar_sin_clave.py
"""

import importlib.util
import os
from types import SimpleNamespace

import cliente_comun
from cliente_comun import coste

# --- 1) Sin clave debe avisar, no reventar con un error criptico -------------------

respaldo = os.environ.pop("DEEPSEEK_API_KEY", None)
try:
    cliente_comun.cliente()
    print("1. FALLO: deberia haber avisado de que falta la clave")
except SystemExit as aviso:
    print("1. OK - aviso correcto sin clave:")
    print("   " + str(aviso).replace("\n", "\n   "))
finally:
    if respaldo is not None:
        os.environ["DEEPSEEK_API_KEY"] = respaldo

# --- 2) El cálculo de coste, con números que puedo verificar a mano -----------------

falsa = SimpleNamespace(
    usage=SimpleNamespace(
        prompt_tokens=1_000_000,
        prompt_cache_hit_tokens=1_000_000,   # todo acierta
        prompt_cache_miss_tokens=0,
        completion_tokens=0,
    )
)
print("\n2. 1M de tokens de entrada que ACIERTAN en cache:")
coste(falsa)
print("   esperado: 0.003000 $  (1M x 0,003 $/M)")

falsa2 = SimpleNamespace(
    usage=SimpleNamespace(
        prompt_tokens=1_000_000,
        prompt_cache_hit_tokens=0,
        prompt_cache_miss_tokens=1_000_000,  # todo falla
        completion_tokens=0,
    )
)
print("\n   Lo mismo, pero FALLANDO la cache:")
coste(falsa2)
print("   esperado: 0.150000 $  (50 veces mas caro)")

# --- 3) La calculadora del agente no debe ejecutar cualquier cosa -------------------

spec = importlib.util.spec_from_file_location("agente", "05_agente.py")
agente = importlib.util.module_from_spec(spec)
spec.loader.exec_module(agente)

print("\n3. La lista blanca de la calculadora:")
casos = [
    ("(24+21)/2", False, "debe calcular"),
    ("__import__('os').system('echo hola')", True, "debe rechazar"),
    ("2**10", True, "debe rechazar (** no esta permitido)"),
]
for expresion, debe_fallar, esperado in casos:
    resultado = agente.calcular(expresion)
    acerto = ("ERROR" in resultado) == debe_fallar
    print(f"   {'OK ' if acerto else 'FALLO'} {expresion!r} -> {resultado}   ({esperado})")

print("\n4. Herramienta inexistente:")
print("   ", agente.ejecutar("borrar_disco", "{}"))
print("\n5. Argumentos que no son JSON:")
print("   ", agente.ejecutar("calcular", "esto no es json"))
