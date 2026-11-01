# Prompt de refactor — Bonsai Local IDE 2.4

Actúa como ingeniero senior de Node.js y Windows. Tu tarea es refactorizar el
ciclo de vida del servidor de IA y la modularidad de la interfaz de Bonsai Local
IDE **sin romper nada**. No es un refactor cosmético: hay bugs reales que dejan
`llama-server` vivo, la VRAM ocupada y la ventana del IDE abierta.

Trabaja en el repositorio actual. Antes de editar, lee los archivos que se citan
y reproduce los fallos. Si no puedes verificar algo, dilo; no lo declares hecho.

---

## 1. Contexto del producto

Bonsai Local IDE es una aplicación local para Windows:

- `chat/ui-server.mjs`: servidor HTTP de la interfaz, API, agente y orquestación
  del modelo. Es un archivo grande; parte del trabajo es extraerlo sin cambiar
  su comportamiento.
- `chat/ui/index.html`, `chat/ui/app.js`, `chat/ui/ide.js`, `chat/ui/tema.css`:
  interfaz web servida por `ui-server.mjs`.
- `scripts/start-server.ps1`, `scripts/start-gpu-model.ps1`,
  `scripts/start-gpu-model-rtx4060-optimized.ps1`: lanzadores de `llama-server`.
- `scripts/stop-managed-server.ps1`: cierre del servidor administrado.
- `logs/servidor-administrado-<puerto>.json`: marcador con el PID del lanzador
  (`wrapperPid`) y el PID real de `llama-server.exe` (`pidServidor`).
- `chat/bonsai-chat.mjs`, `chat/harmony.mjs`, `chat/context.mjs`,
  `chat/coder-harness.mjs`: agente, parser Harmony, contexto y herramientas.
- `chat/prueba-*.mjs`: pruebas existentes. `npm test` ejecuta las aisladas;
  `npm run test:navegador` las de Edge/Chrome.

El proyecto usa Node.js >= 22, ESM, PowerShell 5.1 en Windows y ninguna
dependencia nueva si se puede evitar.

---

## 2. Lo que ya se peleó con los modelos (no lo rompas)

Esto es contexto histórico importante. El refactor no debe deshacerlo.

### GPT-OSS y Harmony

- GPT-OSS usa su plantilla Harmony y tool calls nativas.
- El parser PEG de `llama.cpp` falla con varias llamadas y texto mezclado. Por
  eso el servidor arranca con `--skip-chat-parsing` y el proyecto parsea los
  canales Harmony en `chat/harmony.mjs`.
- `chat/bonsai-chat.mjs` conserva un reintento `peg-native` como red de
  seguridad, pero **el flujo normal no depende de él**.
- No añadas regex por modelo ni un parser específico nuevo si no es
  imprescindible. Usa el parser Harmony existente.
- El system prompt de GPT-OSS incluye una guía breve de herramientas con
  nombre, argumentos obligatorios y un ejemplo. No la conviertas en un manual
  enorme.
- `buscar_codigo` acepta `ruta`; los campos extra inocuos se ignoran; los
  obligatorios y los tipos se validan.
- Las llamadas con `arguments` JSON truncados **no se guardan** y las sesiones
  antiguas se sanean antes de reenviar el historial. No reintroduzcas el error
  `Failed to parse tool call arguments as JSON`.

### Contexto

- El contexto es automático, no 50/50. Con 65.536 tokens: unos 53.120 para
  historial y 12.288 reservados para salida.
- La migración `uiVersion` ajusta ajustes viejos. No cambies el presupuesto sin
  una prueba que lo justifique.

### Modelos

- No toques el perfil de Ornith 9B para coding.
- No cambies binarios, GGUF ni descargas.
- No hagas que un modelo desconocido se trate como si tuviera perfil verificado.

---

## 3. Bugs actuales que debes resolver

### 3.1 Detener deja `llama-server` vivo

Reproducción real observada:

```text
scripts/start-gpu-model-rtx4060-optimized.ps1 elige:
  bin\builds\lab-server-mvq2\bin\llama-server.exe

scripts/stop-managed-server.ps1 solo aceptaba:
  bin\llama-server.exe
  .local\opt\...\build-RTX4060-Opt-sm89\bin\llama-server.exe
  %USERPROFILE%\.local\opt\...\build-RTX4060-Opt-sm89\bin\llama-server.exe
```

El marcador era válido, el wrapper estaba vivo y el PID de `llama-server`
también, pero `Test-ServidorEsperado` rechazaba el ejecutable. Entonces
`$Servidores.Count` quedaba en 0, el listener no estaba en la lista y el script
lanzaba:

```text
El puerto 8080 pertenece a un proceso que esta interfaz no administra.
```

La UI mostraba error o decía que había apagado, pero el proceso seguía vivo y
la VRAM seguía ocupada.

Ya se añadió el binario de laboratorio a la lista y se hizo que el script
esperara y fallara si el puerto seguía abierto. **No basta con ese parche:**
hay tres listas de binarios en sitios distintos y volverá a pasar.

### 3.2 Cerrar IDE e IA no cerraba nada

`chat/ui/app.js` hacía:

```js
const boton = $("#servidor-toggle"), cerrar = $("#cerrar-bonsai");
boton.disabled = true;
```

Pero `#servidor-toggle` no existe en `chat/ui/index.html`. El `TypeError`
ocurría antes de llamar a `/api/servidor`, así que el botón **Cerrar IDE e IA**
no hacía nada. Ya se hizo null-safe y se añadió `window.close()` como intento,
pero el diseño sigue duplicado y frágil.

Además, aunque la API respondiera, el cierre debe garantizar:

1. parar `llama-server` y su wrapper;
2. cerrar el puerto 8080 y liberar VRAM;
3. borrar el marcador;
4. cerrar el servidor Node del IDE;
5. cerrar o avisar en la ventana del navegador.

### 3.3 Dos controles distintos para el mismo servidor

- `chat/ui/ide.js` tiene el panel `#server-start` / `#server-stop` y llama a
  `/api/server/start` y `/api/server/stop`. Hace su propio polling cada 10 s.
- `chat/ui/app.js` tiene `controlarServidor()` y llama a `/api/servidor` con
  `encender`, `apagar` o `cerrar`. Hace otro polling cada 15 s.
- Hay etiquetas y estados distintos: “Iniciar/Detener”, “Encender/Apagar IA”,
  “Cerrar IDE e IA”.
- `ide.js` conserva constantes obsoletas de binario/modelo de Ornith
  (`BIN_PATH`, `MODEL_PATH`, `PROJ_PATH`) que no son la fuente real.
- `stopServer()` en `ide.js` ignora el cuerpo del error y solo escribe en
  `console.error`; el usuario no ve por qué falló.
- `stopServer()` espera 1 s y vuelve a consultar; no verifica PID, puerto,
  marcador ni VRAM.

Debe quedar **un solo controlador de estado** y una sola fuente de verdad.

### 3.4 El backend también duplica el ciclo de vida

En `chat/ui-server.mjs` conviven:

- `apagarLlamaServer()`
- `liberarGpu()`
- `configuracionAnterior()`
- `lanzarServidorLlama()`
- `esperarEncendido()`
- rutas `/api/servidor` y `/api/server/start|stop`
- lógica de `busy`, `starting`, `managed`, `empty`

`/api/server/stop` responde `ok` tras 1 s aunque el proceso siga vivo.
`/api/servidor` con `cerrar` no repite la verificación que sí hace `apagar`.
`configuracionAnterior()` y `liberarGpu()` repiten la misma danza de parar,
esperar puerto y medir VRAM con variantes distintas.

### 3.5 Riesgos de cierre

- `server.close(() => process.exit(0))` puede quedarse esperando conexiones
  SSE/keep-alive.
- `closeAllConnections()` se llama después; el orden y el timeout deben ser
  explícitos.
