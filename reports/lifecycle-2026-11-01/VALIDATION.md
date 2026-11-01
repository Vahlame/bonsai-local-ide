# Validación del refactor de ciclo de vida

Fecha local: 1 de noviembre de 2026 (America/Costa_Rica). Los JSON conservan timestamps UTC.
Repositorio en `main`, candidato local 2.4.0; `package.json` permanece en 2.3.6 y el
CHANGELOG en Unreleased. No se publica release ni tag.

## Alcance y estado

Registro único de binarios; helpers PowerShell JSON con identidad de ejecutable/modelo/
puerto/PID/fecha; módulo Node con exclusión mutua, parada compartida, limpieza y rollback;
API única con alias; controlador único y polling de 10 s; cierre HTTP posterior a la
respuesta, con destrucción de conexiones y timeout. La copia de evaluación incluye los
módulos nuevos y conserva la detección de servidores externos como `foreign`.

Se revisaron específicamente los tres cambios posteriores a la suite anterior:

1. `-ContextoExplicito` solo se envía al lanzador optimizado; `-ContextSize` se mantiene
   en ambos. Prueba del vector de argumentos, con spawn sustituido; no es evidencia GPU.
2. `cancelLaunch` termina el proceso propio aun con `errorArranque`. Prueba real con un
   proceso Node de espera creado por la prueba y taskkill; no es un modelo simulado.
3. El arranque distingue marcador rancio por PID **y fecha de creación**. Windows
   PowerShell 5.1 ejecuta el helper real: un PID vivo con fecha diferente permite crear y
   limpiar un hijo propio; la fecha correcta rechaza el arranque y preserva el marcador.
   El proceso que presta el PID permanece vivo en ambos casos. No se carga GPU.

También se completó Iniciar con `CUSTOM`: opción visible, recuperación del preset y envío
del contexto/KV/visión guardados. Una regresión de navegador comprueba el cuerpo; el E2E
posterior pulsa Iniciar realmente y carga GPT-OSS con esos ajustes. No cambia los
presupuestos de contexto, herramientas, Harmony, `--skip-chat-parsing`, Ornith, Hub,
binarios ni GGUF.

## Comandos y resultados

| Comando | Resultado y evidencia |
|---|---|
| `node chat/prueba-lifecycle-adapter.mjs` | 4/4; [salida](final-adapter-tests.txt) |
| `npm test` | 50/50 suites tras los tres ajustes y repetido tras el cambio de UI (169.8 s); [última salida](final-tests-all.txt). Incluye 11 tests del módulo y 4 del adaptador |
| `npm run test:navegador` | 8/8; repetido después de completar CUSTOM, [salida](final-browser-tests-custom.txt) |
| `node chat/prueba-gpt-oss-tools.mjs` | OK, servidor simulado; [salida](final-gpt-oss-tools.txt) |
| `node chat/prueba-small-coder.mjs` | OK, contrato con modelo simulado; [salida](final-small-coder.txt) |
| `npm run docs:links` | 37 documentos, 119 enlaces, 0 rotos; [salida](final-docs-links.txt) |
| `node scripts/e2e-lifecycle.mjs --prepare` | GPU real OK; [primera repetición](final-gpu/e2e-evidence.json), [repetición con Iniciar CUSTOM desde UI](final-gpu-custom/e2e-evidence.json), [salida](final-e2e-custom.txt) |
| `node scripts/e2e-lifecycle-failures.mjs` | GPU real OK: cancelación preflight, fallo tras carga, binId inválido preservado y rollback; [JSON](final-gpu/faults-evidence.json), [salida](final-faults.txt) |

Para las repeticiones GPU se definió `BONSAI_EVIDENCE_DIR` apuntando a `final-gpu` y
`final-gpu-custom` dentro de esta carpeta. Se conservaron todos los resultados anteriores.

## Evidencia real de la última ejecución UI + GPU

GPT-OSS 20B, build `lab-server-mvq2`, RTX 4060 Laptop de 8 GiB, contexto 65536, KV q8_0,
sin visión, pensar 4096. VRAM libre, medida por NVIDIA en la primera GPU:

| Paso | Modelo / wrapper / Node | Puerto 8080 / 8787 | Marcador | VRAM libre MiB |
|---|---|---|---|---:|
| Cargado | 68060 / 49688 / 59920 vivos | abierto / abierto | presente | 664 |
| Detener desde UI | modelo y wrapper muertos; Node 59920 vivo | cerrado / abierto | ausente | 7956 |
| Iniciar desde UI con CUSTOM | 63576 / 49596 / 59920 vivos | abierto / abierto | presente | 664 |
| Matar únicamente wrapper 49596 | hijo 63576 sigue vivo | abierto / abierto | presente | 664 |
| Dos stop concurrentes | hijo y wrapper muertos; Node vivo | cerrado / abierto | ausente | 7956 |
| Cerrar desde UI | 67388 / 64128 / 59920 muertos | cerrado / cerrado | ausente | 7956 |

