# Optimización del agente local y del motor · 28 de octubre de 2026

La configuración recomendada es **small-local-coder + 8GB-BALANCED**, con un único
Ornith-1.5-9B Q4_K_M. En la comparación controlada completó 7/7 tareas frente a 6/7
del agente anterior, reduciendo los tokens de entrada de 186.982 a 76.261 y el
tiempo total de 150,5 a 108,1 segundos. Es evidencia sobre siete tareas pequeñas
con una semilla, no una estimación de éxito general sobre repositorios reales.

## Qué se encontró y qué cambió

El IDE usa frontend JavaScript y backend HTTP/SSE Node propio. `BonsaiChat` mantiene
la sesión con llama-server; ya existían tool calls nativas, reemplazo exacto y único,
escrituras atómicas, deshacer, diagnósticos JS/Python, Git y tests. Se reutilizaron.
El contexto usaba lecturas más amplias e historial; los símbolos eran léxicos y
faltaba una verificación de tareas gobernada por el host. No había LSP ni Tree-sitter.

Se añadieron un índice AST Tree-sitter en CPU, grafo de imports, ranking barato,
mapa con presupuesto de 600 tokens y snippets con líneas; nueve herramientas con
schemas y validación previa; estado DISCOVER/PLAN/EDIT/VERIFY/REPAIR/DONE fuera del
modelo; tests Node afectados y verificación configurable; dos reparaciones, límites
de repetición, pasos y tiempo; contexto efectivo 8k con salida reservada y pedido
original íntegro; trazas exportables y selección del perfil desde Ajustes.

Los cambios del motor son **UPSTREAM CONFIGURATION / LOCAL TUNING**: contexto 8k,
texto sin proyector, KV F16, Flash Attention, batch 512/ubatch 256, mmap/colocación
estándar y margen de VRAM. Se mantuvieron la cuantización de pesos, el binario y el
muestreo del modelo. No hay patches low-level ni kernels nuevos. Los módulos nuevos
y el JSON de presets permiten desactivar cada componente; el modo general sigue
disponible. Se conservaron los cambios que ya tenía el working tree.

Arquitectura, configuración, comandos y límites: [SMALL-LOCAL-CODER.md](../../docs/SMALL-LOCAL-CODER.md).

## Equipo y motor identificados

| Elemento | Dato observado |
|---|---|
| GPU | NVIDIA RTX 4060 Laptop, 8.188 MiB, compute capability 8.9 |
| Driver | 617.14 |
| CPU / RAM física | Ryzen 7 7840HS, 16 hilos / aproximadamente 16 GB |
| Runtime | llama.cpp 0.2.0-dev, build 10743, commit adfffbe41 |
| Compilador del binario | MSVC 19.44.35229.0, Windows AMD64 |
| CUDA del binario | ARCHS=500,610,700,750,800,860,890,900; USE_GRAPHS=1 |
| Pesos | GGUF V3 Ornith-1.5-9B Q4_K_M, 5.780.090.816 bytes |
| Capas / hilos / secuencias | 34/34 capas GPU, 4 hilos CPU, una secuencia |
| Colocación BALANCED | 545,62 MiB CPU_Mapped y capas CUDA; KV en GPU |
| Toolchain y profiler locales | nvcc, nsys y ncu no disponibles |

El modo original medido reservaba 39.936 tokens, KV Q8_0 y proyector de visión,
forzando todos los tensores a CUDA. BALANCED usa 8.192/F16 sin visión y colocación
estándar. La reducción de VRAM combina esos cambios: no se atribuye solo al contexto
o al tipo de KV. CUDA Graphs y reutilización de prefijo ya existían antes.

## Agente: comparación controlada

Mismo GGUF/binario, servidor texto 8.192/F16, batch 512/ubatch 256, semilla 42,
temperatura 0,6, top-p 0,95 y top-k 20. El control usa la copia del código anterior
guardada antes de implementar. Los directorios de evaluación y estado son aislados.

| Métrica, suma de siete tareas | Anterior | Small Local Coder |
|---|---:|---:|
| Tareas correctas | 6/7 | 7/7 |
| Prompt tokens enviados, incluidos reutilizados | 186.982 | 76.261 |
| Tokens generados | 5.214 | 3.550 |
| Llamadas al LLM | 50 | 33 |
| Tool calls | 63 | 26 |
| Tiempo de prefill acumulado del runtime | 20.856 ms | 16.733 ms |
| Tiempo de generación acumulado del runtime | 123.486 ms | 83.930 ms |
| Tiempo total | 150.539 ms | 108.057 ms |
| Pico VRAM del dispositivo | 5.281 MiB | 5.281 MiB |

