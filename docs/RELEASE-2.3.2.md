# Bonsai Local IDE 2.3.2

**Fecha:** 1 de noviembre de 2026
**Tema:** que un parser roto no tumbe el turno.

`peg-native` es un error del parser PEG de llama.cpp: cuando GPT-OSS emite
varias tool calls o texto antes de la llamada, el servidor responde HTTP 500 y
el turno se perdía. 2.3.2 añade un reintento controlado que evita el parser
nativo y recupera la llamada como JSON estructurado.

---

## Qué cambia

Cuando `streamSlice` recibe un 500 cuyo mensaje contiene `peg-native`:

1. Solo lo intenta con GPT-OSS/Harmony; no enmascara errores de otros modelos.
2. No reintenta una continuación (`continue_final_message`), para no duplicar
   una generación ya empezada.
3. Reintenta **sin `tools` nativas**. El catálogo de herramientas viaja como
   texto en el system prompt, con la instrucción de responder solo con:

   ```json
   {"name":"archivo","arguments":{"ruta":"a.txt","contenido":"uno"}}
   ```

4. GPT-OSS devuelve ese JSON en `content`; el dialecto `gpt-oss-json` lo
   convierte a la misma forma que una tool call nativa y `nativeToolEffects` la
   ejecuta.
5. Si el reintento también falla, el error se propaga. Nunca se finge una
   respuesta completa.

El reintento se anuncia en el estado (`[parser nativo rechazó la salida;
reintento en modo JSON]`) y queda en el historial de la sesión.

## Prueba

`chat/prueba-gpt-oss-tools.mjs` simula el 500 y comprueba:

- el primer request lleva `tools` y falla con `peg-native`;
- el segundo no lleva `tools`;
- el system prompt contiene el catálogo y la instrucción de JSON;
- el `content` devuelto se parsea con `llamadasCrudas` y produce dos archivos.

También se probó el camino real de GPT-OSS en 2.3.1: la app de la prueba pasó
10/10 tests y 11/11 comprobaciones de navegador. Esa app sigue en
`trabajo/gpt-oss-todo/` (ignorada por Git).

## Verificación

| Comprobación | Resultado |
|---|---|
| `npm test` | **47/47** |
| `npm run test:navegador` | **7/7** |
| `npm run docs:links` | **0 enlaces rotos** |
| `chat/prueba-gpt-oss-tools.mjs` | Reintento `peg-native` OK |

## Límite honesto

El parser PEG de llama.cpp sigue siendo el que falla; Bonsai lo rodea, no lo
arregla. Si el reintento JSON tampoco produce una llamada válida, el turno
termina con error visible. La salida cruda (`BONSAI_RAW_STREAM=1`) sigue siendo
la herramienta para diagnosticar el caso concreto.

## Actualizar

```powershell
git pull
npm run build:ui-vendor
.\scripts\crear-acceso-directo.ps1
```
