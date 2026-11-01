# Bonsai Local IDE 2.3.3

**Fecha:** 1 de noviembre de 2026
**Tema:** GPT-OSS ya no depende del parser roto de llama.cpp.

`peg-native` no era un fallo del prompt ni del modelo: es el parser PEG de
llama.cpp rechazando la salida Harmony. La solución definitiva es no usarlo.
GPT-OSS arranca con `--skip-chat-parsing`, entrega Harmony crudo y **Bonsai lo
parsea**. Las tool calls se siguen ejecutando por el camino nativo
(`nativeToolEffects`), con la misma validación y los mismos resultados.

---

## Qué cambia

### 1. GPT-OSS arranca sin parser nativo

- `start-gpu-model-rtx4060-optimized.ps1` y `start-gpu-model.ps1` añaden
  `--skip-chat-parsing` cuando el modelo es GPT-OSS/Harmony.
- El comando de servidor que muestra la UI también lo incluye.
- El servidor ya no puede devolver el 500 de `peg-native`, porque no intenta
  interpretar la salida.

### 2. Parser Harmony propio

`chat/harmony.mjs` separa los canales reales del modelo:

```text
<|channel|>analysis<|message|>We need to create a file.<|end|>
<|start|>assistant<|channel|>commentary to=functions.archivo
<|constrain|>json<|message|>{"ruta":"skip.txt","contenido":"skip"}
```

- `analysis` → panel de pensamiento, nunca la respuesta final.
- `final` → texto que ve el usuario.
- `commentary to=functions.NOMBRE` → tool call nativa con argumentos JSON.
- Varias llamadas en el mismo turno se conservan.
- Si no hay marcadores Harmony, el texto pasa intacto al fallback
  `gpt-oss-json`; no se rompe el camino anterior.

El parser no pinta los marcadores `<|channel|>` en la UI. En GPT-OSS se bufferiza
la salida, se parsea al final y se emiten el pensamiento y las tool calls.

### 3. El reintento queda como red de seguridad

Si alguien arranca GPT-OSS sin `--skip-chat-parsing`, 2.3.2 sigue intentando:
primero una sola tool call nativa; si vuelve a fallar, catálogo como texto y
JSON. 2.3.3 evita llegar a ese caso en el arranque normal.

### 4. Verificación

Prueba real con el servidor skip y `BonsaiChat`:

- Petición directa: `archivo` con `ruta` y `contenido` correctos.
- Agente completo: creó `skip-e2e.txt`, respondió limpio y no mostró Harmony.
- `chat/harmony.mjs`: análisis, final, una llamada, varias llamadas, texto
  normal y JSON suelto.
- `chat/prueba-gpt-oss-tools.mjs`: nativas, fallback, raw stream, reintento y
  error final.
- 500 forzado con proxy: el reintento nativo produjo una tool call válida.

| Comprobación | Resultado |
|---|---|
| `npm test` | **48/48** |
| `npm run test:navegador` | **7/7** |
| `npm run docs:links` | **0 enlaces rotos** |
| App GPT-OSS 2.3.1 | **10/10 tests + 11/11 navegador** |

## Límite honesto

El parser Harmony es nuestro; si llama.cpp cambia los marcadores o el modelo
emite un canal nuevo, hay que actualizarlo. `chat/harmony.mjs` tiene self-test y
la salida cruda (`BONSAI_RAW_STREAM=1`) permite capturar el caso exacto. La
alternativa —volver al parser PEG— es la que fallaba.

## Actualizar

```powershell
git pull
npm run build:ui-vendor
.\scripts\crear-acceso-directo.ps1
```

El acceso directo arranca GPT-OSS con `--skip-chat-parsing` y la UI 2.3.3.
