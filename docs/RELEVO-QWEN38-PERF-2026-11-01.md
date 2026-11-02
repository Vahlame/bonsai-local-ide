# Qwen3.8-27B: informe de trabajo y relevo para DeepSeek 4.1 Flash 1070

Fecha: 2026-11-01, America/Costa_Rica. Destinatario: **DeepSeek 4.1 Flash 1070**.

Este documento permite continuar sin repetir la investigación. Contiene resultados
reales, código y descartes; distingue las mejoras del runtime de la validación del
IDE que todavía falta. El usuario pidió este relevo durante el trabajo: **no se ha
cumplido todavía toda la definición original de éxito**. No presentar los apartados
pendientes como terminados.

## 1. Resultado medido y alcance real

Hay una mejora reproducible de decode en Qwen3.8-27B mediante una ruta CPU nueva
AVX-512 VNNI para IQ4_XS y un GGUF mixto con suelo de cuatro bits. También hay una
caché recurrente parcial que evita volver a procesar un prefijo residente completo.

Comparación en esta misma máquina, tres repeticiones medidas tras warmup, mismos
prompts, temperatura 0, semilla 42, 16 threads, ngl 27 y MTP 2:

| Carga | GGUF original, con nuevo kernel | GGUF mixto IQ4_XS, con nuevo kernel | Cambio |
|---|---:|---:|---:|
| Código, 256 tokens generados | 6,0267 tok/s | 9,2630 tok/s | +53,7% |
| Prosa española, 256 tokens | 4,7404 tok/s | 7,1305 tok/s | +50,4% |
| Prompt repetitivo, 96 tokens | 6,4773 tok/s | 10,3456 tok/s | +59,7% |

Los 10,3 tok/s son de una carga muy repetitiva con aceptación MTP casi perfecta.
**No anunciar 10,3 tok/s como velocidad universal del IDE.** La referencia de
4,3–5,0 tok/s aportada por el usuario utiliza otros prompts; los porcentajes de la
tabla usan nuestros controles comparables, que ya incluyen el nuevo kernel.

El kernel aislado en el GGUF original dio **6,2995 frente a 5,7900 tok/s (+8,8%)**,
con máximo delta registrado de probabilidad cero, misma salida greedy y 67 casos
de backend aprobados. Las conversiones de tipos y el kernel se complementan:
el nuevo GGUF permite usar esa ruta en más matrices CPU.

La caché de prefijo se probó con el GGUF original y binarios/control documentados:

| Prefijo repetido | TTFT sin la nueva caché | TTFT con caché, tail 3 | Tokens reutilizados |
|---|---:|---:|---:|
| 6.000 tokens | 33.682 ms | 550 ms | 5.997 |
| 12.000 tokens | 67.326 ms | 584 ms | 11.997 |
| 25.000 tokens | 144.562 ms | 576 ms | 24.997 |

La prueba inicial tail 4 sí hizo A/B con el mismo binario y dio 719/739/744 ms.
Tail 3 se midió después y sus binarios no son idénticos a tail 4: no atribuir toda
esa diferencia exclusivamente a un token menos. Las salidas de los escenarios
probados coinciden. **Esta prueba es de prefijo repetido/residente, no demuestra
todavía esa latencia en cualquier turno real con herramientas o historial cambiado.**

## 2. Repositorios, ramas y rollback

Máquina: Acer Nitro AN16-41, Windows 10 LTSC 19044, Ryzen 7 7840HS Zen 4
(8 núcleos/16 hilos, AVX-512 BW/VNNI), RTX 4060 Laptop sm_89 de 8.188 MiB/80 W,
CUDA 12.9.1 y 16 GB DDR5. La referencia aportada de memoria es 53,4–53,7 GB/s;
no confundirla con ancho efectivo de las multiplicaciones del modelo. RAM y VRAM
son límites duros; no repetir OOMs deliberados como metodología.

El GGUF local se identifica como arquitectura `qwen35`: 64 capas de target,
48 DeltaNet y 16 de atención, más cabeza/capa MTP nextn. El nombre de producto
usado aquí es Qwen3.8-27B, como en el catálogo del usuario. Contexto nativo declarado
262.144; el perfil operativo sigue limitado a 32.768.

| Elemento | Ruta / rama |
|---|---|
| Fork de inferencia | `C:\Users\user\.local\opt\bonsai-inference\llama.cpp-qwen38` |
| Rama del fork | `perf/qwen38-27b` |
| Build activo | `C:\Users\user\.local\opt\bonsai-inference\build-Qwen38-sm89` |
| Informes y resultados | `<fork>\reports\2026-11-01-qwen38` |
| IDE | `C:\Users\user\Documents\prject_local_AI` |
| Rama del IDE | `codex/qwen38-27b-integration` |
| Backup completo inicial | `C:\Users\user\.local\opt\bonsai-inference\baseline-Qwen38-dde879b` |
| Control previo a cambios CUDA | `C:\Users\user\.local\opt\bonsai-inference\cuda-control-Qwen38-20261101` |
| Backup de integración local previa | `C:\Users\user\.local\opt\bonsai-inference\ide-before-qwen38-perf` |

