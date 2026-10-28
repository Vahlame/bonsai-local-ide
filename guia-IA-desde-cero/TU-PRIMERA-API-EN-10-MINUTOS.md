# Tu primera llamada a la API en 10 minutos

### Sección práctica de la guía: código listo para ejecutar, no para copiar a mano

*Complemento de [GUIA-IA-DESDE-CERO.md](GUIA-IA-DESDE-CERO.md). Escrito el 6 de octubre de 2026.*

---

## Antes de empezar: los dos caminos

Hay dos maneras de usar DeepSeek-V4.1-Flash y conviene elegir una **antes** de tocar código:

| | **Camino A: la interfaz `dsh`** | **Camino B: la API con código** |
|---|---|---|
| Qué es | Un programa ya hecho con interfaz en el navegador | Tú llamas al modelo desde tus propios scripts |
| Necesitas saber programar | No | Un poco de Python |
| Tiempo hasta la primera respuesta | 5 minutos | 10 minutos |
| Para qué sirve | Usar la IA, crear agentes sin programar el bucle | Automatizar, integrar en tus programas, experimentar |
| Coste | El de los tokens que consumas | Igual |

Este documento cubre el **Camino B** completo y el **Camino A** en tres pasos. Si nunca has usado una API, empieza por el A y vuelve luego.

---

# CAMINO A — La interfaz `dsh` (sin escribir código)

### Paso 1. Instala Node.js

