# Handoff de correcciones — Auditoría de solo lectura

**Commit auditado:** `34e1fd2`  
**Fecha:** 2026-10-29  
**Destinatario:** agente implementador  
**Objetivo:** corregir todos los hallazgos de la auditoría sin degradar el perfil actual del IDE.

> Este documento es una especificación de trabajo, no un informe para el usuario final.
> Las líneas de código son orientativas y corresponden al commit `34e1fd2`. Verificarlas antes de editar.

---

## 0. Instrucciones para el agente

1. **Leer este documento completo antes de tocar código.**
2. Trabajar en una rama nueva, por ejemplo `fix/auditoria-2026-10-29`.
3. Hacer commits pequeños y atómicos: un hallazgo o un grupo coherente por commit.
4. No hacer `push`, release, tag ni cambio de versión sin autorización explícita.
5. No cambiar el perfil actual:
   - **43.008 tokens**
   - **KV F16**
   - **visión activada**
   - **pensamiento activado**
6. No “arreglar” un problema desactivando una función, bajando el contexto de forma silenciosa o quitando visión.
7. No tocar modelos, binarios, chats, logs privados ni estado local.
8. No detener el servidor que pueda estar en marcha sin autorización. Para pruebas, usar el arnés del proyecto o puertos alternativos.
9. Para cada hallazgo:
   - reproducirlo o dejar evidencia clara de por qué no es reproducible;
   - añadir una prueba de regresión cuando sea viable;
   - aplicar el cambio mínimo;
   - ejecutar la prueba específica y la suite correspondiente;
   - actualizar el estado de la casilla.
10. Si un hallazgo exige una decisión de producto, **preguntar antes de inventar**. No cerrar un P2 como “arreglado” si solo se documentó.

### Definición de “terminado”

- Todos los **P1** cerrados con prueba o evidencia manual reproducible.
- Todos los **P2** corregidos o, si son decisiones de producto, documentados y aprobados explícitamente.
- `npm test` en verde.
- `npm run test:navegador` en verde.
- Pruebas GPU en verde si el entorno las permite.
- Sin cambios en `chat/modelo.json` que alteren 43.008/F16/visión/pensamiento.
- Sin secretos, logs privados, modelos ni archivos generados en el commit.
- Informe final con hallazgos cerrados, pruebas ejecutadas y riesgos residuales.

---

## 1. Contexto

La auditoría fue de solo lectura. No se encontró un **P0 reproducible** en condiciones normales, pero sí **8 P1** y varios **P2**.

Estado observado al cierre de la auditoría:

- `git status --short`: vacío.
- `HEAD`: `34e1fd2`.
- llama.cpp en **8080**, PID **15084**, ejecutable del proyecto.
- Interfaz en **8787**, PID **12640**, `node.exe`.
- Perfil en ejecución: 43.008 tokens, KV F16, visión y pensamiento.

El servidor puede seguir en marcha cuando el agente empiece. No forma parte del alcance detenerlo o reconfigurarlo.

---

## 2. Matriz de hallazgos P1

| ID | Área | Hallazgo | Evidencia principal | Esfuerzo | Estado |
|---|---|---|---|---|---|
| P1-01 | UI | Enter confirma diálogos destructivos | `chat/ui/app.js:199-206,214`; llamadas en `613,1147,2146` | S | [ ] |
| P1-02 | UI | CRLF se convierte a LF al guardar | `chat/ui/app.js:433,479-485,559-564,590-595`; `chat/ui-server.mjs:1901-1907` | M | [ ] |
| P1-03 | UI | F5 durante un turno deja la UI bloqueada | `chat/ui/chat-core.js:1086-1095,1165`; `chat/ui-server.mjs:1798,2828,2853` | M/L | [ ] |
| P1-04 | UI | HTML/SVG de artefactos se abre en el mismo origen | `chat/ui/chat-core.js:285,289-290`; `chat/ui-server.mjs:292,296,1758-1775` | M | [ ] |
| P1-05 | UI | Carrera entre carga inicial y primer mensaje | `chat/ui/chat-core.js:975-976,1409-1412,1826` | S | [ ] |
| P1-06 | llama/GPU | El margen objetivo de 200 MiB no se aplica | `chat/modelo.json:56`; `scripts/start-gpu-model.ps1:23,32,78-81,163,199` | S/M | [ ] |
| P1-07 | Agente | La verificación oculta errores nuevos | `chat/coder-harness.mjs:717,728-733` | S | [ ] |
| P1-08 | Agente | El undo de borrado promete una copia inexistente | `chat/ui-server.mjs:3334-3337,3345`; `chat/actions.mjs:446` | S/M | [ ] |

**Leyenda de esfuerzo:** S ≈ menos de 1 hora; M ≈ medio día; L ≈ uno o varios días.

---

## 3. P1 en detalle

### P1-01 · Enter confirma diálogos destructivos

