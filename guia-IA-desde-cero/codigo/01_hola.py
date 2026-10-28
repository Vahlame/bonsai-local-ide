"""
01_hola.py — la llamada más pequeña posible. Cinco líneas útiles.

Ejecutar:  python 01_hola.py
"""

from openai import OpenAI

cliente = OpenAI(
    api_key="TU_CLAVE_AQUI",          # mejor: usa la variable de entorno
    base_url="https://api.deepseek.com",
)

respuesta = cliente.chat.completions.create(
    model="deepseek-flash",
    messages=[{"role": "user", "content": "Explícame en dos frases qué es un token."}],
)

print(respuesta.choices[0].message.content)
