# Validación de GPT-OSS y de la distribución visual

1 de noviembre de 2026, Windows, Node v26.0.0 y Windows PowerShell 5.1.
Candidato local en `main`: `package.json` sigue en 2.3.6 y el CHANGELOG en Unreleased.
Este informe complementa la [validación del ciclo de vida](../lifecycle-2026-11-01/VALIDATION.md).

## Cambios

- Explorador e Historial comparten una columna con pestañas accesibles. El editor
  ocupa el centro y el chat una columna proporcionada a la derecha; hasta 1000 px
  el chat pasa debajo. El margen exterior y los divisores son de 4 px. Los tamaños
  se ajustan con arrastre o flechas, se guardan y se restablecen con doble clic.
- Doce temas, galería, iconos por acción y tipo de archivo, sintaxis y terminal
  adaptados al tema. Las animaciones respetan `prefers-reduced-motion`.
- El parser Harmony existente admite destinatarios antes o después del canal,
  incluidas herramientas en `analysis`. El progreso aparece durante la generación,
  sin ejecutar argumentos parciales. Los IDs de llamadas son únicos por respuesta.
- El orquestador conserva el estado de respuestas truncadas o solo de razonamiento,
  solicita corregir llamadas inválidas y separa el resumen final de la fase de tools.
- El verificador aporta exportaciones reales de Node al corregir imports. La API de
  `node:test` se consulta en un hijo para evitar instalar sus hooks en el IDE.
- Una comprobación HTTP aislada impide aprobar la interfaz de una app Node nativa
  detectable solo porque pasen sus tests de API. El adaptador actual reconoce
  `server.mjs` con `export ... startServer(port)`, pide puerto efímero y comprueba
  HTML y recursos JS/CSS locales. No ejecuta interacciones del navegador.
- Si el 404 se debe a una resolución de URL comprobable en `server.mjs`, el
  verificador devuelve el dato exacto: base `new URL` sin barra final o ruta
  absoluta que se sale de `public/`. Las sondas sueltas como `testRoot.js` o
  `testServer.js` ya no se confunden con suites.

No se alteraron `--skip-chat-parsing`, el catálogo de herramientas, los presupuestos
de contexto, el perfil de Ornith, Hub, binarios ni GGUF. Los ajustes personales se
copiaron a estados aislados para las pruebas GPU.

## Pruebas

Las ejecuciones finales de las suites completas se registran en
[tests-recovery-final.txt](tests-recovery-final.txt) y
[browser-layout-final.txt](browser-layout-final.txt).
Pasaron 51/51 suites aisladas (165.1 s, después de la recuperación de sangría) y
9/9 de navegador (81.7 s), respectivamente. La ejecución anterior de 51/51 también
se conserva en [tests-layout-final.txt](tests-layout-final.txt).

La repetición final, con el diagnóstico de URL y el filtro de sondas ya aplicados,
pasó 51/51 (133.3 s) en [tests-final-2.txt](tests-final-2.txt) y 9/9 (64.9 s) en
[browser-final-2.txt](browser-final-2.txt). `npm run docs:links` recorrió 37
documentos y 120 enlaces con 0 rotos en
[docs-links-finish.txt](docs-links-finish.txt).
La [prueba focalizada de apariencia](appearance-layout-pass.txt) comprueba doce temas,
contraste de texto normal y secundario sobre el panel >= 4.5:1, persistencia, pestañas
sin desplazar el editor, divisores con teclado y ratón, tamaños 560–1600 y movimiento
reducido. Las capturas finales están en [appearance-release](appearance-release/),
con [su repetición focalizada](appearance-release.txt) después de ajustar la sintaxis
de los temas claros. La suite completa usó [appearance-suite-final](appearance-suite-final/).