El fork partió limpio de `dde879b`. El IDE tenía cambios locales previos relacionados
con Qwen38. Se preservaron en el commit **`643a6f7` del IDE** antes de añadir el
perfil optimizado; no se descartó trabajo previo. Los cambios propios del perfil
se mantienen separados de esa integración previa.

Modelo original, conservado:
`models\qwen38-27b-Qwen3.8-27B-UD-IQ4_XS.gguf` (14.252.845.984 bytes).

Modelo candidato:
`models\qwen38-27b-perf-iq4_xs-floor4.gguf` (15.167.175.584 bytes).

Perfil original del IDE: **`qwen38-27b`**. Perfil candidato: **`qwen38-27b-perf-iq4`**.
Ambos usan `servidor.tipo = gpu-parcial`. Mantener el original como rollback.
Los GGUF y binarios no se guardan dentro de Git; las recetas, diffs, comandos y
resultados sí. No borrar backups ni sustituir el modelo original.

Commits principales del fork:

| Commit | Contenido |
|---|---|
| `be449c4` | Instrumentación CPU/scheduler |
| `e30c957` | Kernel VNNI con orden FP compatible |
| `98537ed`, `087b0fd`, `0a2a8eb` | Caché recurrente parcial, pruebas largas y tail 3 |
| `5194ee1` | Retirada de páginas mmap subidas a GPU en Windows |
| `86db764`, `2659d74` | Receta mixta IQ4 y calidad/código/prosa/PPL |
| `80be569`, `fc337cf` | ETW/PMCs, AMD uProf y Nsight |
| `4c1a58a`, `1440c40` | Tres barriers Windows medidas y revertidas |
| `2ee45e3`, `3ea8e90` | Tres distancias de prefetch medidas y retiradas |
| `4d0db33` | Allocator Windows large/lock opt-in, con fallback y resultados |
| `16d7f96`, `76c0f6c` | Q4_0 y Q4_K selectivos medidos y rechazados |
| `ae5db31` | Selección de dispositivo de estado y repartos no contiguos |
| `8d82add`, `011cb8d`, `3825451` | Tres geometrías MMVQ de dos warps rechazadas |

Consultar también `git log --oneline`; el cierre añade el rollback CUDA y este
relevo. Cada manifiesto identifica binarios por SHA-256; los builds recientes
incluyen además el snapshot de fuentes compiladas.

## 3. Cambios implementados y pruebas

### 3.1 Kernel CPU y verificación MTP

Archivo principal: `ggml/src/ggml-cpu/arch/x86/iq4-mtp.cpp`.
Usa `vpdpbusd`, escalas por 32 pesos y comparte decodificación/cargas de pesos
entre 1, 2 o 3 columnas. Conserva el orden de reducción/FMA de la referencia
AVX2. La selección en `ggml-cpu.c` cubre IQ4_XS, dimensiones compatibles y lotes
pequeños de verificación. En MSVC comprueba AVX-512 VNNI por CPUID.

Rollback por proceso: **`GGML_CPU_IQ4_MTP=0`**. No cambiar globalmente las opciones
AVX-512/VNNI de todo el proyecto: una primera versión alteró logits. Se validaron
K=5120/17408, filas incompletas, greedy, probabilidades, herramientas y razonamiento.
Falta aislar su ganancia adicional en el GGUF mixto, y medir otros modelos.

### 3.2 Caché recurrente parcial

Flag nuevo: **`--cache-recurrent-prefix`**, o
`LLAMA_ARG_CACHE_RECURRENT_PREFIX=1`; por defecto está apagado.

Conserva KV de atención residente en el slot y serializa solamente el estado
recurrente/estado del draft MTP y la especulación. Funciona con
`--ctx-checkpoints 0`. Limita a un checkpoint por slot y comprueba el presupuesto
RAM antes de reservar. El checkpoint observado ocupa aproximadamente **149,626 MiB**.
No exige subir `--cache-ram 512` para serializar toda la KV de 32K.

Limitaciones: residente, no persistente tras reinicio; texto; el prefijo debe
seguir siendo válido en ese slot. **Falta comprobar cambios reales de historial,
varios turnos de agente, caché de un prefijo estable y evicción entre conversaciones.**
Hay que revisar si un único checkpoint final pierde oportunidades al retirar
razonamiento antiguo de la plantilla. Es una hipótesis pendiente de reproducción,
no un fallo demostrado. También falta el caso de presupuesto insuficiente y
la prueba completa con `--cache-reuse`.

### 3.3 Memoria Windows