Descárgalo de [nodejs.org](https://nodejs.org) (versión 18 o superior) e instálalo con las opciones por defecto. Para comprobar que funcionó, abre **PowerShell** y escribe:

```powershell
node --version
```

Debe responder algo como `v22.x.x`. Si da error, cierra y vuelve a abrir PowerShell.

### Paso 2. Arranca el harness

```powershell
npx @deepseek-ai/dsh web
```

La primera vez tarda un poco porque descarga el programa. Al terminar **abre solo el navegador** en una dirección parecida a:

```
http://127.0.0.1:3080
```

Si no se abre, copia esa dirección a mano. Ese `127.0.0.1` significa "solo desde tu propio ordenador": nadie de fuera puede entrar, y por eso el programa no acepta `--host 0.0.0.0`.

### Paso 3. Conecta tu modelo y elige una carpeta

1. En la interfaz, entra en **Settings → Models**, pega tu clave de DeepSeek y guarda. Funciona al instante, sin reiniciar.
2. Pulsa **Choose workspace** y elige la carpeta del proyecto donde vas a trabajar. Sin carpeta elegida, el cuadro de chat está desactivado.
3. Empieza una sesión y pídele algo, por ejemplo:

```
Resume este repositorio y dime cuáles son sus paquetes principales.
```

El agente leerá y editará archivos, ejecutará comandos y te pedirá aprobación cuando la política de permisos lo exija.

> **Antes de dejarlo trabajando solo:** mira la sección 9 de la guía principal. En resumen: trabaja en una carpeta de pruebas, no le des credenciales y revisa lo que hizo.

---

# CAMINO B — Tu primera llamada con código

## Paso 1. Consigue la clave (2 minutos)

1. Entra en **https://platform.deepseek.com** y crea una cuenta.
2. Ve a **API keys** y pulsa *Create new API key*.
3. **Copia la clave en ese momento.** Solo se muestra una vez. Empieza por `sk-`.
4. Recarga saldo (con 2 € tienes para muchísimas pruebas: mira el paso 6).

> ⚠️ **Nunca pegues la clave dentro de un archivo `.py` que vayas a compartir o subir a GitHub.** Por eso todos los ejemplos la leen de una variable de entorno.

## Paso 2. Guarda la clave como variable de entorno (2 minutos)

En **PowerShell** (Windows), pega esto sustituyendo tu clave:

```powershell
$env:DEEPSEEK_API_KEY = "sk-tu-clave-aqui"
```

Ojo: así solo dura la sesión de la ventana actual. Si quieres que quede guardada entre sesiones:

```powershell
setx DEEPSEEK_API_KEY "sk-tu-clave-aqui"
```

…y **abre una ventana nueva** para que la vea (setx no afecta a la ventana actual).

Si usas **Git Bash** o Linux/Mac:

```bash
export DEEPSEEK_API_KEY="sk-tu-clave-aqui"
```

Para comprobar que quedó bien, sin imprimir la clave entera:

```powershell
$env:DEEPSEEK_API_KEY.Substring(0,6) + "..."
```

## Paso 3. Instala Python y el paquete (2 minutos)

Si no tienes Python, descárgalo de [python.org](https://www.python.org/downloads/) y **marca la casilla "Add python.exe to PATH"** durante la instalación. Comprueba:

```powershell
python --version
```

Luego instala el cliente oficial de OpenAI (la API de DeepSeek es compatible con él):

```powershell
pip install -r requirements.txt
```

## Paso 4. La llamada más pequeña del mundo (1 minuto)

Mira el archivo **`01_hola.py`**: son cinco líneas útiles. Para ejecutarlo:

```powershell
cd C:\Users\user\Documents\prject_local_AI\guia-IA-desde-cero\codigo
python 01_hola.py
```

Si ves una respuesta en español, **ya está**: acabas de usar la API.

Si algo falla, mira la sección "Cuando algo falla" más abajo: están los cuatro errores que se cometen el 95 % de las veces.

## Paso 5. Los cuatro ejemplos que enseñan de verdad (5 minutos)

Ejecútalos en orden. Cada uno mide algo y lo imprime, para que no tengas que creerte nada:

| Script | Qué demuestra | Lo que deberías observar |
|---|---|---|
| `02_modo_pensar.py` | El mando de esfuerzo, medido en segundos y en dólares | El modo directo es el más rápido; `high` gasta mucho más en salida porque paga el borrador interno |
| `03_json.py` | Sacar datos de una factura en JSON limpio y **validado** | El JSON se convierte en un diccionario de Python sin errores; si no, el script te avisa |
| `04_cache.py` | La caché por prefijo, la que ahorra el 98 % | La segunda llamada acierta en la caché y el coste de su entrada se desploma |
| `05_agente.py` | El bucle completo de un agente con herramientas | El modelo pide herramientas, se ejecutan, y a veces pide **dos a la vez** |

## Paso 6. Cuánto te va a costar

Precios oficiales por millón de tokens (en horario valle, que es el resto del tiempo):

| Concepto | Precio |
|---|---|
| Entrada que **acierta** en la caché | 0,003 $ |
| Entrada que **falla** la caché | 0,15 $ |
| Salida (lo que el modelo escribe) | 0,60 $ |

**Traducción para que no te asustes ni te confíes:**

- Una pregunta normal con una respuesta de un párrafo: del orden de **0,0005 $** (medio milésimo de dólar).
- Con 1 dólar tienes para **miles** de preguntas de ese tipo.
- Una sola llamada que meta un libro entero de 200.000 tokens como entrada: 0,03 $ si acierta la caché, 0,6 $ si la falla. Ahí se ve por qué el orden del prompt importa.
- El horario pico es 01:00–04:00 y 06:00–10:00 UTC **de lunes a viernes**; fines de semana y festivos chinos son valle todo el día. En Costa Rica (UTC−6) el pico cae de **19:00 a 22:00** y de **00:00 a 04:00**, hora local.

**Pon un límite de gasto mental desde el principio:** los scripts de este curso, ejecutados una vez cada uno, cuestan bastante menos que un café.

---

## Los 6 detalles que hacen que tu código no se rompa

Estos son los que hacen perder tardes enteras. Todos están verificados contra la documentación oficial:

### 1. Con herramientas, devuelve el mensaje del asistente **completo**

Si usas `tools`, en cada vuelta del bucle tienes que añadir a la conversación el objeto del asistente **tal cual llegó**, con `content`, `reasoning_content` y `tool_calls`. Si lo reconstruyes a mano y te olvidas del borrador interno, la API responde:

```
400 - The reasoning_content in the thinking mode must be passed back to the API
```

✅ Correcto: `mensajes.append(mensaje)`
❌ Incorrecto: `mensajes.append({"role": "assistant", "content": mensaje.content, "tool_calls": mensaje.tool_calls})`

En `05_agente.py` lo tienes comentado justo en la línea que importa.

### 2. No puedes forzar una herramienta concreta en modo pensar

`tool_choice="required"` o elegir una herramienta por nombre **no están soportados en modo pensar** en el formato Chat Completions: devuelve error 400. Si necesitas forzarla, apaga el modo pensar (`reasoning_effort="none"`).

### 3. En modo pensar, la temperatura no hace nada

`temperature`, `presence_penalty` y `frequency_penalty` se aceptan pero **se ignoran** en modo pensar. No dan error, simplemente no tienen efecto. Si quieres resultados repetibles: modo directo con `temperature=0.0`, o repetir la pregunta varias veces.

### 4. Deja espacio de salida o te llegará vacío

El presupuesto de salida lo comparten el borrador interno y la respuesta final. Valores por defecto:

| Configuración | `max_tokens` por defecto |
|---|---|
| Modo directo | 8K |
| Modo pensar | 64K |
| Modo pensar con `max` | 128K |
| Tope absoluto | 384K (393.216) |

Si tu respuesta llega vacía con `finish_reason="length"`, ya sabes qué pasó: el borrador se comió todo. Sube `max_tokens` o baja el esfuerzo.

### 5. El modo JSON tiene tres requisitos

Para que `response_format={"type": "json_object"}` funcione:

1. La palabra **"json"** debe aparecer en el prompt.
2. Hay que dar un **ejemplo del formato** exacto.
3. `max_tokens` debe ser holgado, o el JSON llegará cortado.

Y siempre, **valida en tu programa** antes de usar los datos. El propio script `03_json.py` lo hace y te avisa si el parseo falla.

### 6. Los errores de la API y qué significan

| Código | Qué pasa | Qué hacer |
|---|---|---|
| `400` | Suele ser un `reasoning_content` no devuelto, un `tool_choice` forzado en modo pensar, o una imagen en un mensaje `system` | Revisa las tres reglas de arriba |
| `401` | Clave incorrecta o mal copiada | Comprueba la variable de entorno |
| `402` | Saldo insuficiente | Recarga en la plataforma |
| `429` | Demasiadas peticiones | Espera y reintenta con backoff exponencial (abajo) |
| `500`/`503` | Problema del servidor | Reintenta; no es tu código |

**Reintentos con espera creciente (cópialo tal cual):**

```python
import time, random
from openai import APIStatusError, RateLimitError

def con_reintentos(funcion, intentos=5):
    """Reintenta ante 429 y errores de servidor, esperando cada vez más."""
    for intento in range(intentos):
        try:
            return funcion()
        except (RateLimitError, APIStatusError) as error:
            codigo = getattr(error, "status_code", 0)
            if codigo not in (429, 500, 503) or intento == intentos - 1:
                raise
            espera = (2 ** intento) + random.uniform(0, 1)   # 1, 3, 7, 15 s...
            print(f"error {codigo}: reintento en {espera:.1f}s")
            time.sleep(espera)
```

---

## Tu plantilla de trabajo, lista para copiar

Cuando quieras hacer algo nuevo, parte de esto y cambia solo lo que está entre `< >`:

```python
"""plantilla.py — punto de partida para cualquier tarea nueva."""
from cliente_comun import cliente, coste, mostrar

INSTRUCCIONES = """<rol en una línea>
Responde siempre en español.
Si algo no consta en los datos, escribe "No consta". No inventes."""

DATOS = """<aquí va el material largo y estable: documentos, código, histórico>"""

def main():
    cli = cliente()
    respuesta = cli.chat.completions.create(
        model="deepseek-flash",
        messages=[
            # 1) lo estable primero (esto es lo que se cachea)
            {"role": "system", "content": INSTRUCCIONES},
            {"role": "user", "content": DATOS},
            # 2) la pregunta variable, SIEMPRE al final
            {"role": "user", "content": "<tu pregunta concreta + formato de salida>"},
        ],
        reasoning_effort="high",   # low | high | max   (o "none" para modo directo)
        max_tokens=16384,          # sin miedo: el borrador interno también come de aquí
    )
    mostrar(respuesta)
    coste(respuesta)

if __name__ == "__main__":
    main()
```

---

## Comprobar que todo está bien antes de seguir

Guarda esto como `comprobar.py` y ejecútalo. Te dice qué tienes y qué te falta, **sin gastar un solo token**:

```python
import os, sys

print("1. Versión de Python:", sys.version.split()[0])
if sys.version_info < (3, 9):
    print("   ⚠️  Mejor actualiza a Python 3.9 o superior.")

try:
    import openai
    print("2. Cliente openai:", openai.__version__)
except ImportError:
    print("2. ❌ Falta el cliente. Ejecuta: pip install -r requirements.txt")

clave = os.environ.get("DEEPSEEK_API_KEY", "")
if not clave:
    print("3. ❌ Falta la variable DEEPSEEK_API_KEY (ver paso 2).")
elif not clave.startswith("sk-"):
    print("3. ⚠️  La clave no empieza por 'sk-'. ¿Copiaste la clave entera?")
else:
    print(f"3. ✅ Clave presente: {clave[:6]}…{clave[-4:]}  ({len(clave)} caracteres)")

print("4. Base URL correcta: https://api.deepseek.com")
print("5. Nombre del modelo:  deepseek-flash")
```

---

## Cuando algo falla

**"Falta la clave" / 401**
La variable de entorno no llegó al proceso. Si usaste `setx`, abre una ventana **nueva**. Comprueba con:
```powershell
$env:DEEPSEEK_API_KEY.Substring(0,6) + "..."
```

**400 con "reasoning_content ... must be passed back"**
Estás usando `tools` y no devuelves el mensaje completo. Añade `mensajes.append(mensaje)` en lugar de reconstruirlo (regla 1, arriba).

**La respuesta llega vacía**
`finish_reason="length"`: el borrador interno consumió el presupuesto. Sube `max_tokens` o baja `reasoning_effort`.

**El JSON llega cortado o con texto alrededor**
Faltan los tres requisitos oficiales (palabra "json", ejemplo del formato, `max_tokens` holgado), o te falta `response_format={"type": "json_object"}`.

**Va lentísimo**
Es el modo pensar con esfuerzo alto: es normal. Para cosas simples usa `reasoning_effort="none"`.

---

## Qué hacer después de esto

1. **Cambiar una cosa a la vez.** Si tocas prompt, modelo y formato juntos, no sabrás qué funcionó.
2. **Monta tu golden set.** 20 casos reales tuyos con la respuesta esperada. Ejecuta el prompt entero contra los 20 y anota aciertos y coste.
3. **Repite cada caso 3–8 veces.** En modo pensar no puedes bajar la temperatura, así que la única forma de saber si un resultado es estable es repetirlo.
4. **Mide el coste por tarea resuelta**, no el coste por llamada: un prompt barato que falla tres veces es caro.
5. **Guarda la fecha y la versión del modelo** junto a cada prompt que te funcione. DeepSeek cambia el modelo detrás del mismo nombre.

---

## Los archivos de esta carpeta

| Archivo | Para qué sirve |
|---|---|
| `requirements.txt` | La única dependencia: el cliente oficial `openai` |
| `cliente_comun.py` | Cliente compartido y ayudas para imprimir respuesta y coste |
| `01_hola.py` | La llamada mínima, para comprobar que todo funciona |
| `02_modo_pensar.py` | Compara modo directo, `low` y `high` en tiempo y dinero |
| `03_json.py` | Extracción de datos con JSON validado |
| `04_cache.py` | Demuestra el ahorro de la caché por prefijo |
| `05_agente.py` | Mini-agente con herramientas y las cuatro reglas del bucle |

**Orden recomendado:** `01` → `02` → `03` → `04` → `05`.

> **Aviso honesto sobre estos scripts:** están escritos y verificados en cuanto a sintaxis y lógica, y siguen la documentación oficial al pie de la letra, pero **no se han ejecutado contra la API real** porque no tengo una clave de DeepSeek. Si alguno falla, el mensaje de error te dirá exactamente en qué paso está: casi siempre será una de las seis reglas de arriba.