**Estado:** [ ]

**Síntoma:**  
El diálogo simple de confirmación escucha `keydown` en `document`. Cualquier Enter ejecuta `cerrar(true)`, aunque el foco esté en Cancelar.

**Evidencia:**
- `chat/ui/app.js:199-206`: listener global que llama `cerrar(true)` con Enter.
- `chat/ui/app.js:214`: el foco inicial se pone en el botón de aceptar.
- `chat/ui/app.js:613`, `1147`, `2146`: llamadas destructivas.
- `chat/ui/app.js:1928-1936`: el otro diálogo sí comprueba `!r.borra`; el simple no.

**Causa:**  
El listener no comprueba el `event.target` ni distingue entre confirmar y cancelar. El foco por defecto agrava el problema.

**Cambio requerido:**
- No cerrar con Enter desde un listener global.
- Confirmar solo si el evento nace en el botón de aceptar, o añadir una opción `peligroso`.
- En diálogos destructivos, poner el foco en Cancelar.
- Mantener Escape como cancelar.
- Evitar que el mismo Enter active dos veces el diálogo o el botón subyacente.

**Criterios de aceptación:**
- Enter con foco en Cancelar **no** borra ni confirma.
- Enter con foco en Aceptar confirma una vez.
- Escape cancela siempre.
- Un clic en el fondo cancela.
- Los tres callers destructivos siguen funcionando con clic explícito.

**Pruebas:**  
Test DOM de teclado para el diálogo; si no existe infraestructura DOM, añadir una prueba unitaria de la función de decisión y una comprobación manual documentada.

**Riesgo de regresión:**  
Diálogos no destructivos que esperan que Enter acepte. Resolver con opción explícita, no cambiando todos los diálogos a la vez.

---

### P1-02 · El editor convierte CRLF a LF al guardar

**Estado:** [ ]

**Síntoma:**  
Un archivo con CRLF se abre, se edita y se guarda completo con LF. El diff muestra todo el archivo cambiado.

**Evidencia:**
- `chat/ui-server.mjs:1901-1907`: la API entrega el texto crudo.
- `chat/ui/app.js:559-564`: el cliente lo guarda tal cual en la pestaña.
- `chat/ui/app.js:433`: el `<textarea>` recibe el texto.
- `chat/ui/app.js:479-485`: se lee el valor del editor.
- `chat/ui/app.js:590-595`: se envía al guardar.
- El navegador normaliza CRLF a LF en un `<textarea>`.

**Causa:**  
No se conserva el formato de saltos de línea del archivo original. La edición trabaja en LF y el guardado no reconstruye CRLF.

**Cambio requerido:**
- Detectar el estilo de EOL al abrir: CRLF, LF o mixto.
- Guardar ese metadato en la pestaña.
- Editar internamente en LF.
- Al guardar, reconstruir el EOL original.
- Conservar también el salto de línea final si el archivo lo tenía.
- Para archivos mixtos, definir una política explícita: conservar el estilo dominante o avisar y no modificar sin confirmación.

**Criterios de aceptación:**
- Abrir un `.txt` CRLF, cambiar una línea y guardar: el archivo sigue en CRLF.
- Abrir un `.bat` o `.cmd` CRLF y guardar: no se convierte a LF.
- Un archivo LF sigue en LF.
- El diff de Git muestra solo la línea editada, no todo el archivo.
- Se conserva el salto final original.
- Los archivos truncados siguen sin poder guardarse como si fueran completos.

**Pruebas:**  
Test de integración con archivos temporales CRLF/LF/mixto; comprobar bytes antes y después. No usar archivos reales del usuario.

**Riesgo de regresión:**  
Archivos generados por el agente que ya se escriben en LF. La normalización debe aplicarse al editor, no necesariamente a todas las escrituras del agente.

---

### P1-03 · F5 durante un turno deja la interfaz bloqueada

**Estado:** [ ]

**Síntoma:**  
Si el usuario recarga mientras el modelo trabaja:
- el servidor sigue ocupado;
- la UI no muestra salida en vivo;
- no aparece el botón Detener;
- el siguiente mensaje recibe 409.

**Evidencia:**
- `chat/ui-server.mjs:1798`: `/api/state` expone `busy`.
- `chat/ui/chat-core.js:1086-1095`: `loadState()` no hidrata `busy`.
- `chat/ui/chat-core.js:1165`: la visibilidad de `#stop` depende de `pumping`, que arranca en falso.
- `chat/ui-server.mjs:2828`: existe `/api/stop`.
- `chat/ui-server.mjs:2853`: `/api/chat` responde 409 si hay turno.

**Causa:**  
El estado del turno vive en el servidor, pero la UI reconstruida no lo incorpora. No hay reconexión al stream ni un estado de “turno en curso” recuperable.