`LLAMA_MMAP_TRIM_GPU=1` retira del working set páginas completas de mappings que
ya se subieron a GPU. Mantiene las direcciones válidas y protege páginas frontera.
Working set máximo medido: **11.043 → 8.506 MiB**, sin una ganancia de decode
significativa (6,455 → 6,477 tok/s). Se conserva por beneficio de residencia.

Allocator experimental en `ggml-backend.cpp`:
`GGML_WIN32_ALLOCATOR=normal|large|lock`. Por defecto, allocator original.
`large` intenta páginas grandes con privilegio temporal y fallback; `lock` usa
VirtualAlloc/VirtualLock y restaura cuotas al liberar buffers.

La prueba estricta fuerza pesos CPU normales mediante
`--load-mode none --no-host --no-repack` y una única lista de overrides.
Se verificó una petición de pesos CPU de 8.622.145.792 bytes.
**Windows devolvió error 1450 en todas las reservas de páginas grandes. Se midió
el fallback, no rendimiento con large pages realmente asignadas.** VirtualLock
sí bloqueó pesos/KV/estados. Ningún modo aportó velocidad; quedan opt-in.

### 3.4 Cuantización

`scripts/qwen38_mixed_quant.py` lee tipos y tamaños de los tensores GGUF,
genera un archivo de `--tensor-type-file` y ejecuta `llama-quantize`.
No genera tensores por debajo de cuatro bits. Conserva tipos de mayor precisión
y aplica la política CPU/GPU por tensor.

El original denominado IQ4_XS contiene realmente IQ2/IQ3 en parte de sus pesos.
La variante canónica sustituye esos tipos y los tipos CPU elegidos por IQ4_XS,
manteniendo pesos de mayor precisión. Estimaciones: CPU **8.222,72 MiB**, GPU
**6.231,34 MiB**. Es requantización de una fuente ya cuantizada: no recupera
precisión perdida del modelo original de alta precisión.

Calidad del candidato: herramientas nativas con argumentos correctos y respuesta
42, razonamiento, función Python generada y ejecutada en seis casos (vacío,
duplicados, alternancia, Unicode y entrada larga). PPL de 765 tokens de documentación:
original **6,4491**, candidato **6,4920** (+0,665%), tres ejecuciones por modelo.
Es evidencia limitada, no equivalencia universal de calidad.

## 4. Experimentos descartados

| Línea | Resultado | Decisión / siguiente diseño |
|---|---|---|
| Tiled IQ4, umbral 8→3 | 5,841→3,680 tok/s | Revertido; tiled estrecho |
| Tiled AVX2 de 3 columnas | 5,250 tok/s, peor | Revertido; VNNI directo |
| Primer VNNI directo | 6,395 frente a 5,790; delta prob. 0,01114 | Reescrito para conservar orden FP |
| VNNI compatible | 6,2995; delta prob. 0 | Conservado |
| Prefetch 4/8/16 bloques | 10,419 / 10,031 / 9,880 frente a 10,291 | +1,25% dentro del ruido o pérdidas; retirado |
| Barrier spin / híbrida / wait | 9,756 / 9,788 / 9,671 frente a 10,341 | Revertidas; OpenMP original |
| Allocator normal / large-fallback / lock | 10,405 / 10,311 / 10,312 | Sin ganancia; opt-in, apagado en IDE |
| CPU Q4_0 selectivo | 9,265 frente a IQ4 10,317; PPL 6,5383 | Rechazado |
| CPU Q4_K selectivo | 9,536; PPL 6,4767 | Rechazado por velocidad |
| Atención GPU, DeltaNet CPU | 5,380 tok/s con original | Rechazado, presión RAM |
| Atención + DeltaNet equilibrado GPU | 6,444 frente a 6,477 | Sin ganancia clara; rechazado |
| Proyecciones DeltaNet GPU, FFN/atención CPU | 5,387 | Rechazado |
| MMVQ 2 warps, todos tipos | 10,288 frente a control 10,296 | Sin ganancia, gate logits falla |
| MMVQ 2 warps solo 3 columnas | 10,338, rango 9,842–10,344 | Dentro del ruido, gate logits falla |
| MMVQ 2 warps solo IQ4_XS | 10,343, rango 10,322–10,414 | Dentro del ruido, gate logits falla |

Las tres variantes CUDA conservaron greedy y pasaron las tareas funcionales,
pero variaron probabilidades más de 0,001. PPL de contexto 64/ubatch 3, 93 tokens:
control 3,5687; variantes 3,5791 / 3,5791 / 3,5721, tres repeticiones cada una.
No comparar esos PPL con los de contexto 512 de cuantización. No afirmar pérdida
significativa de calidad por esa muestra tan corta; se usa un gate conservador.

