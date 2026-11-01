# Diagnóstico adicional de GPT-OSS

Prueba del 1 de noviembre de 2026. Este diagnóstico no cambia Harmony, herramientas,
muestreo, presupuestos de contexto, perfil de Ornith, binarios ni GGUF.

## Método

`node scripts/diagnose-gpt-oss.mjs` levanta una UI y GPT-OSS reales con puertos libres,
copia los ajustes actuales a un estado aislado y solicita una app de tareas sin
dependencias: API CRUD, HTML/CSS/JS, persistencia JSON y tests con `node --test`.
El código generado permanece en la carpeta de evidencia, sin corregirlo manualmente.

Perfil efectivo: `small-local-coder`, ventana 65536, salida del perfil 12288, pensar
512, KV q8_0, memoria global desactivada. Son los ajustes existentes, no una propuesta
de tuning. La traza informa una reserva total de 12800 contando razonamiento y un
presupuesto efectivo de entrada de 52608; no se comparan esas cifras con la corrida
de lifecycle de pensar 4096 como si fueran el mismo ensayo.

La captura usa `BONSAI_RAW_STREAM`, que ya existía. Se conserva el SSE que recibe la
UI, cada evento crudo del modelo, las trazas del agente y el estado de sesión.
`node scripts/analyze-gpt-oss.mjs` analiza esos datos usando **el parser Harmony y el
validador originales**, sin normalizar ni ejecutar llamadas.

- [Evidencia del ensayo y limpieza](gpt-oss-diagnostic/evidence.json)
- [Stream crudo del modelo](gpt-oss-diagnostic/raw-stream.jsonl)
- [Stream de la UI](gpt-oss-diagnostic/ui-stream.sse)
- [Análisis de protocolo](gpt-oss-diagnostic/protocol-analysis.json)
- [Proyecto generado, exportado sin metadatos Git](gpt-oss-diagnostic/generated-project/)

## Hallazgos comprobados

1. **Parece bloqueado mientras sigue generando.** Los deltas llegan como Harmony en
   `content`, no como `delta.tool_calls`. En `BonsaiChat.streamSlice`, el cliente difiere
   la emisión de texto para los candidatos Harmony y parsea canales/tools al finalizar
   la generación. En el primer salto hubo aproximadamente 61 s de generación antes de
   recibir/ejecutar `archivo`. Los latidos SSE mantienen viva la conexión, pero no
   sustituyen progreso visible de una llamada larga en formato crudo.

2. **El modelo produce código y reparaciones incorrectos.** La prueba real creó
   `server.mjs`, `index.html`, `style.css`, `script.js` y `task.test.mjs`. El primer test
   falló porque importaba `fileURLToPath` de `node:path`. Las reparaciones introdujeron
   `beforeAll`, `afterAll`, `onFinish` y `expect` desde `node:test`: el runtime devolvió
   errores concretos de símbolos no disponibles. No son errores del lanzador ni de
   propiedad de procesos. La sintaxis sola había pasado; no demostraba funcionamiento.

3. **Hay análisis repetitivo tras los errores.** Una respuesta de reparación superó
   13000 caracteres crudos, con razonamientos reiterados sobre APIs inexistentes,
   antes de emitir otra sustitución. Se midió generación real, no un socket detenido.
   Los caracteres no equivalen a tokens: este ensayo no prueba que el límite de
   razonamiento del servidor se aplique exactamente a Harmony crudo.

4. **Llamadas truncadas/desconocidas no se deben confundir con este fallo.** Las llamadas
   observadas hasta la reparación tenían JSON completo y nombres válidos (`archivo`,
   `reemplazar`), y produjeron efectos en disco. El JSON final de protocolo conserva
   todos los nombres, validaciones y razones de cierre. No se observó un error PEG,
   OOM o transporte como explicación de esos tests fallidos.

5. **El modelo no dio respuesta final; el host sí cerró el turno.** El resultado fue
   `done { motivo: "repair_limit", saltos: 9, incompleto: true }`, con cuatro intentos
   de reparación agotados. Las 10 respuestas SSE finalizaron con `stop`, sin `length`,
   y contenían análisis + una llamada válida cada una, pero ningún canal `final`.
   La décima fue otra sustitución durante el cierre; no se ejecutó. El host la descartó
   y mostró «No llegué a cerrar con un resumen (el modelo quería seguir con otra
   acción)» más las acciones reales y el test con código 1. Esto reproduce ausencia de
   final del modelo y tarea sin terminar; **no** un turno HTTP permanentemente bloqueado.

La corrida duró de 07:09:30Z a 07:17:32Z (01:09–01:17 en Costa Rica), incluido arranque y
limpieza. El modelo PID 67852 y wrapper 67380 terminaron; se borró el marcador y cerraron
8080 y 8787. La API verificó 7845 MiB libres frente a umbral 7700. Los tests generados
siguen fallando; no se reparó la app por fuera del agente para presentar un éxito.

La revisión automática rechazó borrar `.git` del sandbox de diagnóstico (mensaje:
`blocked by policy`). Se preservan esos metadatos en el sandbox local ignorado y se
exportan los archivos a `generated-project` para la evidencia versionada. No quedan
procesos de esa prueba; esta restricción de limpieza no se elude con otro método.

Límite del harness de esta corrida: el Git separado se inicializó después del primer
snapshot de `preexistingGit`, que por ello menciona el repositorio padre. Las ediciones
observadas quedaron en los cinco archivos del sandbox. El script guardado inicializa
Git antes de arrancar la UI; no se usa ese snapshot inicial para evaluar la app.

## Qué explica los otros síntomas y qué falta reproducir

El rechazo «función desconocida» se origina en `validateCall`, cuando el nombre exacto
no existe en `CODER_TOOLS`. Hace falta la llamada cruda concreta para atribuirle una
causa como nombre inventado o formato incorrecto; esta corrida no justifica inventar
aliases ni afirmar que se reprodujo ese síntoma. En el historial local se encontró un
rechazo por argumentos JSON inválidos de `reemplazar`, pero esa sesión no incluye el
modelo: no se atribuye automáticamente a GPT-OSS ni se publica el contenido del usuario.

Los argumentos incompletos se descartan antes de persistirlos y se sanea el historial
antiguo. Las pruebas aisladas cubren ese contrato, pero sus respuestas simuladas no
demuestran que un modelo real vaya a terminar una aplicación. El benchmark directo
previo [sí completó una app](../webapp-bench-2026-10-31T14-35-37/gpt-oss-20b/run1/result.json),
con 8 checks de API y 3 de UI. Ese camino generaba archivos como texto; no es el mismo
ciclo iterativo de tools y reparación medido aquí.

## Trabajo posterior recomendado

- Usar estos streams como casos de regresión del progreso visible y del cierre con
  solo análisis, conservando la regla de no ejecutar JSON parcial.
- Añadir una prueba de calidad del agente con una app real y tests ejecutados; separar
  aprobación de sintaxis, funcionamiento y cumplimiento del pedido completo.
- Capturar un caso real de tool desconocida con su catálogo exacto antes de cambiar
  nombres, schemas o parsers. No se modifican esas piezas protegidas en este refactor.
- Tratar los fallos del proyecto generado como tarea incompleta, con motivo de parada
  y respuesta final explícitos. No presentar las suites de infraestructura verdes como
  una mejora de la capacidad de GPT-OSS para programar.