**Cambio requerido:**
- Hidratar `busy` desde `/api/state`.
- Mostrar Detener y bloquear el composer mientras haya turno.
- Implementar `/api/stop` desde ese estado.
- Decidir una de estas opciones:
  - **Mínimo:** tras F5, mostrar “turno en curso” y permitir cancelar; no prometer salida en vivo.
  - **Completo:** reanudar el stream con `Last-Event-ID` o un endpoint de estado del turno.
- Evitar que el siguiente mensaje se encole sin saber que el servidor está ocupado.

**Criterios de aceptación:**
- Recargar durante un turno muestra estado ocupado y Detener.
- Detener libera el servidor y permite enviar otro mensaje.
- No queda un 409 silencioso.
- Si se implementa reconexión, no se duplican tokens ni se pierde el historial.
- Si no se implementa reconexión, la UI lo dice claramente.

**Pruebas:**  
Simular un turno lento, recargar, comprobar estado; probar Detener; probar envío posterior. Añadir prueba de integración si el arnés lo permite.

**Riesgo de regresión:**  
El botón Detener actual depende de `pumping`; cambiar esa lógica puede afectar el encolado normal.

---

### P1-04 · HTML/SVG de artefactos se abre en el mismo origen

**Estado:** [ ]

**Síntoma:**  
El botón “Abrir” de un artefacto usa `window.open`. `/p/` sirve HTML como `text/html` y SVG como `image/svg+xml`, sin CSP ni sandbox. El iframe inline sí está sandboxeado, pero abrir en pestaña evita esa protección.

**Evidencia:**
- `chat/ui/chat-core.js:285`: `window.open`.
- `chat/ui/chat-core.js:289-290`: iframe inline con `sandbox="allow-scripts"`.
- `chat/ui-server.mjs:292,296`: MIME de `.html` y `.svg`.
- `chat/ui-server.mjs:1758-1775`: handler de `/p/` y `/salida/`.
- `chat/guardia.mjs`: la guardia acepta peticiones same-origin; no protege contra un artefacto abierto en el mismo origen.

**Causa:**  
Un artefacto HTML/SVG generado por el modelo o presente en un repo no confiable se ejecuta en `127.0.0.1:8787`, el mismo origen que la API del IDE.

**Impacto:**  
Puede llamar a `/api/*` con la sesión local. No se ejecutó un exploit; es un hecho de código.

**Cambio requerido:**
- Preferido: servir artefactos en un origen o puerto separado.
- Alternativa: aplicar `Content-Security-Policy: sandbox` para que la pestaña tenga un origen opaco.
- Añadir `noopener` si se mantiene `window.open`.
- No permitir HTML arbitrario en el origen de la app.
- Mantener el iframe inline sandboxeado.

**Criterios de aceptación:**
- Un HTML de prueba con `<script>fetch('/api/state')</script>` no puede leer la API del IDE.
- El artefacto sigue renderizando en el iframe inline.
- Abrir en pestaña sigue siendo posible si se usa un origen aislado.
- Los SVG con scripts no pueden acceder a la API.

**Pruebas:**  
Fixture HTML/SVG inerte que intente `fetch("/api/state")`; comprobar que falla o que el origen es opaco. No usar payloads destructivos.

**Riesgo de regresión:**  
Los artefactos que dependen de rutas relativas o de `window.opener` pueden dejar de funcionar. Documentar el nuevo contrato.

---

### P1-05 · Carrera entre carga inicial y primer mensaje

**Estado:** [ ]

**Síntoma:**  
El composer acepta mensajes antes de que termine `loadState()`. Si el usuario envía rápido, `paintConversation()` reemplaza el log y puede desconectar la burbuja del primer stream.

**Evidencia:**
- `chat/ui/chat-core.js:1826`: arranque de `loadState()`.
- `chat/ui/chat-core.js:1409-1412`: el composer acepta envío.
- `chat/ui/chat-core.js:975-976`: `log.replaceChildren()`.

**Causa:**  
No hay una barrera de inicialización entre la carga del estado y el primer turno.

**Cambio requerido:**
- Bloquear el composer hasta que la carga inicial termine, o
- hacer que `paintConversation()` preserve nodos vivos y se fusione con el estado.
- Si se bloquea, mostrar un estado breve de “cargando” y liberar también si la carga falla.
- Evitar un deadlock si `/api/workspace` tarda o falla.

**Criterios de aceptación:**
- Con `/api/state` retrasado artificialmente, enviar un mensaje no pierde la respuesta.
- No se duplican mensajes.
- Si la carga falla, el usuario puede reintentar o seguir con un estado vacío controlado.
- El primer token aparece en la burbuja correcta.

**Pruebas:**  
Test con retraso artificial de `/api/state`; comprobar orden de eventos y DOM final.

**Riesgo de regresión:**  
El envío en cola y la hidratación de conversaciones existentes. Probar ambos.

---

### P1-06 · El margen objetivo de 200 MiB no se aplica

**Estado:** [ ]