La reducción observada es 59,2 % en prompt tokens y 28,2 % en tiempo total. El
control falló `existing-api`: asumió objetos con `price`/`qty` donde la API recibía
números y produjo NaN. Los oráculos independientes detectaron el error.

| Tarea | Anterior | Small Local Coder | Tiempo final |
|---|---|---|---:|
| Bug de un archivo | pasa | pasa | 11.078 ms |
| Descubrimiento sin ruta | pasa | pasa | 20.809 ms |
| Cambio entre módulos | pasa | pasa | 24.462 ms |
| Corrección desde test fallido | pasa | pasa | 11.684 ms |
| Uso de API existente | falla | pasa | 11.435 ms |
| Compatibilidad de API | pasa | pasa | 16.235 ms |
| Reparación de error inyectado | pasa | pasa | 12.354 ms |

El evaluador ejecuta tests públicos resultantes, aserciones originales inmutables,
oráculos ocultos y sintaxis. `repair-patch` inyecta expresamente un error de sintaxis
después del primer cambio; se registra en la traza. No se interpreta ese fallo
inyectado como tasa natural de errores del modelo. No se ejecutó lint/typecheck
adicional: los fixtures son ESM JavaScript sin esas herramientas.

La corrida final tuvo cero fallos de parseo/schema/patch y una reparación automática
contada por el host. Hay métricas por tarea de caché, TTFT operativo, archivos
mencionados en contexto, llamadas, tokens y timings en los JSON. `filesSent` es una
aproximación por rutas encontradas en mensajes, no bytes completos de archivos.
El contador de reparaciones es de transiciones del host; no incluye toda corrección
que el modelo inicia por su cuenta.

Datos: [comparación controlada](agent-controlled-comparison.json),
[resumen reproducible](mediciones.json). Los informes completos y trazas se
conservan localmente en `after-control-legacy-8k/` y `after-final-stable-balanced/`.

## Baseline original y corrección del evaluador

La baseline original a 39.936 tokens completó **7/7**, con 209.167 prompt tokens y
141.131 ms. La primera versión del evaluador la había marcado 6/7 por exigir que los
tests fueran idénticos byte a byte, aunque el modelo había añadido un test válido.
Se corrigió el criterio para ejecutar las aserciones originales independientemente.
Los reportes raw no se reescribieron; sus copias `informe-validado.json` contienen
el resultado corregido. Cuando el pedido prohíbe cambiar un test, sí se exige su
preservación literal. Se añadió regresión contra eliminación de aserciones.

La primera implementación también dio 7/7 a 39.936, pero tardó más: 176.091 ms con
134.314 prompt tokens. No se presenta esa corrida como mejora de velocidad. No tenía
semilla fijada y no permite atribuir efectos causales. [Comparación inicial corregida](agent-initial-comparison.json).

## Ablaciones del harness

Tres tareas comunes: descubrimiento, cambio entre módulos y API existente;
mismo modelo, preset y semilla 42. Cada corrida tiene su carpeta aislada.

| Variante | Tareas | Prompt tokens | Llamadas | Tiempo total |
|---|---:|---:|---:|---:|
| Configuración final, mapa 600/snippets/caché/direct | 3/3 | 39.861 | 17 | 56.706 ms |
| Mapa desactivado | 3/3 | 88.209 | 37 | 98.102 ms |
| Presupuesto de mapa 1.800 | 3/3 | 55.156 | 24 | 72.486 ms |
| Caché desactivada | 2/3 | 118.249 | 43 | 176.905 ms |
| Sin snippets iniciales | 3/3 | 60.769 | 26 | 89.092 ms |
| PLAN forzado antes de EDIT | 3/3 | 94.944 | 37 | 125.988 ms |

El mapa real solo ocupó 49–78 tokens en estas tareas: 600 y 1.800 enviaron el mismo
mapa. Su diferencia de resultado no demuestra una ventaja del tamaño 600; hacen
falta repositorios más amplios para discriminar presupuestos. La variante sin mapa
sí quitó información. Parte de esa corrida coincidió con tests CPU, por lo que su
tiempo no es una medición aislada. Las rutas de las carpetas aparecen en el entorno
del prompt y varían entre corridas; una semilla no elimina esa variación.