El reparto con todas las capas DeltaNet completas en GPU requirió **10.092,66 MiB
solo en pesos** y se rechazó por admisión de bytes antes de reservar. Se midieron
tres alternativas que sí arrancan. Sus mínimos de RAM disponible durante carga
fueron 20/246/79 MiB: no son configuraciones aceptables de entrega.

Un primer ensayo de barrier wait coincidió con una exportación ETW y se invalidó;
se repitió limpiamente. Los primeros ensayos del allocator tenían alcance distinto
(override repetido o mezcla CUDA_Host/CPU); se etiquetaron y no se mezclaron con
la comparación estricta.

Descartes previos aportados por el usuario, no mediciones nuevas de este relevo:
ngl 28 OOM; ubatch 512 OOM; threads 8 y 24 peores que 16; MTP n-max 3 peor;
load-mode none sin ganancia y con más RAM; n-gram + MTP sin mejora con aceptación
ya alta. El Q4_K_S completo también falló por memoria MTP. No confundirlo con
nuestro GGUF **mixto CPU Q4_K**, que sí arrancó y se rechazó por velocidad.

## 5. Perfilado CPU, CUDA y memoria

Se implementaron timers opt-in por nodo/capa y scheduler mediante `GGML_PERF_CSV`.
Sus sincronizaciones alteran rendimiento: **no usar tiempos perfilados como A/B**.
`QueryThreadCycleTime` mide el coordinador, no todas las instrucciones del equipo.
Los contadores físicos se obtuvieron además por ETW/PMCs y AMD uProf.

Perfil original CPU: dot IQ3_S 24,37%, dot IQ4_XS 22,49%, IQ3_XXS 7,76%; yield
del sistema también consume CPU. La tabla por nodos atribuye 78,90% a capas
DeltaNet y 21,08% a atención, **incluyendo FFN**. La aritmética Gated DeltaNet
solo ocupa 2,76%: no confundir tipo de capa con kernel dominante.

Scheduler instrumentado: CPU 84,82%, GPU 13,34%, copia/espera 1,84%. Un modelo
serial ideal limita la ganancia de solapamiento aproximadamente al 15,7% antes de
dependencias y aliasing. No se implementó un pipeline CPU-token/GPU-token nuevo;
no retirar fences del allocator sin demostrar vida útil y dependencias.

En el GGUF mixto, AMD uProf confirmó IQ4 VNNI de tres columnas con **47,24% del
tiempo CPU muestreado e IPC 1,648**. ETW independiente dio aproximadamente 45,53%
e IPC 1,70. Los aproximadamente 4,2 GHz del perfil original son una estimación
estadística; los eventos multiplexados de uProf no permiten obtener frecuencia
directamente de cuentas crudas sin corregir la multiplexación.

Nsight Systems, porcentaje de tiempo de kernels GPU: IQ4 MMVQ 3 columnas 35,2%,
Q5_K MMVQ 3 columnas 17,4%, Q5_K MMVQ 1 columna 12,9%, IQ4 MMQ tile 128 8,5%.
DeltaNet CUDA aproximadamente 1,4%; la mayor especialización de atención 0,5%.
El 8 del nombre de una especialización de atención es número de columnas GQA,
no prueba por sí mismo de ocho warps. Consultar la configuración real.

**AMD uProf 5.3.521 ya está instalado, con EULA aceptada por autorización expresa
del usuario. No pedir la misma autorización otra vez.** CLI:
`C:\Program Files\AMD\AMDuProf\bin\AMDuProfCLI.exe`.
El instalador oficial firmado termina en `AMDuProf-5.3.521-official.exe`.
El archivo sin `-official` de una descarga anterior es HTML: no ejecutarlo.

El primer perfil uProf capturó solo Python y se marcó inválido. El válido adjunta
directamente al PID real de llama-server; script `qwen38_uprof.py`. Su ayuda usa
un pager interactivo: un proceso sin TTY esperando teclas no es un fallo del driver.

Memoria: hay muestras de working set, memoria física disponible, fallos totales y
VRAM por segundo. **Todavía no está demostrada ausencia de paging del modelo.**
ETW original tuvo 34 hard faults después del corte: 30 de módulos ejecutables y
cuatro sin atribuir. Falta ejecutar la captura ligera de hard/soft faults con
archivos identificados, especialmente a 25K y bajo presión de navegador.

Proveniencia: un PDB del perfil original fue sustituido por un rebuild antes de
una reexportación. Usar `etw-original-symbols.validated-functions.csv` y su resumen
validado; el posterior `etw-original-symbols.functions.csv` no es fiable. Las
capturas siguientes archivan PDBs antes de recompilar.

## 6. Estado del IDE, herramientas y razonamiento

El nuevo perfil conserva ngl 27, contexto 32768, KV q8_0, batch 512, ubatch 256,
threads 16, MTP 2, parallel 1, no-context-shift y no-reasoning-preserve. Añade
`cacheRecurrentPrefix: true` y `mmapTrimGpu: true`; el launcher los traduce al
flag nuevo y a la variable de entorno por proceso. No cambia el perfil original.