**Síntoma:**  
`margenObjetivoMiB: 200` solo aparece en el catálogo. El arranque compara la estimación con la VRAM libre, pero `SafetyMiB` vale 0 por defecto. El perfil de 43.008 tokens puede aceptarse con menos de 200 MiB de colchón.

**Evidencia:**
- `chat/modelo.json:56`: `margenObjetivoMiB: 200`.
- `scripts/start-gpu-model.ps1:23,32`: `SafetyMiB = 0` por defecto.
- `scripts/start-gpu-model.ps1:78-81`: cálculo de `RequiredMiB`.
- `scripts/start-gpu-model.ps1:163,199`: comparación `RequiredMiB <= FreeMiB`.
- `chat/modelo.json:42-44`: mínimo medido de 106 MiB para 43.008/F16; 44.032 falló.
- Medición previa con carga externa: 62 MiB libres.

**Causa:**  
El valor de margen no está conectado a la lógica de arranque.

**Cambio requerido:**
- Leer `margenObjetivoMiB` desde el catálogo o desde una opción explícita.
- Aplicarlo como colchón adicional en la comparación.
- No bajar el contexto automáticamente sin avisar.
- Si 43.008 no cumple el margen:
  - bloquear con un mensaje claro; o
  - permitir un override explícito, documentado y visible.
- Mantener el perfil automático actual.
- No cambiar los valores del catálogo para “hacer que pase”.

**Criterios de aceptación:**
- Con VRAM libre insuficiente, 43.008 no arranca en silencio.
- El error dice cuánta VRAM falta y qué opciones hay.
- El perfil automático sigue funcionando.
- No se reduce el contexto sin consentimiento.
- La decisión queda documentada.

**Pruebas:**  
Dry-run con `FreeMiBOverride` para casos por encima y por debajo del margen. Probar el mensaje y el override. No ejecutar pruebas GPU que interfieran con el servidor actual sin autorización.

**Riesgo de regresión:**  
Endurecer el margen puede impedir el arranque de 43.008 en esta máquina. Es preferible un bloqueo explícito a un OOM silencioso; si el usuario quiere conservar 43.008, debe existir una excepción consciente.

---

### P1-07 · La verificación oculta errores nuevos

**Estado:** [ ]

**Síntoma:**  
Si un archivo ya tenía un error de sintaxis antes del turno, la comprobación de sintaxis nueva se omite. Además, los diagnósticos se deduplican solo por mensaje.

**Evidencia:**
- `chat/coder-harness.mjs:717`: condición `!before?.syntaxErrors`.
- `chat/coder-harness.mjs:728-733`: deduplicación por `message`.

**Causa:**  
La comparación con el estado anterior es demasiado amplia y la identidad del diagnóstico es incompleta.

**Cambio requerido:**
- Comparar diagnósticos por archivo, línea, columna y código.
- Suprimir solo coincidencias exactas con el estado anterior.
- Si el archivo ya era inválido, no ignorar errores nuevos: tratar el parseo fallido como verificación fallida.
- No convertir un error preexistente en un pase libre.
- Añadir un test con dos errores del mismo mensaje en líneas distintas.

**Criterios de aceptación:**
- Un error nuevo con el mismo mensaje en otra línea hace fallar la verificación.
- Un error preexistente idéntico no se reporta como nuevo.
- Un archivo que sigue roto no termina DONE.
- El resumen de verificación explica qué error es nuevo.

**Pruebas:**  
Test unitario de la función de comparación con diagnósticos sintéticos; test de integración con archivo temporal.

**Riesgo de regresión:**  
La verificación puede volverse más ruidosa con errores preexistentes legítimos. La comparación exacta evita falsos positivos.

---

### P1-08 · El undo de borrado promete una copia inexistente

**Estado:** [ ]

**Síntoma:**  
Solo se guarda copia para archivos de texto dentro del límite y sin byte NUL. Aun así, la respuesta y la descripción de la herramienta afirman que hay copia para cualquier archivo.

**Evidencia:**
- `chat/ui-server.mjs:3334-3337`: guarda copia solo para texto válido y acotado.
- `chat/ui-server.mjs:3345`: mensaje “hay copia para deshacer”.
- `chat/actions.mjs:446`: descripción que promete copia.

**Causa:**  
La interfaz de la herramienta no distingue entre “borrado con undo” y “borrado sin undo”.

**Cambio requerido:**
- Devolver `undo: false` cuando no se haya guardado copia.
- Adaptar el mensaje al resultado real.
- Para borrados sin undo:
  - exigir confirmación fuerte; o
  - mover a una papelera del proyecto.
- No anunciar una capacidad no verificada.
- Mantener el undo de archivos de texto funcionando.

**Criterios de aceptación:**
- Borrar un binario devuelve `undo: false` y lo dice claramente.
- Borrar un archivo grande devuelve `undo: false`.
- Borrar un `.txt` pequeño sigue permitiendo undo.
- La descripción de `borrar` no promete undo universal.
- El agente no intenta deshacer y falla después.