- Si el modelo no se puede parar, **no** se debe cerrar el IDE como si todo
  hubiera ido bien.
- Un servidor ajeno en el puerto no se debe matar nunca.
- Un marcador rancio no debe bloquear un arranque nuevo.
- Un wrapper huérfano no debe dejar vivo a su hijo.
- Un fallo al arrancar no debe dejar un proceso o marcador huérfano.

---

## 4. Arquitectura objetivo

No tienes que copiar estos nombres al pie de la letra, pero sí separar
responsabilidades y dejar contratos claros.

### 4.1 Registro único de binarios

Crea una fuente de verdad, por ejemplo:

```text
config/llama-binaries.json
```

Con los binarios permitidos y su identificador lógico:

```json
{
  "binaries": [
    { "id": "lab-server-mvq2", "relative": "bin/builds/lab-server-mvq2/bin/llama-server.exe" },
    { "id": "optimized-sm89", "relative": ".local/opt/bonsai-inference/build-RTX4060-Opt-sm89/bin/llama-server.exe" },
    { "id": "optimized-sm89-user", "relative": "%USERPROFILE%/.local/opt/bonsai-inference/build-RTX4060-Opt-sm89/bin/llama-server.exe" },
    { "id": "legacy-root", "relative": "bin/llama-server.exe" }
  ]
}
```

El lanzador y el registrador de parada deben leer la misma lista. El marcador
debe guardar `binId` y `exe`; la parada valida que el ejecutable real coincida
con el `binId`/ruta permitida. Si mañana se añade otro build, se toca un solo
sitio.

Alternativa aceptable: un módulo `chat/lifecycle/binary-registry.mjs` que
exporte la lista y que los scripts PowerShell consulten por JSON. No dupliques
la lista en tres archivos.

### 4.2 Módulo de ciclo de vida en Node

Extrae de `ui-server.mjs` un módulo, por ejemplo:

```text
chat/lifecycle/managed-server.mjs
chat/lifecycle/process-adapter.mjs
chat/lifecycle/state.mjs
```

API sugerida:

```js
inspect({ port }) // { state, port, marker, wrapperPid, serverPid, exe, binId, model, vramFreeMiB }
start({ model, preset, context, kv, vision, thinking, port }) // { state:"ready", pid, wrapperPid, model }
stop({ port, timeoutMs, verifyVram }) // { state:"empty", stoppedPids, portClosed, markerRemoved, vramFreeMiB }
restart(options) // stop + start, con rollback si start falla
closeIde({ server, timeoutMs }) // stop + cierre del servidor HTTP
```

Requisitos:

- Un mutex/cola para que `start`, `stop` y `close` no se pisen.
- `stop()` idempotente: si ya está vacío, responde éxito sin error.
- `inspect()` distingue `empty`, `starting`, `ready`, `stopping`, `foreign`,
  `error`.
- `stop()` no responde éxito hasta comprobar:
  - PID(s) muertos;
  - puerto cerrado;
  - marcador borrado;
  - VRAM liberada si `nvidia-smi` está disponible (con umbral y timeout).
- `closeIde()` no cierra el servidor HTTP si el modelo no se pudo parar.
- Todos los errores llevan contexto: estado, PIDs, puerto, marcador y última
  salida del helper.

### 4.3 PowerShell como adaptador fino

Mantén los scripts existentes por compatibilidad, pero haz que devuelvan JSON
estructurado cuando se les pida, por ejemplo `-Json`:

```json
{
  "ok": true,
  "state": "empty",
  "port": 8080,
  "stoppedPids": [1234, 5678],
  "portClosed": true,
  "markerRemoved": true
}
```

No imprimas mensajes humanos mezclados con el JSON en ese modo. Node debe
parsear el JSON, no adivinar por texto.

El script de parada debe:

1. leer el marcador;
2. validar puerto, modelo, `binId` y ejecutable;
3. encontrar el wrapper y el `llama-server` real;
4. matar el servidor;
5. esperar a que muera y a que cierre el puerto;
6. matar el wrapper si quedó atascado;
7. borrar el marcador;
8. fallar con código distinto de 0 si algo sigue vivo, sin borrar el marcador.

Nunca debe matar un proceso ajeno. Si el puerto pertenece a otro proceso,
devuelve `foreign` y no toca nada.

### 4.4 Una sola API

Conserva las rutas actuales como alias, pero crea un contrato claro:

```text
GET  /api/server/state
POST /api/server/start
POST /api/server/stop
POST /api/server/close
```

`/api/servidor` puede seguir existiendo y delegar en el mismo módulo. No
dupliques la lógica de parada en dos rutas.

Respuestas de ejemplo:

```json
{ "ok": true, "state": "ready", "model": "gpt-oss-20b", "port": 8080, "pid": 1234 }
{ "ok": true, "state": "empty", "stoppedPids": [1234, 5678], "portClosed": true, "markerRemoved": true }
```

Errores con HTTP 409 si hay una operación en curso y 500 solo si de verdad
falló. No devuelvas `ok:true` si el puerto sigue escuchando.

### 4.5 Una sola UI

Elimina el panel duplicado de `ide.js` o haz que use el mismo controlador que
`app.js`. Lo importante:

- un único estado `servidor`;
- un único polling, no dos;
- un único sitio que decide si se muestra Iniciar, Detener o Cerrar;
- errores visibles para el usuario (toast), no solo `console.error`;
- botones deshabilitados mientras hay una operación;
- **Cerrar IDE e IA** pide confirmación, llama a `/api/server/close`, espera la
  respuesta y luego intenta `window.close()`; si el navegador no la cierra,
  muestra el aviso de que ya puede cerrar la pestaña;
- si el cierre falla, el botón vuelve a estar disponible y se muestra el error
  real.

No uses `#servidor-toggle` si no existe. Si decides mantener un toggle,
créalo en el HTML y que sea el único. Si no, elimina esa rama muerta.

### 4.6 Cierre del servidor HTTP

En `ui-server.mjs`:

```js
server.closeAllConnections();
const timer = setTimeout(() => process.exit(1), 3000);
server.close(() => {
  clearTimeout(timer);
  process.exit(0);
});
```

Adáptalo a la API real de Node 22 y a las conexiones SSE. El proceso no debe
quedar colgado por un stream abierto. Si el modelo no se paró, no cierres el
IDE: devuelve error y deja el servidor vivo para reintentar.

---

## 5. Qué no debes tocar

- No cambies el parser Harmony ni el flujo `--skip-chat-parsing` salvo que el
  refactor lo necesite y tengas una prueba que demuestre que no rompe.
- No reintroduzcas el parser PEG como camino normal.
- No añadas regex específicas por modelo.
- No cambies el presupuesto de contexto ni la guía de herramientas para
  “mejorar” el modelo.
- No toques Ornith 9B para coding.
- No modifiques binarios, GGUF, modelos descargados ni el Hub.
- No mates procesos ajenos ni servidores de otros puertos.
- No añadas frameworks, CDN ni dependencias nuevas sin justificarlo.
- No hagas un refactor masivo de `ui-server.mjs` que mezcle ciclo de vida con
  agente/contexto. Extrae por responsabilidad y conserva las exportaciones.
- No dejes código muerto, ramas duplicadas ni comentarios que digan que algo
  funciona si no lo probaste.

---

## 6. Plan de trabajo recomendado

1. **Reproducir** los fallos con el modelo real y anotar PID, puerto, marcador
   y VRAM antes/después. Guarda la evidencia.2. **Escribir primero las pruebas de regresión** que fallen:
   - parada de un marcador con el binario de laboratorio;
   - parada idempotente;
   - puerto ocupado por un proceso ajeno;
   - wrapper huérfano;
   - `Cerrar IDE e IA` con la UI viva;
   - error de parada que no debe cerrar la UI.