El dry-run validó selección del binario qwen38-sm89, archivo correcto y flags.
El alta/cambio definitivo debe pasar por **POST `/api/modelos`**, no por dejar un
servidor manual ajeno al lifecycle del IDE. Node usa el puerto 8787; inferencia 8080.

Las pruebas backend de herramientas/razonamiento son reales, pero no sustituyen
validar el controlador del IDE. Falta o debe ampliarse: tarea de edición con
lectura/escritura/test, varios tool calls, argumentos Unicode, mensajes de error,
cancelación durante generación y durante comando, ausencia de procesos huérfanos,
siguiente petición utilizable y caché entre turnos reales.

El resultado del smoke test y los procesos finales se registran en el apartado 11
y en los JSON de entrega. Si una prueba falla, conservar SSE/logs y el estado
incompleto; no inventar éxito ni culpar al modelo sin aislar parser/controlador.

## 7. Trabajo pendiente y orden de continuación

1. **IDE primero.** Leer el estado final, verificar `/health`, perfil real en
   `/api/modelos` y `/props`, y ejecutar una tarea aislada con cambio de archivo y
   test independiente. Medir TTFT de texto/razonamiento, caché y tok/s por paso.
2. **Caché en agente real.** Repetir 6K/12K/25K con el GGUF mixto final; probar
   herramientas y siguiente turno de usuario con retirada de razonamiento anterior.
   Caso negativo de presupuesto 64 MiB. Si el checkpoint final se invalida, medir
   tres diseños: conservar ancla estable + último checkpoint; ancla al inicio de
   mensaje de usuario; segmentación/evicción por coste de prefill. Mantener el
   presupuesto real de 512 MiB y contabilizar target, draft y especulación.
3. **Memoria verificable.** Reaplicar solo la parte del consumidor ETW preparada,
   compilarlo y capturar hard/soft faults con nombres de archivo. Separar carga,
   prefill, decode y hits de caché. Cuantificar working set, commit y RAM física;
   no confundir commit WDDM con RAM residente. Probar navegador controlado y sin él.
4. **CUDA restante.** Restauración MMVQ 4 es el control. Reaplicar individualmente
   los hooks preparados: MMQ on/off, selector de atención; luego FATTN tile 128 y
   geometría de cuatro warps donde cambie realmente. A/B de CUDA graphs y draft
   backend sampling (actualmente habilitados por defecto). DeltaNet/atención solo
   justifican más aritmética nueva si el nuevo perfil demuestra un coste relevante.
5. **Dataflow.** Cuantificar nuevamente burbujas/copia tras acelerar CPU. Eliminar
   copias/fences solo con prueba de aliasing y vida útil. Un pipeline entre tokens
   debe respetar dependencia autoregresiva y estados MTP/DeltaNet, no solo encolar.
6. **Windows.** High performance ya estaba activo y WinDefend ya estaba detenido;
   no atribuirlos a esta sesión. Medir prioridad, EcoQoS y afinidad estricta como
   variables separadas. Hay código QoS preparado sin validar. Las large pages
   actuales son fallback: no anunciar un beneficio de páginas grandes.
7. **Transferencia a otros modelos.** Ejecutar la matriz del apartado 8 con A/B,
   calidad, tres repeticiones, controles y rollback propio. No generalizar los
   porcentajes del 27B a formatos/arquitecturas distintos.
8. **Cierre.** Informe actualizado, diffs/commits de cada experimento, runtime
   aceptado recompilado, un solo servidor administrado y el IDE funcionando.

Las variantes abandonadas dejaron la siguiente hipótesis escrita. No repetir
un descarte sin cambiar el diseño. No llamar mejora a +1% dentro del ruido.

## 8. Aplicabilidad a otros modelos

**Todavía no hay benchmark que demuestre ganancias en otros modelos.** La tabla
describe alcance del código y pruebas necesarias, no resultados transferidos.
Los cambios viven en el build `qwen38-sm89`; un perfil del IDE que use otro
binario no los hereda automáticamente. Probar primero con un perfil/clon de
experimento, sin reemplazar el runtime de todos los modelos.