**Pruebas:**  
Test con archivo de texto, binario y archivo por encima del límite. Comprobar respuesta y efecto.

**Riesgo de regresión:**  
El flujo de “revertir turno” usa la lista de undos. Asegurar que los borrados sin copia no se añaden a esa lista.

---

## 4. Matriz de hallazgos P2

| ID | Área | Hallazgo | Evidencia | Esfuerzo | Estado |
|---|---|---|---|---|---|
| P2-01 | UI | Foco robado al terminar turno o recargar archivo | `chat-core.js:1183`; `app.js:438,669-703` | S | [ ] |
| P2-02 | UI | Render Markdown completo durante streaming | `chat-core.js:319-329,1288-1289` | M | [ ] |
| P2-03 | UI | Diálogos sin `aria-labelledby`/focus trap; `#error` sin `aria-live` | `app.js:177-215`; `index.html:651` | S | [ ] |
| P2-04 | UI | Timers solapados; solo el poll de archivo mira `document.hidden` | `app.js:703,2167,2479,2482`; `index.html:732`; `paneles.js:392-395` | S/M | [ ] |
| P2-05 | GPU | `liberarGpu` usa 6500 MiB fijos e `Infinity` si falla `nvidia-smi` | `ui-server.mjs:1194-1226` | S | [ ] |
| P2-06 | GPU | Reserva de visión 900 MiB vs `mmproj` ~879 MiB | `modelo.json:35-40`; `start-gpu-model.ps1:71` | S | [ ] |
| P2-07 | GPU | Cambio de modelo acepta 65.536 y valida el techo después de parar | `engine-profiles.mjs:47`; `cambio-modelo.mjs:5-6`; `ui-server.mjs:2411-2436` | M | [ ] |
| P2-08 | GPU | Presets con nombre validan; `CUSTOM` no | `ui-server.mjs:1631` | S | [ ] |
| P2-09 | GPU | Logs nativos solo con `BONSAI_LLAMA_LOG_PREFIX` | `start-gpu-model.ps1:280-283` | S | [ ] |
| P2-10 | GPU | Versión de llama.cpp solo se imprime al compilar | `build-inference-runtime.ps1:74` | S | [ ] |
| P2-11 | GPU | `start-ui` sin `-PassThru`, sin detectar lanzador muerto, espera 3 min | `start-ui.ps1:153,159-175` | M | [ ] |
| P2-12 | GPU | Carrera arranque/marcador | `start-gpu-model.ps1:44,276-301` | S/M | [ ] |
| P2-13 | GPU | Reutilización no compara modelo; `$activeKey` solo dentro de visión | `start-ui.ps1:124-133` | S | [ ] |
| P2-14 | Agente | `indice(carpeta)` ignora la carpeta | `coder-harness.mjs:571-579` | S | [ ] |
| P2-15 | Agente | `ejecutar` del coder no expone `repetir` | `coder-harness.mjs:124-128`; `actions.mjs:341,633` | S | [ ] |
| P2-16 | Agente | Perfil legacy recorta lotes a 6/8 sin avisar | `actions.mjs:726-736`; notas en `720-725` | S | [ ] |
| P2-17 | Agente | `.bonsai-coder.json` acepta `{file,args}` arbitrarios y se ejecuta en verificación | `project-verification.mjs:9-18`; `coder-harness.mjs:764-789` | M | [ ] |
| P2-18 | Agente | Reglas de proyecto se elevan a instrucciones | `context.mjs:171`; `context.mjs:21` | S/M | [ ] |
| P2-19 | Agente | `leer_web` puede acceder a servicios locales; solo bloquea puertos del IDE/modelo | `investigacion.mjs:21-28,129-135` | M | [ ] |
| P2-20 | Agente | `verify` y DONE pueden declarar éxito sin cambios | `coder-harness.mjs:647-653`; `ui-server.mjs:3910` | S/M | [ ] |

**Nota:** P2-17 y P2-20 son **candidatos a P1** si se confirma que la verificación automática ejecuta configuración sin pasar por permiso, o si un pedido de edición puede terminar DONE sin cambios. Investigar antes de cerrar.

---

## 5. P2 en detalle

### UI

- [ ] **P2-01 · Foco robado.**
  - Evidencia: `chat-core.js:1183` devuelve el foco al composer al terminar el turno; `app.js:438,669-703` lo roba al recargar un archivo externo.
  - Acción: devolver el foco solo si el usuario estaba en el composer o si el diálogo lo requiere. No mover el foco si el usuario está escribiendo en otro panel.
  - Aceptación: editar en el editor mientras termina un turno no expulsa el cursor.

