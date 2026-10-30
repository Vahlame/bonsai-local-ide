"""
03_json.py — sacar datos en JSON limpio, listo para tu programa.

Tres requisitos que exige la documentación oficial y la gente olvida:
  1) la palabra "json" tiene que aparecer en el prompt
  2) hay que dar un ejemplo del formato exacto
  3) hay que dejar espacio de sobra en la respuesta (max_tokens)

Y una regla de oro: valida el JSON en tu programa antes de usarlo.
Si el texto no está en el prompt, el modelo debe devolver null, no inventárselo.

Ejecutar:  python 03_json.py
"""

import json

from cliente_comun import cliente, coste

FACTURA = """
FACTURA Nº 2026-0417
Proveedor: Tornillos Ibéricos S.L.
Fecha de emisión: 14 de septiembre de 2026
Conceptos:
  - 500 tornillos M4 x 0,12 EUR = 60,00 EUR
  - 200 tuercas M4 x 0,08 EUR = 16,00 EUR
Base imponible: 76,00 EUR
IVA (21%): 15,96 EUR
TOTAL A PAGAR: 91,96 EUR
"""

PROMPT = f"""Extrae los datos de esta factura y devuelve SOLO json válido.

Formato exacto:
{{"proveedor": "texto", "fecha": "AAAA-MM-DD", "total": 0.0, "moneda": "EUR",
 "lineas": [{{"concepto": "texto", "importe": 0.0}}]}}

Si un campo no aparece en la factura, usa null. No inventes valores.

FACTURA:
{FACTURA}"""

cli = cliente()

respuesta = cli.chat.completions.create(
    model="deepseek-flash",
    messages=[{"role": "user", "content": PROMPT}],
    # Modo directo: para extracción determinista no necesitamos borrador interno.
    reasoning_effort="none",
    temperature=0.0,
    # El modo JSON de la API garantiza que la sintaxis sea válida.
    response_format={"type": "json_object"},
    # Espacio de sobra para que no llegue cortado a mitad.
    max_tokens=2000,
)

texto = respuesta.choices[0].message.content

print("--- RESPUESTA CRUDA ---")
print(texto)
print()

# Validación en el cliente: si esto falla, NO uses el resultado.
try:
    datos = json.loads(texto)
except json.JSONDecodeError as error:
    print("El JSON llegó mal formado:", error)
    print("Reintenta subiendo max_tokens o reforzando el ejemplo del formato.")
    raise SystemExit(1)

print("--- JSON YA VALIDADO Y CONVERTIDO EN DICCIONARIO ---")
print(json.dumps(datos, indent=2, ensure_ascii=False))
print()

print(f"proveedor detectado: {datos.get('proveedor')}")
print(f"total detectado:     {datos.get('total')} {datos.get('moneda', '')}")
print(f"líneas extraídas:    {len(datos.get('lineas', []))}")
print()

coste(respuesta)

# Comprobación honesta: si un campo no estaba en la factura, debe ser None.
if datos.get("moneda") is None and "EUR" in FACTURA:
    print("AVISO: había EUR en la factura pero el campo vino vacío. Revisa el prompt.")