| Cambio | Puede aplicarse a | Restricción / validación necesaria |
|---|---|---|
| IQ4 VNNI CPU | Matrices IQ4_XS compatibles, Zen 4/AVX-512 VNNI | Solo 1–3 columnas y formas admitidas. Los expertos MoE con dimensiones adicionales se excluyen. Comparar env=0/1 y logits/PPL/greedy. |
| Verificación con pesos compartidos | MTP/especulación cuyo target forme lotes pequeños | La aceptación y el formato de pesos mandan. No garantiza beneficio con draft externo, n-gram o GPU completa. |
| Caché recurrente parcial | Híbridos recurrentes que expongan estado FULL/RS compatible | Validar rollback de estado target/draft y coherencia de KV. En transformers puros ya existe otro camino de caché. |
| Retirar mmap de pesos GPU en Windows | Offload parcial o completo con mappings de pesos | Beneficio esperado de RAM, no de tok/s. Validar fronteras, faults y no volver a tocar páginas retiradas continuamente. |
| Allocator large/lock | Tensores CPU Windows | Default original. No hay ganancia probada y large pages no se asignaron en esta máquina. |
| Receta mixta por tensor | Otros GGUF con tipos/nombres soportados | Recalcular capas, devices y bytes reales. Calidad puede cambiar. No copiar CPU=39 a otro modelo. |
| Estado siguiendo proyección | Repartos no contiguos en modelos compatibles | Cada arquitectura tiene buffers/estados distintos. Los tres repartos probados no ganaron aquí. |
| MMVQ dos warps | No se promueve | Tres variantes negativas; mantener CUDA original. |

Modelos locales útiles para los siguientes controles: `Qwen3.8-4B-Q4_K_M.gguf`,
`qwen35-4b-Qwen3.5-4B-Q4_K_M.gguf`, `Llama-3.2-3B-Instruct-Q4_K_M.gguf`,
`Ornith-1.5-9B-Q4_K_M.gguf` y `granite40-tiny-granite-4.0-h-tiny-Q4_K_M.gguf`.
Los Q4_K_M no ejercitan automáticamente el kernel IQ4_XS. Para ese kernel hará
falta un GGUF IQ4_XS adecuado o una requantización controlada con suelo de cuatro
bits, seguida de calidad. No usar las variantes locales IQ2/ternarias para violar
el límite de cuatro bits de esta misión.

Orden sugerido: Qwen38 4B híbrido para caché; un 3B transformer para confirmar
que se conserva su camino existente; IQ4_XS pequeño CPU para el kernel; después
un modelo mayor parcial. Solo entonces considerar MoE o nueva ruta Q4_K VNNI.

## 9. Instrucciones operativas para DeepSeek

Destinatario: **DeepSeek 4.1 Flash 1070**. Prioridad expresa del usuario al cerrar
este relevo: terminar las entregas y evitar cadenas de pruebas redundantes.
No repetir mediciones ya concluidas sin un cambio, un fallo o una incertidumbre
concreta que lo justifique. Para un experimento nuevo de rendimiento sí se conserva
el A/B de tres repeticiones; no convertirlo en una batería general tras cada edición.
Primero corregir el problema concreto del IDE descrito en el apartado 11 y hacer
una comprobación dirigida. Ampliar las pruebas solo si aparece evidencia nueva.

> Continúa esta misión con herramientas reales y código. Empieza leyendo este
> informe, AGENTS.md y los manifiestos/resultados del fork. Comprueba el estado
> vivo antes de parar o arrancar procesos. El usuario quiere Qwen3.8-27B más rápido
> en su IDE, con herramientas y razonamiento correctos, sin bloqueos ni regresiones.
>
> Conserva la ruta VNNI aceptada, el GGUF mixto candidato y el perfil original de
> rollback. No reactives las geometrías CUDA, barriers o prefetch rechazados.
> No apliques todo `prepared-next-experiments.patch` como si estuviera validado:
> sus partes están preparadas para experimentos separados.
>
> Un experimento = una variable; mismo prompt, temperatura y semilla; warmup y
> al menos tres repeticiones medidas; mediana, rango y dispersión. Guarda comandos,
> versiones, hashes, salida y memoria en reports/. Nada de compiladores, ETW,
> exportadores, cuantización ni hashes grandes compitiendo con una medición normal.
>
> Después de cada cambio de kernel/quant valida logits, greedy, PPL apropiada,
> herramientas nativas, razonamiento y código ejecutado. Un fallo de calidad o una
> ganancia dentro del ruido no se promociona. Revertir fuente y binario si pierde,
> documentar y proponer el siguiente diseño concreto. Mínimo tres diseños medidos
> antes de descartar una idea como inviable. Nunca generar menos de cuatro bits.
>
> Verifica el recorrido real del IDE afectado por tu cambio: parser, controlador,
> herramienta, respuesta y siguiente petición. Investiga cancelación, comandos
> colgados, OOM o caché cuando el fallo observado o la modificación lo requieran;
> evita repetir toda la matriz por rutina. Trabaja en una carpeta aislada y verifica
> el resultado desde fuera del modelo. No alteres archivos del usuario ajenos a la
> tarea. Usa /api/modelos y el lifecycle del IDE.
>
> Commitea cada experimento con su resultado y decisión. Los commits del fork usan
> Assisted-by: GPT-6.1 Sol; aplica las instrucciones del repositorio y declara tu
> propia asistencia de forma veraz al continuar. No sobrescribas identidad Git global.
> Mantén rollback y al finalizar deja IDE y modelo administrado funcionando.
>
> No inventes IPC, stalls, ausencia de paging, calidad general ni transferencia a
> otros modelos. Las tablas de este informe indican exactamente qué está medido.
> Si no tienes acceso a esta máquina/herramientas, dilo y no simules ejecuciones.