- [ ] **P2-02 · Render Markdown completo durante streaming.**
  - Evidencia: `chat-core.js:319-329,1288-1289`.
  - Acción: medir primero el coste con una respuesta larga. Si hay jank, renderizar por bloques o actualizar solo el último nodo.
  - Aceptación: una respuesta larga no bloquea la UI de forma perceptible; el HTML final coincide con el actual.

- [ ] **P2-03 · Accesibilidad de diálogos y errores.**
  - Evidencia: `app.js:177-215`; `index.html:651`.
  - Acción: añadir `aria-labelledby`, focus trap, restauración del foco y `aria-live` a `#error`.
  - Aceptación: navegación completa con teclado y lector de pantalla; el error se anuncia sin mover el foco.

- [ ] **P2-04 · Timers solapados.**
  - Evidencia: `app.js:703,2167,2479,2482`; `index.html:732`; `paneles.js:392-395`; solo `app.js:671` comprueba `document.hidden`.
  - Acción: pausar o reducir timers cuando la pestaña está oculta; evitar solapamientos si una petición tarda más que el intervalo.
  - Aceptación: no se acumulan peticiones; el consumo en segundo plano baja; los datos se refrescan al volver.

### llama.cpp / GPU

- [ ] **P2-05 · `liberarGpu` con umbral fijo e `Infinity`.**
  - Evidencia: `ui-server.mjs:1194-1226`.
  - Acción: no usar `Infinity` como éxito si `nvidia-smi` falla; distinguir “no se pudo medir” de “hay VRAM”. Hacer configurable el umbral o derivarlo del perfil.
  - Aceptación: un fallo de `nvidia-smi` no provoca un arranque a ciegas; el mensaje explica el estado.

- [ ] **P2-06 · Reserva de visión.**
  - Evidencia: `modelo.json:35-40`; `start-gpu-model.ps1:71`.
  - Acción: documentar por qué 900 MiB es correcto frente a 879 MiB o ajustar el valor con evidencia.
  - Aceptación: el presupuesto y la reserva quedan explicados; no se cambia el valor sin medición.

- [ ] **P2-07 · Cambio de modelo y techo real.**
  - Evidencia: `engine-profiles.mjs:47`; `cambio-modelo.mjs:5-6`; `ui-server.mjs:2411-2436`.
  - Acción: validar el techo antes de parar el servidor cuando sea posible; si no, mantener rollback y un mensaje claro.
  - Aceptación: un contexto inválido no deja el IDE sin modelo; el rollback se prueba.

- [ ] **P2-08 · Validación de `CUSTOM`.**
  - Evidencia: `ui-server.mjs:1631`.
  - Acción: aplicar a `CUSTOM` las mismas validaciones de contexto, KV y visión que a los presets con nombre.
  - Aceptación: un `CUSTOM` inválido se rechaza antes de arrancar.

- [ ] **P2-09 · Logs nativos.**
  - Evidencia: `start-gpu-model.ps1:280-283`.
  - Acción: definir un prefijo por defecto o documentar cómo activarlo; no dejar el diagnóstico dependiendo de una variable no configurada.
  - Aceptación: un arranque normal deja logs suficientes para diagnosticar un fallo.

- [ ] **P2-10 · Versión de llama.cpp.**
  - Evidencia: `build-inference-runtime.ps1:74`.
  - Acción: imprimir la versión también al arrancar o guardarla en el marcador.
  - Aceptación: el informe de arranque permite saber qué binario se está usando.

- [ ] **P2-11 · `start-ui` y lanzador muerto.**
  - Evidencia: `start-ui.ps1:153,159-175`.
  - Acción: usar `-PassThru` o comprobar el proceso; detectar muerte temprana y no esperar tres minutos.
  - Aceptación: si el lanzador muere, el error aparece en segundos con causa.

- [ ] **P2-12 · Carrera arranque/marcador.**
  - Evidencia: `start-gpu-model.ps1:44,276-301`.
  - Acción: escribir el marcador de forma atómica y comprobar que el proceso sigue vivo antes de declarar éxito.
  - Aceptación: no queda un marcador de un servidor que no arrancó.

- [ ] **P2-13 · Reutilización de servidor y modelo.**
  - Evidencia: `start-ui.ps1:124-133`.
  - Acción: comparar `CurrentMarker.modelo` con el modelo activo; sacar `$activeKey` del bloque de visión.
  - Aceptación: no se reutiliza un servidor de otro modelo por accidente.

### Agente / herramientas

- [ ] **P2-14 · `indice(carpeta)` ignora la carpeta.**
  - Evidencia: `coder-harness.mjs:571-579`.
  - Acción: aplicar el filtro de carpeta o eliminar el parámetro si no se va a soportar.
  - Aceptación: `indice("src")` devuelve solo esa carpeta; el resultado es determinista.

- [ ] **P2-15 · `repetir` en el coder.**
  - Evidencia: `coder-harness.mjs:124-128`; `actions.mjs:341,633`.
  - Acción: exponer `repetir` en el schema del coder si el comportamiento subyacente lo soporta.
  - Aceptación: el modelo puede forzar una comprobación nueva sin cambiar de herramienta.