Se mantiene edición directa para estas tareas: PLAN forzado pasó, pero usó más
llamadas y tiempo. Se conserva la opción PLAN explícita para tareas amplias, sin
afirmar que mejore esa clase de tareas todavía. Caché OFF se atascó en descubrimiento;
los snippets redujeron llamadas en la corrida observada. Son señales de alcance
limitado, no estimaciones estadísticas ni evidencia causal independiente para cada
cambio. Los datos por tarea están en `mediciones.json` y las carpetas locales
`after-ablation-*/`.

No se ensayó unified diff ni tool calling de texto como sustitutos: la baseline ya
tenía llamadas nativas y reemplazo estructurado. No se presenta conservar esas
implementaciones sanas como una mejora nueva. Tampoco se midió un contraste
independiente full-file/snippets: el control anterior usa lecturas completas, pero
también difiere en otras partes del harness. `snippets-off` solo elimina la selección
inicial y mantiene las lecturas acotadas disponibles.

## Motor: benchmark y autotuning

Warm-up excluido y mediana de tres corridas por caso, prompts con número exacto de
tokens, greedy/seed 42. Se midieron pp512/1k/2k/4k y generación de 32/128/256/512.
El original también permite pp8192; se omite en 8k porque debe caber la salida.
El corpus repite deliberadamente una función JavaScript: favorece n-gramas.

| Configuración | Pico MiB | Libre mínimo MiB | pp512 tok/s | pp4096 tok/s | tg512 tok/s | TTFT pp512 ms |
|---|---:|---:|---:|---:|---:|---:|
| Original 39.936/Q8, visión, ub128 | 7.493 | 464 | 1.585,38 | 1.777,02 | 42,61 | 325,40 |
| BALANCED 8k/F16, ub256 | 5.279 | 2.678 | 1.668,82 | 1.912,93 | 42,77 | 310,22 |
| 8k/Q8 KV | 5.175 | 2.782 | 1.634,06 | 1.883,90 | 42,60 | 315,32 |
| 8k/Q4 KV | 5.111 | 2.846 | 1.639,58 | 1.880,93 | 42,52 | 314,20 |
| 8k/F16, batch256/ub128 | 5.253 | 2.704 | 1.571,73 | 1.776,57 | 42,78 | 327,53 |
| 8k/F16, batch1024/ub512 | 5.331 | 2.626 | 1.709,46 | 1.896,04 | 42,76 | 302,08 |
| BALANCED, Flash Attention apagado | 5.435 | 2.522 | 1.622,31 | 1.788,96 | 42,44 | 317,28 |
| BALANCED + ngram-simple | 5.283 | 2.674 | 1.659,76 | 1.898,25 | 607,43* | 311,33 |

*Los 607,43 tok/s corresponden a código altamente repetitivo; 495/495 drafts
aceptados en una corrida tg512. No representan coding general.* El decode normal
se mantiene alrededor de 42 tok/s: la mejora principal del agente viene de menos
contexto/llamadas y mejor verificación, no de un kernel más rápido.

Q8 y Q4 ahorraron respectivamente 104 y 168 MiB frente a F16 en 8k, sin acelerar
el decode. No se eligieron porque F16 cabe holgadamente y no se midió su calidad
de coding completa. Flash Attention ahorró 156 MiB y mejoró pp4096 frente a OFF.
ub512 ganó 2,4 % en pp512 con 52 MiB adicionales, sin mejorar pp4096 ni decode;
queda como preset MAX-SPEED para probar prefill corto, no como recomendación coding.

Los hashes greedy coinciden con BALANCED en todas las muestras comparables de las
siete variantes y se generó exactamente la cantidad solicitada. Esto solo comprueba
ese corpus. [Datos originales](engine-before.json), [siete candidatos](engine-tuning.json),
[comprobación rápida final](engine-final-balanced.json). `mediciones.json` recalcula
igualdad y longitudes desde los datos raw sin hacer inferencia.

Una [verificación rápida posterior](engine-final-verified.json), tras las ablaciones,
midió 5.460 MiB de pico del dispositivo y 2.497 MiB libres. Es VRAM global de la GPU,
incluyendo actividad del escritorio y buffers persistentes, no memoria exclusiva del
proceso. La diferencia frente a 5.279/5.281 confirma la necesidad del margen; no se
atribuye a una causa no perfilada. Esta corrida también comprueba los campos corregidos
de conteo de reutilización desde `timings`.