## 10. Comandos y evidencias

PowerShell; ejecutar desde el fork. No lanzar estos comandos con otra inferencia
o profiler ocupando la máquina. El harness rechaza el puerto 8080 ocupado.

```powershell
Set-Location 'C:\Users\user\.local\opt\bonsai-inference\llama.cpp-qwen38'
git status --short
git branch --show-current
git log -8 --oneline

# Build normal, con los cambios de la rama; log/proveniencia en el binario.
& scripts\qwen38-build.ps1 -Jobs 4

# Control candidato; cada label debe ser nuevo, no se sobrescriben resultados.
python scripts\qwen38_experiment.py --label siguiente-control `
  --model 'C:\Users\user\Documents\prject_local_AI\models\qwen38-27b-perf-iq4_xs-floor4.gguf' `
  --env LLAMA_MMAP_TRIM_GPU=1

# A/B del kernel: repetir otro label añadiendo esta opción, sin cambiar otra cosa.
# --env GGML_CPU_IQ4_MTP=0

# Calidad funcional, logits registrados y código con seis casos externos.
python scripts\qwen38_experiment.py --label siguiente-calidad `
  --model 'C:\Users\user\Documents\prject_local_AI\models\qwen38-27b-perf-iq4_xs-floor4.gguf' `
  --env LLAMA_MMAP_TRIM_GPU=1 --quality-task

# Matriz 6K/12K/25K con caché. Puede tardar varios minutos por los cold prefills.
python scripts\qwen38_experiment.py --label siguiente-cache-mixto `
  --model 'C:\Users\user\Documents\prject_local_AI\models\qwen38-27b-perf-iq4_xs-floor4.gguf' `
  --env LLAMA_MMAP_TRIM_GPU=1 --env LLAMA_ARG_CACHE_RECURRENT_PREFIX=1 --cache-contexts

# Perfil AMD: adjunta al PID real; no usar su velocidad como A/B normal.
python scripts\qwen38_uprof.py
```

Los nombres/argumentos exactos de cada script están en su `--help` o fuente.
`qwen38_uprof.py` puede usar un label fijo ya existente: adaptarlo a un label nuevo
antes de repetir, sin borrar el perfil anterior.

Para la captura de memoria preparada: aplicar **solo** la parte de
`scripts/qwen38-etw/Program.cs` de `prepared-next-experiments.patch`, compilar
`scripts/qwen38-etw/build.ps1`, comprobar `wpr -status` y después usar
`qwen38_memory_profile.py`. `qwen38_browser_pressure.mjs` prepara un Chromium
propio con 512 MiB retenidos y GPU desactivada; no toca las pestañas del usuario.
Estos dos ensayos aún necesitan ejecución/validación.

Arranque/cambio administrado del candidato, cuando no haya benchmark activo:

```powershell
$cambio = @{ clave = 'qwen38-27b-perf-iq4'; pensar = 512 } | ConvertTo-Json
Invoke-RestMethod 'http://127.0.0.1:8787/api/modelos' -Method Post `
  -ContentType 'application/json' -Body $cambio -TimeoutSec 180