- [ ] **P2-16 · Recorte silencioso de lotes legacy.**
  - Evidencia: `actions.mjs:726-736`; notas en `720-725`.
  - Acción: añadir notas para writes/edits/borrados/movidos recortados, igual que para comandos y búsquedas.
  - Aceptación: el modelo y el usuario saben qué acciones quedaron fuera.

- [ ] **P2-17 · `.bonsai-coder.json` arbitrario.**
  - Evidencia: `project-verification.mjs:9-18`; `coder-harness.mjs:764-789`.
  - Acción: revisar si la verificación automática respeta el modo `ask`. Si no, hacer que los comandos de proyecto pasen por el flujo de permiso o por una allowlist. Documentar el riesgo.
  - Aceptación: un repositorio no confiable no puede ejecutar comandos arbitrarios solo por incluir `.bonsai-coder.json`.
  - **Prioridad:** investigar como posible P1.

- [ ] **P2-18 · Reglas de proyecto vs datos.**
  - Evidencia: `context.mjs:171`; `context.mjs:21`.
  - Acción: definir explícitamente qué fuentes son instrucciones (reglas del usuario) y qué fuentes son datos (archivos, web, memoria global). No elevar contenido de archivos a instrucciones.
  - Aceptación: la documentación y el prompt coinciden; una regla de proyecto legítima sigue funcionando.

- [ ] **P2-19 · `leer_web` y servicios locales.**
  - Evidencia: `investigacion.mjs:21-28,129-135`.
  - Acción: bloquear rangos privados, loopback y metadatos, o exigir una allowlist explícita. Mantener el aviso de “dato no confiable”.
  - Aceptación: una URL a `127.0.0.1`, `169.254.169.254` o rangos privados no se lee por defecto.

- [ ] **P2-20 · DONE sin cambios.**
  - Evidencia: `coder-harness.mjs:647-653`; `ui-server.mjs:3910`.
  - Acción: no marcar DONE si el usuario pidió una edición y no hubo cambios; distinguir “consulta” de “tarea de edición”. Exigir al menos una verificación real o un mensaje explícito de “no se necesitaban cambios”.
  - Aceptación: “arregla este bug” no termina DONE sin diff ni explicación.
  - **Prioridad:** investigar como posible P1.

---

## 6. Orden de ejecución recomendado

### Fase 0 — Preparación

- [ ] Crear rama de trabajo.
- [ ] Confirmar que el árbol está limpio.
- [ ] Ejecutar la suite base y guardar el resultado.
- [ ] Leer los archivos implicados y verificar las líneas.
- [ ] No tocar el servidor en marcha sin autorización.

### Fase 1 — Seguridad de datos y falsos verdes

- [ ] P1-01: Enter seguro.
- [ ] P1-07: diagnósticos exactos.
- [ ] P1-08: undo honesto.
- [ ] P1-05: gate de carga inicial.

**Motivo:** son cambios pequeños y evitan pérdida de datos o falsos éxitos.

### Fase 2 — Integridad del editor y GPU

- [ ] P1-02: conservar CRLF.
- [ ] P1-06: margen de VRAM.
- [ ] P1-04: aislar artefactos HTML/SVG.

**Motivo:** afectan a archivos reales, estabilidad del modelo y superficie de ejecución.

### Fase 3 — Recuperación tras recarga

- [ ] P1-03: estado ocupado, Detener y reconexión.

**Motivo:** es el cambio de mayor alcance; hacerlo después de estabilizar el resto.

### Fase 4 — P2

- [ ] UI: P2-01 a P2-04.
- [ ] GPU: P2-05 a P2-13.
- [ ] Agente: P2-14 a P2-20.
- [ ] Investigar P2-17 y P2-20 como posibles P1.

### Fase 5 — Validación y cierre

- [ ] Suite completa.
- [ ] Pruebas manuales.
- [ ] Revisar diff.
- [ ] Actualizar `CHANGELOG.md` si corresponde.
- [ ] Informe final.

---

## 7. Plan de pruebas

### Comandos disponibles

```powershell
npm test
npm run test:navegador
npm run test:gpu
npm run test:gpu-exclusiva
npm run test:todo
```

### Reglas

- No ejecutar pruebas GPU si interfieren con el servidor actual.
- No usar archivos reales del usuario para pruebas de borrado o CRLF; usar un workspace temporal.
- No descargar modelos.
- No commitear logs, capturas privadas ni modelos.
- Si una prueba falla por entorno y no por el cambio, documentarlo con el error exacto.

### Pruebas específicas mínimas