La [corrida final con contadores de RAM](engine-final-ram.json) registró un máximo
de working set de **5.411,04 MiB** y **6.149,73 MiB** de memoria privada comprometida
al terminar. El pico es desde el arranque del proceso y cuenta páginas residentes
compartidas/mapeadas; la memoria privada es un valor final, no un pico. Se consulta
después de medir latencias para no introducir polling de PowerShell durante requests.
Esta corrida tuvo 5.556 MiB de VRAM global y 2.401 MiB libres. No se midió RAM en
la baseline ni en las otras seis variantes; el benchmark ahora conserva estos
contadores de Windows cuando son accesibles y devuelve null en otros sistemas.

La caché de prefijo de BALANCED pasó de TTFT 572,51 a 59,04 ms para el prompt de
1.024 tokens: `timings.cache_n=1020`, `prompt_n=4`, salida idéntica. Es una pareja
cold/warm ilustrativa, no una mediana; la baseline ya reutilizaba el prefijo. El
campo nativo `tokens_cached` indica el estado resultante del slot en este runtime;
para medir reutilización se usan los campos de `timings`, también en el resumen.

## N-gramas: técnica rechazada

| Mismo harness, servidor y semilla | Tareas | Tiempo | Prompt tokens | Llamadas |
|---|---:|---:|---:|---:|
| Speculative OFF | 7/7 | 108.057 ms | 76.261 | 33 |
| ngram-simple | 6/7 | 136.681 ms | 111.518 | 48 |

El caso entre módulos agotó el límite de reparaciones con n-gramas. La semilla
no garantiza la misma trayectoria con otro algoritmo de sampling/especulación.
Se deshabilitó la técnica en todos los presets: no hubo beneficio end-to-end en
esta prueba. No se cargó ningún draft LLM. [Comparación](agent-spec-comparison.json).

## Límites del profiling y trabajo restante

Los timers distinguen prefill y decode; en tg512 normal, aproximadamente 12 s de
generación frente a 0,3 s de prefill dominan el tiempo del motor. No hay evidencia
para atribuirlo a kernels concretos, allocations, copias o sincronización. Sin
Nsight, toolkit y fuentes/build local no se recompiló para sm_89, no se comparó
MMQ/cuBLAS ni se modificaron kernels. No hay resultados de build tuning o patches
CUDA que reportar. `USE_GRAPHS=1` ya estaba activo; no se atribuye su beneficio al
trabajo nuevo.

No se compararon picos de RAM entre candidatos, calidad de otras cuantizaciones de pesos, matriz KV
2k/4k/16k, GPU sampling ni offload parcial. Los reportes guardan utilización, clocks,
temperatura y VRAM cuando están disponibles; el power limit fue inaccesible.
No hay LSP; las referencias son léxicas y la resolución de imports Python es
parcial. Los checks de tipos/compilación necesitan configuración explícita. La
prueba de 31 suites es de corrección del software, separada del éxito del LLM.
La [ejecución final](tests-final.log) pasó 31/31 en 97,5 s. Incluye los casos nuevos
de AST/símbolos repetidos, índice dentro de un Git ignore, límites de contexto,
validación de llamadas, rechazo de ediciones Markdown, verificación y reparación.

Orden de siguientes mejoras: más tareas y semillas sobre repos reales; adaptadores
de tests/typecheck y LSP opcional; resolución de monorepos y Python; calidad de KV
y cuantizaciones en workloads más amplios; profiling CUDA antes de cualquier
fork o kernel específico. No se asignan ganancias a pruebas no realizadas.

## Reproducir

```powershell
npm ci --prefix chat
npm test
.\scripts\start-server.ps1 -Modelo ornith9b -EnginePreset 8GB-BALANCED
# Con el servidor anterior abierto, otra terminal:
npm run benchmark:coder -- --out reports/nueva-corrida --seed 42
npm run benchmark:engine -- --out reports/nuevo-motor.json
# Con el puerto libre: siete motores secuenciales, nunca dos LLM a la vez.
npm run benchmark:engine -- --tune --out reports/nuevo-tuning.json
# Resumen de los informes retenidos de esta sesión:
node reports/coder-2026-10-28/resumir.mjs
```

Las trazas, logs y copias de aplicaciones/workspaces quedan ignorados por Git; los
resúmenes y JSON del motor son revisables. Los procesos iniciados para las pruebas
se identifican antes de cerrarlos; no se detienen servidores ajenos.
