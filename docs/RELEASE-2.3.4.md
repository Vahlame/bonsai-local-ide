# Bonsai Local IDE 2.3.4

**Fecha:** 1 de noviembre de 2026
**Tema:** presupuesto automático real y menos ataduras para GPT-OSS.

Esta release corrige dos cosas que hacían que GPT-OSS se sintiera limitado:

1. El contexto se partía **50/50** porque un ajuste viejo guardaba
   `historial: 32768`. Ahora el presupuesto vuelve a ser automático:
   `ventana - salida - margen`.
2. El prompt obligaba a **una sola tool call por respuesta** para esquivar el
   parser PEG roto. Con el parser Harmony propio ya no hace falta: se permiten
   varias llamadas independientes y el host devuelve un resultado por cada una.

---

## Contexto automático

Con GPT-OSS 20B y 65.536 tokens de ventana:

| Antes | Ahora |
|---|---|
| historial 32.768 | **historial 53.120** |
| salida 32.768 | **salida 12.288** |
| `auto: false` | **`auto: true`** |

El cambio se aplica una sola vez en la migración `uiVersion 2.3.4`: si el
`historial` guardado es el viejo default `32768`, se pone a `0` (automático).
Después puedes fijar un tope manual desde Ajustes si de verdad lo necesitas.

La reserva de salida automática baja de 18k a **12.288** tokens: cubre una tool
call de escritura y deja ~80 % de la ventana para historial, herramientas y
resultados. Si un archivo necesita más, `escribir_partes` lo divide.

## Menos restricciones

- Se eliminó del `TOOL_WORKFLOW` la regla de «una sola tool call por
  respuesta». El parser Harmony (`chat/harmony.mjs`) ya soporta varias llamadas
  en el mismo turno y las convierte en tool calls nativas.
- Las llamadas independientes pueden ir juntas; las dependientes esperan el
  resultado anterior.
- El reintento `peg-native` sigue existiendo como red de seguridad si alguien
  arranca GPT-OSS sin `--skip-chat-parsing`, pero no condiciona el prompt normal.

## Verificación

Prueba real con GPT-OSS y el servidor Harmony:

```text
1. Crea nota.txt con "uno".
2. Lee nota.txt.
3. Reemplaza "uno" por "dos".
4. Lee nota.txt para confirmar.
5. Responde con el contenido final.
```

Resultado: **5 pasos, 19,4 s**, archivo final `dos`, sin errores y con la
respuesta final limpia. La migración dejó el presupuesto en `auto: true`,
`efectivo: 53120`, `reservaSalida: 12288`.

| Comprobación | Resultado |
|---|---|
| `npm test` | **48/48** |
| `npm run test:navegador` | **7/7** |
| `npm run docs:links` | **0 enlaces rotos** |
| Flujo multi-paso GPT-OSS | **correcto** |

## Límite honesto

El parser Harmony es propio y hay que mantenerlo si llama.cpp cambia sus
marcadores. La salida cruda (`BONSAI_RAW_STREAM=1`) sigue disponible. El
presupuesto automático reserva 12k de salida; si tu tarea genera archivos
mucho más grandes, usa escritura por partes o fija un tope manual.

## Actualizar

```powershell
git pull
npm run build:ui-vendor
.\scripts\crear-acceso-directo.ps1
```

El acceso directo abrirá la UI 2.3.4; la migración ajusta el historial una vez.