- [ ] P1-01: teclado en diálogo destructivo.
- [ ] P1-02: CRLF/LF/mixto con bytes antes/después.
- [ ] P1-03: turno lento + recarga + Detener.
- [ ] P1-04: HTML/SVG que intenta `fetch("/api/state")`.
- [ ] P1-05: retraso de `/api/state` + envío inmediato.
- [ ] P1-06: dry-run por encima/debajo del margen.
- [ ] P1-07: dos errores iguales en líneas distintas.
- [ ] P1-08: texto, binario y archivo grande.
- [ ] P2-17: `.bonsai-coder.json` con comando inofensivo en modo `ask`.
- [ ] P2-20: pedido de edición sin cambios.

### Pruebas manuales de regresión

- [ ] Abrir/editar/guardar un archivo normal.
- [ ] Abrir/editar/guardar un `.bat` CRLF.
- [ ] Cancelar un borrado con Enter y con Escape.
- [ ] Confirmar un borrado con clic.
- [ ] Recargar durante un turno y cancelar.
- [ ] Abrir un artefacto HTML y comprobar que no puede llamar a la API.
- [ ] Iniciar el IDE con el perfil actual.
- [ ] Comprobar 43.008/F16/visión/pensamiento.
- [ ] Cambiar de modelo y volver al anterior.
- [ ] Usar undo de texto.
- [ ] Verificar que un borrado binario no promete undo.

---

## 8. Restricciones y no objetivos

- No cambiar los valores de `chat/modelo.json` que definen 43.008/F16/visión/pensamiento.
- No bajar el contexto de forma automática.
- No desactivar visión ni pensamiento para “simplificar”.
- No modificar el servidor en marcha sin autorización.
- No hacer release, tag ni push sin autorización.
- No descargar modelos ni binarios grandes.
- No incluir chats, logs privados, estado local ni evidencia con rutas personales.
- No refactorizar masivamente archivos completos para un cambio pequeño.
- No cerrar un P2 como “documentado” sin decisión explícita.
- No declarar un P1 arreglado sin prueba o evidencia manual reproducible.

---

## 9. Informe final que debe entregar el agente

Incluir:

1. Rama y commits.
2. Hallazgos cerrados, con ID.
3. Hallazgos que quedaron abiertos y por qué.
4. Pruebas ejecutadas y resultado.
5. Evidencia manual de los casos que no tengan test automatizado.
6. Cambios de comportamiento visibles para el usuario.
7. Riesgos residuales.
8. Confirmación de que no se cambió el perfil 43.008/F16/visión/pensamiento.
9. Confirmación de que no se incluyeron secretos, logs privados ni modelos.

### Plantilla

```markdown
## Resultado

- Rama:
- Commits:
- P1 cerrados:
- P2 cerrados:
- P2 documentados:
- P1/P2 abiertos:

## Pruebas

- `npm test`:
- `npm run test:navegador`:
- `npm run test:gpu`:
- Pruebas específicas:

## Evidencia manual

...

## Riesgos residuales

...

## Confirmaciones

- [ ] Perfil 43.008/F16/visión/pensamiento intacto.
- [ ] Sin secretos, logs privados ni modelos.
- [ ] Sin release ni push no autorizado.
```

---

## 10. Referencia rápida de archivos

| Archivo | Uso |
|---|---|
| `chat/ui/app.js` | Diálogos, editor, pestañas, foco, polling, CRLF |
| `chat/ui/chat-core.js` | Estado, streaming, artefactos, busy, foco |
| `chat/ui/index.html` | Estructura, `#error`, `#stop`, paneles |
| `chat/ui-server.mjs` | API, agente, `/api/stop`, `/p/`, undo, salud |
| `chat/coder-harness.mjs` | Fases, verificación, schemas, límites |
| `chat/actions.mjs` | Schemas, efectos, lotes, undo |
| `chat/context.mjs` | Prompt de sistema, reglas, contenido no confiable |
| `chat/modelo.json` | Perfiles, VRAM, visión, margen |
| `scripts/start-gpu-model.ps1` | Arranque, VRAM, margen, marcador, logs |
| `scripts/start-ui.ps1` | Lanzamiento, salud, reutilización |
| `chat/engine-profiles.mjs` | Validación de contexto y presets |
| `chat/cambio-modelo.mjs` | Parar/arrancar y rollback |
| `chat/project-verification.mjs` | Comandos de verificación del proyecto |
| `chat/investigacion.mjs` | `leer_web`, puertos bloqueados, SSRF |
| `chat/archivos-seguros.mjs` | Escrituras atómicas y rutas |
| `chat/guardia.mjs` | Anti-CSRF / DNS rebinding |
| `scripts/stop-managed-server.ps1` | Parada segura por PID y marcador |
| `chat/bonsai-chat.mjs` | Contexto, visión y presupuesto |
| `chat/ui/markdown.js` | Render Markdown y URLs seguras |

---

**Fin del handoff.**  
Si algo de este documento no coincide con el código actual, prevalece el código y hay que anotar la discrepancia antes de cambiar nada.