La prueba de fallos restauró el modelo desde PID 36996 a PID 67868, tras rechazar PID
64756; consultar el JSON para todas las identidades y la configuración. La limpieza final
confirmó puerto cerrado, marcador ausente y 7956 MiB libres.

La [auditoría al terminar todo](final-cleanup-audit.json), posterior al diagnóstico del
agente, confirmó cero listeners, marcadores, procesos llama de esta instalación y PIDs
de prueba supervivientes. Midió 7870 MiB libres; el escritorio fluctúa respecto de los
7956 del E2E. El helper `-CheckOnly -Json` devolvió `state:empty`. Los ajustes actuales
del usuario coinciden con la copia tomada antes del diagnóstico.

## Intentos fallidos conservados

- [baseline-tests.txt](baseline-tests.txt): primera ejecución restringida, 41/48 y 7
  fallos de permisos/procesos. Las ejecuciones posteriores con acceso suficiente pasan.
- [baseline-e2e.txt](baseline-e2e.txt): el parche 2.3.6 ya pasaba el E2E habitual al iniciar
  este trabajo. **No se reprodujo aquí el bug histórico sin parche**.
- [regressions-before.txt](regressions-before.txt): la prueba de extracción fallaba porque
  todavía no existía el módulo. Demuestra el contrato ausente, no reproduce un fallo GPU.
- [e2e-attempt1.json](e2e-attempt1.json) y [e2e-attempt2.json](e2e-attempt2.json): arranque
  fallido durante la implementación del marcador atómico (`File.Replace` en PS 5.1).
  Se corrigió usando `NullString.Value`; las cargas posteriores pasan. Se conserva la
  salida original, incluidos errores y texto antiguo mal codificado.
- [custom-browser-attempt1.txt](custom-browser-attempt1.txt): la regresión nueva encontró
  que faltaba la opción CUSTOM en el selector. Se añadió la opción y se repitieron las
  ocho suites de navegador y el E2E real, ambos en verde.
- Los errores «Fallo inyectado» de `final-faults.txt` son el estímulo esperado de la prueba;
  su resultado global es `ok:true`, no se omiten esos errores del log.

## Límites y riesgos

- Helpers y lanzadores probados con Windows PowerShell **5.1.19041.3031**; Node
  **v26.0.0**. La shell de orquestación es PowerShell 7.6.6. **Node 22 no se probó**.
- No se validó multi-GPU. La telemetría usa la primera GPU; otras aplicaciones pueden
  impedir alcanzar el umbral de VRAM. Un fallo de verificación mantiene el IDE disponible.
- Se comprobó el aviso alternativo en Edge headless. `window.close()` depende del
  navegador; no se garantiza el cierre de cualquier ventana `--app`.
- Las suites aisladas y las pruebas de contrato GPT-OSS no prueban la calidad de un
  modelo real. El diagnóstico adicional del agente conserva por separado la salida SSE,
  trazas y archivos generados; no modifica las partes protegidas para forzar un resultado.
- Los builds y GGUF existentes se utilizaron sin cambiar ni descargar archivos.

## Diagnóstico adicional del agente

`node scripts/diagnose-gpt-oss.mjs` completó la captura real y la limpieza (exit 0), pero
**la app generada no quedó funcional ni sus tests verdes**: el host notificó
`repair_limit`, 9 pasos y `incompleto:true`. El modelo emitió 10 llamadas válidas y
ninguna respuesta `final`; hubo cuatro reparaciones fallidas por APIs de Node
inventadas. La última llamada se descartó durante el cierre y apareció un resumen
de respaldo. No se reprodujeron tool desconocida, JSON cortado ni desconexión SSE.

El [diagnóstico detallado](GPT-OSS-DIAGNOSIS.md) separa estas causas, los límites de la
reproducción y las mejoras futuras permitidas en otro trabajo. Se conservan raw SSE,
trazas, proyecto exportado y resultado de parada. Harmony/tools/contexto siguen intactos.

Bloqueo registrado: la revisión automática rechazó borrar `.git` del sandbox de
diagnóstico (`blocked by policy`). Se conservó el repositorio de prueba local ignorado;
la evidencia se exportó sin `.git`. No se reintentó la eliminación por otra vía.