[small-coder-web.txt](small-coder-web.txt) verifica que GET / 404 y un recurso JS 404
impidan finalizar, y que HTML/JS accesibles permitan seguir. Las regresiones de
protocolo con modelo simulado comprueban JSON truncado, herramientas desconocidas,
reintento y cierre acotado. Son pruebas del host, no evidencia de calidad GPU.
La [regresión de recuperación de sangría](agent-protocol-recovered.txt) añade una
lectura previa y un reemplazo rechazado: verifica que no se edite nada hasta volver
a llamar con el bloque JSON exacto. No se aplican coincidencias difusas.

## Modelo real y calidad de la aplicación

La [primera ejecución](gpt-oss-first/evidence.json) produjo cuatro tests CRUD verdes
y terminó como `completed`. La [aceptación independiente](gpt-oss-first/acceptance.json)
descubrió que la raíz HTTP devolvía 404: la API funcionaba, pero la interfaz no estaba
servida. Ese primer resultado **no demuestra una aplicación terminada**. Se conserva
el código generado, los errores intermedios y el resultado fallido.

La [continuación real](gpt-oss-web-final/evidence.json) usó una copia de esos archivos,
sin repararlos manualmente. El nuevo verificador detectó el 404 y devolvió el error
al agente antes de aprobar la tarea. Se agotó el límite de 15 minutos del diagnóstico,
tras varios reemplazos rechazados por sangría y rutas URL mal resueltas; la tarea
no se presenta como completada. Flujo completo en
[gpt-oss-web-final.txt](gpt-oss-web-final.txt).

La revisión siguiente añade referencias de resolución de URL en Node y devuelve
el bloque JSON exacto cuando un reemplazo rechazado solo difiere en sangría y es
único. No cambia el catálogo, la validación ni las reglas de aplicación de herramientas.
La [ejecución con recuperación](gpt-oss-recovered/evidence.json) continúa desde una
copia de ese resultado, sin reparaciones manuales del código de la app.

La [repetición final](gpt-oss-final-2/evidence.json), ya con las sondas separadas de
las suites y el diagnóstico de URL, terminó con `motivo:completed`, 8 pasos,
`incompleto:false` y 4/4 tests. El verificador HTTP confirmó `GET /` y dos recursos
locales. Después, una [aceptación independiente](todo-acceptance-final-2.txt) creó,
listó, completó y borró tareas por API, repitió el CRUD desde el navegador, comprobó
la persistencia al recargar y arrancó la app con `node server.mjs` en el puerto 3000.
Todo pasó ([acceptance.json](gpt-oss-final-2/acceptance.json),
[captura](gpt-oss-final-2/todo-app.png)). El intento
[gpt-oss-final](gpt-oss-final/evidence.json) quedó interrumpido por el límite de la
sesión anterior y se conserva; no se cuenta como éxito.

## Ciclo de vida con GPU real

`node scripts/e2e-lifecycle.mjs --prepare` pasó con el controlador nuevo y GPT-OSS
real. [JSON completo](lifecycle-gpu/e2e-evidence.json), [salida](lifecycle-gpu.txt).

| Operación | PIDs comprobados | Puertos 8080 / 8787 | VRAM libre |
| --- | --- | --- | --- |
| Carga | modelo 59784, wrapper 67520, Node 63236 vivos | abiertos / abiertos | 664 MiB |
| Detener desde UI | modelo y wrapper muertos, Node vivo | cerrado / abierto | 7956 MiB |
| Rearranque | modelo nuevo 69264, wrapper 52192 | abiertos / abiertos | 664 MiB |
| Huérfano | wrapper 52192 muerto, hijo 69264 vivo | abiertos / abiertos | 664 MiB |
| Dos stop | ambos PIDs muertos, sin marcador | cerrado / abierto | 7956 MiB |
| Cerrar desde UI | modelo 68664, wrapper 69364 y Node 63236 muertos | cerrados / cerrados | 7956 MiB |

Solo se terminó el wrapper propio para provocar el huérfano. El E2E previo de la
2.3.6 ya pasaba al comenzar: no se afirma reproducir el bug histórico sin parche.