Invoke-RestMethod 'http://127.0.0.1:8080/health'
Invoke-RestMethod 'http://127.0.0.1:8787/api/modelos'
```

Rollback de modelo: el mismo POST con `clave = 'qwen38-27b'`. Si hay un servidor
manual, terminar únicamente el PID propio del experimento, no matar procesos
por nombre. Para apagar uno administrado usar `/api/server/stop`; respetar la
identidad executable/puerto/modelo/marker que comprueba el lifecycle.

Evidencias en `<fork>\reports\2026-11-01-qwen38`:

- `PROFILE.md`, `profile.summary.json`: funciones, capas y scheduler.
- `UPROF-CUDA.md`, `uprof-attached/.../report.csv`, `nsys-cuda.stats.csv`.
- `ALLOCATOR.md`, `PLACEMENT.md`, `QUANT-Q40.md`, `QUANT-Q4K.md`.
- `CUDA-MMVQ2*.md`, sus benchmarks, comparaciones y PPL.
- `quant-iq4xs-*`, `ppl-original`, `ppl-iq4xs-floor4` y pruebas de caché.
- Cada `manifest.json`: comando, entorno, SHA de ejecutable/DLL, commit y diff;
  los más recientes incluyen las fuentes realmente compiladas.
- `prepared-next-experiments.patch/.json`: QoS Windows, selector MMQ/atención,
  atribución ETW de memoria y retirada experimental de embedding. **Sin validar;
  fuera del runtime de entrega.**

Los ETL/ETLX, bases de datos uProf, PDBs y capturas Nsight grandes quedan locales
e ignorados por Git; los resúmenes verificables se versionan. No borrar los datos
crudos si vas a reanalizar; conservar los PDBs correspondientes.

## 11. Estado comprobado al entregar

**El trabajo de runtime ha producido mejoras medidas; la aceptación completa del
IDE y la transferencia a otros modelos siguen pendientes.** El usuario pidió
terminar este documento y detener las pruebas. No se ejecutaron nuevas pruebas
después de esa instrucción.

| Elemento | Estado y evidencia final |
|---|---|
| Fuente y binario | Rama `perf/qwen38-27b`, commit `180b041`: CUDA original de cuatro warps restaurado; kernel VNNI aceptado conservado. El patch preparado permanece fuera del runtime. |
| Último benchmark del candidato | Tres repeticiones tras warmup: mediana **10,35568 tok/s**, rango 10,34743–10,37629, desviación 0,01487; TTFT mediano 1537 ms. Prompt de 256 tokens, generación de 96, código repetitivo y aceptación MTP del 100 %. Es una carga concreta, no una promesa de velocidad para cualquier turno del IDE. |
| Calidad final del runtime | 72 probabilidades registradas, diferencia máxima 0 frente a la referencia canónica anterior; mismos tokens greedy. Herramienta de suma 17+25=42, razonamiento y función Python con seis casos externos correctos. |
| Arranque administrado | POST `/api/modelos` aceptó `qwen38-27b-perf-iq4` a las 17:22:50 UTC del 2026-11-01; perfil actual y guardado coincidentes, contexto 32768, razonamiento 512 y `/health` correcto en ese momento. |
| Procesos al cerrar | Se detuvo el turno del agente mediante `/api/stop`; no se apagaron el IDE ni el servidor del modelo. Quedan en ejecución según las últimas operaciones; no se repitió el health check tras la petición de terminar. |
| Espacio del usuario | El helper confirmó restauración del workspace y del chat previamente activos. |
| IDE completo | **Sin aprobación final.** Los ensayos descritos abajo no demuestran todavía un turno real satisfactorio con lectura, respuesta y reutilización de caché. |
| Otros modelos | Matriz de aplicabilidad en el apartado 8; no se ha medido aún una mejora transferida a ellos. |

La comparación representativa anterior, con los mismos prompts y tres repeticiones
por caso, pasó de **6,02673 a 9,26296 tok/s en código (+53,7 %)** y de **4,74036 a
7,13054 tok/s en prosa (+50,4 %)** al pasar del GGUF original al candidato canónico
con la ruta VNNI. No mezclar esos porcentajes con el microbenchmark final de
10,35568 tok/s ni con los 4,3–5,0 tok/s comunicados inicialmente por el usuario.

### Observación pendiente del IDE, sin ocultar el resultado

El primer ensayo de lectura usó por error nuestro workspace de prueba equivocado:
`C:\Users\user\Desktop\New folder (2)`, donde no estaba el documento solicitado.
El modelo comunicó que faltaba el archivo. Esto es un fallo de preparación del
ensayo y no demuestra un defecto del modelo. Tardó 136281 ms; los pasos registraron
9,3/9,2/7,4 tok/s, con `cache_n=0` para prompts de 4342/4421/4555 tokens y primer
razonamiento a 27117 ms. Estos datos tampoco constituyen un A/B del IDE.

El ensayo con workspace corregido **no queda aprobado**: primer razonamiento a
41934 ms, sin primer texto ni acción de lectura registrados, texto final vacío y
`passed=false`; duración registrada 56140 ms. Coincidió con la orden del usuario
de terminar las pruebas y se envió `/api/stop`. Aunque el evento final indicó
`completed`, no acredita que la tarea se resolviera. No atribuir la causa al parser,
al modelo o a la cancelación sin revisar el flujo concreto.

Evidencia: `handoff-ide-read-smoke.json` y
`handoff-ide-read-smoke-corrected.json` en la carpeta de reports del fork;
helper `scripts/qwen38_ide_read_smoke.py`. Ambos informes conservan el resultado
real y el segundo confirma la restauración de workspace y chat.

**Siguiente acción de DeepSeek:** inspeccionar ese turno y el controlador del IDE
para explicar la ausencia de lectura/respuesta y el `cache_n=0`. Corregir la causa
concreta y comprobar un único turno de lectura con herramienta y respuesta útil,
seguido de un turno que reutilice prefijo. Conservar las mejoras aceptadas y el
perfil original de rollback. Continuar los demás pendientes del apartado 7 solo
con una hipótesis y un cambio definidos, sin volver a ejecutar por rutina todos
los experimentos ya documentados.