3. **Extraer el registro de binarios** y hacer que lanzador y parada lo usen.
4. **Extraer el módulo de ciclo de vida** y migrar `/api/servidor` y
   `/api/server/*` a él.
5. **Unificar la UI** en un controlador; eliminar el panel duplicado.
6. **Cerrar el servidor HTTP** con timeout y sin dejar conexiones.
7. **Añadir observabilidad**: logs claros y un estado consultable.
8. **Pasar toda la suite** y hacer una prueba end-to-end real.
9. **Documentar** el contrato y el nuevo flujo en `docs/LIFECYCLE.md`.
10. **Commit/tag/release** solo cuando todo esté verde.

Haz commits pequeños y con intención. No mezcles el refactor del ciclo de vida
con cambios del agente o de la app de tareas.

---

## 7. Pruebas y criterios de aceptación

### 7.1 Aisladas

```powershell
npm test
```

Debe seguir en verde. Hoy son 48/48; si añades pruebas, el número puede subir,
pero no debe haber fallos.

### 7.2 Navegador

```powershell
npm run test:navegador
npm run docs:links
```

Hoy: 7/7 y 0 enlaces rotos.

### 7.3 Regresiones del agente

```powershell
node chat/prueba-gpt-oss-tools.mjs
node chat/prueba-small-coder.mjs
```

Deben seguir pasando. No cambies el comportamiento de las tools para hacer que
el ciclo de vida pase.

### 7.4 End-to-end real (GPU)

Con GPT-OSS cargado y la UI en 8787:

```powershell
node scripts/e2e-lifecycle.mjs
```

Debe comprobar:

1. **Detener**: `llama-server` muere, el puerto 8080 se cierra, el marcador se
   borra, la UI 8787 sigue viva.
2. **Rearranque**: el modelo vuelve a estar `ready` y el marcador tiene un
   `pidServidor` nuevo.
3. **Cerrar IDE e IA**: mueren modelo y UI, no queda marcador y la VRAM vuelve
   al nivel de reposo (si `nvidia-smi` está disponible).

Amplía este script si hace falta. No lo sustituyas por una simulación y digas
que el ciclo de vida está probado.

### 7.5 Casos negativos obligatorios

- Un servidor HTTP ajeno en el puerto: `stop` devuelve `foreign`, no lo mata.
- Marcador rancio: se limpia sin bloquear.
- Wrapper muerto con hijo vivo: se cierra el hijo.
- Dos `stop` concurrentes: ambos responden sin error y no queda proceso.
- Fallo al arrancar: no queda marcador ni proceso hijo.
- Fallo al parar: la UI no se cierra y el error se muestra.
- `Cerrar IDE e IA` con cambios sin guardar: pide confirmación.

---

## 8. Entregables

- [ ] Registro único de binarios.
- [ ] Módulo de ciclo de vida con estado, start, stop, restart y close.
- [ ] PowerShell devolviendo JSON y validando por marcador + binario.
- [ ] Rutas unificadas y alias compatibles.
- [ ] UI con un solo controlador y errores visibles.
- [ ] Cierre de Node con timeout y sin conexiones colgadas.
- [ ] Pruebas nuevas de regresión y end-to-end.
- [ ] `docs/LIFECYCLE.md` con el contrato y el diagrama de estados.
- [ ] `CHANGELOG.md` y release notes.
- [ ] Evidencia real: PIDs, puerto, marcador y VRAM antes/después.

---

## 9. Formato de tu respuesta final

No respondas “implementado y listo”. Responde con:

1. **Qué cambié** (archivos y módulos).
2. **Qué probé** (comandos y resultados concretos).
3. **Evidencia del ciclo de vida** (PID/puerto/VRAM antes y después).
4. **Qué no pude probar** y por qué.
5. **Riesgos o deuda pendiente**.

Si algo sigue fallando, dilo claramente. Es mejor un informe honesto con un
fallo reproducible que una promesa sin evidencia.