La repetición final con el controlador y la UI actuales también pasó. Evidencia:
[e2e-evidence.json](lifecycle-final/e2e-evidence.json), [salida](lifecycle-final.txt).

| Operación | PIDs comprobados | Puertos 8080 / 8787 | VRAM libre |
| --- | --- | --- | --- |
| Carga | modelo 59548, wrapper 71016, Node 62128 vivos | abiertos / abiertos | 896 MiB |
| Detener desde UI | modelo y wrapper muertos, Node vivo | cerrado / abierto | 7784 MiB |
| Rearranque | modelo 51460, wrapper 58492 | abiertos / abiertos | 896 MiB |
| Huérfano | wrapper 58492 muerto, hijo 51460 vivo | abiertos / abiertos | 896 MiB |
| Dos stop | ambos PIDs muertos, sin marcador | cerrado / abierto | 7784 MiB |
| Cerrar desde UI | modelo 63836, wrapper 22568 y Node 62128 muertos | cerrados / cerrados | 7784 MiB |

`node scripts/e2e-lifecycle-failures.mjs` volvió a pasar con GPU real en
[lifecycle-faults-final](lifecycle-faults-final/faults-evidence.json):
cancelación durante preflight, fallo inyectado después de cargar (wrapper 56388,
modelo 68004), rechazo de `binId` inválido preservando modelo 59380/wrapper 64936,
rollback a 52108/68620 y limpieza final con 7765 MiB libres.

## Intentos fallidos conservados

- La primera prueba del nuevo diagnóstico de Node reveló una exportación no
  reconocida; importar `node:test` dentro del IDE provocó además un fallo de cierre
  de Node 26. Se corrigió consultando la API en un proceso hijo. Ese output quedó
  en la conversación; no se presenta como un log guardado en este directorio.
- [browser-first.txt](browser-first.txt): 7/8; un icono de marca superaba 24 px.
  Se redujo y las siguientes suites se ejecutaron de nuevo.
- [appearance-layout-final.txt](appearance-layout-final.txt): la comprobación de
  orientación necesitaba esperar el evento de resize. Después,
  [appearance-layout-retry.txt](appearance-layout-retry.txt) y
  [appearance-layout-debug.txt](appearance-layout-debug.txt) detectaron el divisor
  oculto por CSS antiguo. Se restauró su visibilidad y funcionamiento.
- [appearance-layout-verified.txt](appearance-layout-verified.txt): Windows rechazó
  sobrescribir una captura con `UNKNOWN`. Las capturas posteriores usan un directorio
  por ejecución; [appearance-layout-pass.txt](appearance-layout-pass.txt) pasó.
- [agent-protocol-final.txt](agent-protocol-final.txt) y
  [agent-protocol-recovery-debug.txt](agent-protocol-recovery-debug.txt): el fixture
  intentaba editar sin lectura previa y la guardia lo rechazaba antes del caso que
  queríamos probar. Se corrigió el fixture para leer primero; no se relajó la guardia.
- Los fallos de permisos del sandbox anteriores pertenecen al
  [informe de ciclo de vida](../lifecycle-2026-11-01/VALIDATION.md), no se borran ni
  se mezclan con las ejecuciones posteriores autorizadas.

## Límites

No se probó específicamente Node 22 ni multi-GPU; NVIDIA usa la primera GPU.
Edge/Chrome se ejecutaron en Windows: no se validaron otros sistemas ni lectores
de pantalla. Se comprobó el aviso alternativo de cierre del navegador, sin garantizar
cerrar cualquier ventana `--app`. El contraste medido corresponde a los colores de
texto/panel de las doce paletas, no a una auditoría WCAG de todos los estados.

La comprobación HTTP tiene un contrato acotado; otras estructuras deben aportar
tests o comandos en `.bonsai-coder.json`. GPT-OSS puede seguir generando errores:
reintentos y verificaciones reducen fallos y evitan algunos falsos cierres, pero una
aplicación concreta que pase no garantiza que cualquier tarea futura termine bien.
