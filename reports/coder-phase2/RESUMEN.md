# Continuación: IDE operativo y pendientes

Estado histórico. La [fase 3](../coder-phase3/RESUMEN.md) continúa las pruebas,
incorpora visión y pensamiento con 32k F16 y actualiza los pendientes.

Fecha: 29 de octubre de 2026. Se detuvieron los experimentos largos a petición
del usuario para conservar el presupuesto restante y dejar el IDE funcionando.

## Estado entregado

- IDE: **http://127.0.0.1:8787**, con `small-local-coder` seleccionado.
- API local: **http://127.0.0.1:8080**, Ornith-1.5-9B Q4_K_M, una sola instancia.
- Perfil principal: **8GB-BALANCED**, contexto 8.192, KV F16, Flash Attention,
  batch 512 / ubatch 256, prompt cache y margen exigido de 768 MiB.
- Runtime original conservado en `bin/`. El build nuevo está disponible fuera del
  repositorio y no se activó como predeterminado: no demostró una mejora clara de decode.
- Se conserva la carpeta de trabajo que ya estaba seleccionada en el IDE y los
  cambios previos del usuario. Los procesos del IDE/modelo quedan abiertos por petición.

Reabrirlo después de cerrar los procesos:

```powershell
.\scripts\start-ui.ps1 -AgentProfile small-local-coder -EnginePreset 8GB-BALANCED
```

Para tareas que necesiten más espacio existe `8GB-CONTEXT`, con 16.384 tokens y
KV F16. Es opcional. Al arrancar un servidor nuevo, `start-ui.ps1` adapta también
el presupuesto del agente al preset. Un servidor que ya estaba abierto se reutiliza;
para cambiar su reserva de KV hay que cerrar primero el servidor administrado.
El ajuste de historial guardado sigue teniendo prioridad y el IDE muestra su límite efectivo.

## Instalado y comprobado

- CUDA Toolkit **12.9.1**, nvcc **12.9.86**, runtime, CCCL y cuBLAS.
- Nsight Systems **2026.3.2** y Nsight Compute **2026.3**; ambos ejecutaron perfiles reales.
- MSVC 2022 Build Tools, CMake y Ninja existentes reutilizados.
- TypeScript **5.9.3** y typescript-language-server **5.0.1** en CPU.

La instalación está en `%USERPROFILE%\.local\opt\bonsai-inference`. Se verificaron
los SHA-256 de los seis paquetes oficiales. PATH y CUDA_PATH del usuario están
configurados para terminales nuevas; los valores anteriores están respaldados en
`config/inference-toolchain.local.json`, excluido de Git. No se sustituyó el driver.

El build usa el mismo commit de llama.cpp que el runtime original:
`adfffbe41b2cabcd51fff326ab045662265062bb`, Release y arquitectura CUDA `89-real`.
La DLL CUDA bajó de **563.141.632 a 60.008.448 bytes**. Es una reducción de tamaño,
no una demostración de mayor velocidad. Flags y hashes: [build-Auto.json](build-Auto.json).
Instrucciones: [toolchain y reproducción](../../docs/INFERENCE-TOOLCHAIN.md).

## Mejoras del agente completadas

- Imports Python relativos y paquetes bajo `src/`; tests afectados unittest/pytest,
  selección de Python del entorno virtual y protección contra bytecode obsoleto.
- Compilador TypeScript real, aliases de tsconfig, imports de paquete y NodeNext.
  Diagnósticos anteriores separados de los introducidos, incluyendo errores duplicados.
  Más de 40 errores o 256 archivos raíz produce aviso explícito de comprobación incompleta.
- LSP opcional para definiciones de origen y referencias semánticas JS/TS, con
  timeout, cancelación, rutas acotadas y cierre de procesos. Los nombres ambiguos
  requieren posición; el respaldo léxico se identifica expresamente.
- Estado de trabajo con vista acotada y logs completos fuera del prompt. Los estados
  pequeños conservan su formato. Los grandes se compactan sin recortar el pedido original.
  Una llamada enorme se elimina junto con su resultado y obliga a releer antes de editar.
- Evaluación ampliada de 7 a **10 tareas**, incluyendo Python, TypeScript y
  descubrimiento entre 43 archivos. Comparaciones con la misma ruta de workspace,
  fixtures identificados por hash, semillas y snapshots de código independientes.
- Ablación `full-files` y fixture que diferencia realmente mapas de 600 y 1.800 tokens.

## Mediciones reales

Validación del código entregado: **34/34 suites pasan**, 107,7 s, en
`tests-final-code.log`. También pasaron las regresiones focalizadas de TypeScript/LSP
y compactación. El smoke integrado final resolvió una tarea real de edición y
verificación mediante SSE. La página del IDE devuelve HTTP 200 y el modelo responde
`ok`; el perfil de coding quedó guardado en Ajustes. Al cierre se observaron
5.281 MiB usados y 2.676 MiB libres de VRAM.

RTX 4060 Laptop, 8.188 MiB, driver 617.14; un solo LLM. Las medidas del motor
incluyen warm-up y medianas de tres repeticiones. Los resultados del agente usan
tests públicos, aserciones originales inmutables, oráculos ocultos y sintaxis;
TypeScript añade comprobación de tipos. Son fixtures sintéticos.

| Configuración | Pico VRAM del motor | Libre mínimo | Calidad medida |
|---|---:|---:|---|
| F16, 4k | 5.149 MiB | 2.808 MiB | 8/10 antes de corregir la compactación |
| F16, 8k | 5.279 MiB | 2.678 MiB | 10/10, snapshot V1, semilla 42 |
| Q8 KV, 8k | 5.175 MiB | 2.782 MiB | 10/10, snapshot V1, semilla 42 |
| Q4 KV, 8k | 5.111 MiB | 2.846 MiB | 10/10, snapshot V1, semilla 42 |
| F16, 16k | 5.539 MiB | 2.418 MiB | 10/10, snapshot V1, semilla 42 |

Se completaron también **12 combinaciones** F16/Q8/Q4 a 2k/4k/8k/16k en el
runtime original. A 8k, Q8 ahorra 104 MiB y Q4 ahorra 168 MiB; F16 ya tiene margen
suficiente y evita una cuantización adicional. Aumentar de 8k a 16k F16 cuesta
260 MiB. No se demostró que ese aumento mejore la calidad general.

El build nativo resolvió **20/20 tareas** a 8k con el snapshot V2 y semillas 42/43.
Tardó 297.594 y 202.481 ms respectivamente; esa variación impide presentar una
ganancia estable. La ventana 16k de esa corrida quedó interrumpida y **no se puntúa**.
V2 compactaba también estados pequeños. La versión final conserva su formato y
añade el ajuste de diagnósticos duplicados; por eso 20/20 no se atribuye al código final.
El smoke test integrado del snapshot final resolvió **1/1** tarea con el modelo real.

La generación sigue aproximadamente en **42 tokens/s**. En el experimento limpio,
CUDA Graphs dio 41,90 tok/s para pp2048/tg128 frente a 38,20 sin graphs, con los
mismos hashes greedy. Se mantiene activado. Sampling en GPU dio 42,40 tok/s,
pero empeoró TTFT y añadió memoria; no se incorporó al preset. La caché redujo
TTFT de 569,5 a 56,4 ms en una pareja de peticiones con prefijo repetido de 1.024
tokens, reutilizando 1.020; esa pareja no representa todas las peticiones del IDE.

Nsight muestra que los kernels cuantizados matriz-vector acumulan aproximadamente
84,7 % del tiempo GPU del perfil. El kernel dominante muestreado registra 95,8 %
en la métrica de actividad/throughput DRAM y 29,4 % en SM, consistente con presión
de memoria. Las copias H2D incluyen la carga de pesos. La espera en sincronización
incluye trabajo de GPU; no demuestra que pueda eliminarse. Se observaron graphs
reutilizados y cuatro cudaMalloc/cuFree en todo el proceso, sin evidencia de una
asignación CUDA nueva por token. **No se modificaron kernels.**

Correctness nativo: **82/82 casos CUDA MUL_MAT** contra referencia CPU, incluyendo
F16/Q4_K/Q8_0, tamaños impares y batches. Los casos NaN/Inf preparados en
`scripts/test-inference-edges.cpp` todavía no se ejecutaron y no forman parte de esos 82.

Datos: [measurements.json](measurements.json), [coding.csv](coding.csv),
[matriz original](engine-context-kv-original.json),
[calidad por contexto/KV](engine-new-quality.json),
[opciones de runtime](engine-runtime-options-clean.json),
[perfil resumido](profile-summary.json),
[estado de la corrida detenida](engine-native-final-run-status.json).
`node reports/coder-phase2/summarize.mjs` regenera las tablas derivadas.
Se excluye el primer experimento de opciones de runtime, interrumpido al solaparse
con tests; las decisiones usan la repetición limpia.

## Pendiente, por prioridad

1. **Validar las diez tareas y dos semillas con el snapshot final**, a 8k y 16k,
   manteniendo runtime, workspace y fixtures iguales. El código final tiene smoke
   real y regresiones focalizadas; la matriz completa pertenece a snapshots anteriores.
2. **Repetir 4k después de la corrección de compactación.** Los 8/10 registrados son
   anteriores al arreglo y no deben anunciarse como resultado de la versión final.
3. **Medir las ablaciones amplias** mapa 0/600/1.800 y snippets frente a archivos completos,
   con al menos dos semillas. Los presupuestos distintos están comprobados por tests,
   pero falta la comparación LLM sobre el fixture amplio.
4. **Comparar build original/nativo con el mismo harness final** y varias ejecuciones,
   incluyendo arranque, RAM durante coding, hashes greedy y tiempo a solución correcta.
   Conservar el original hasta demostrar una ventaja suficiente.
5. Compilar y ejecutar `scripts/test-inference-edges.ps1` contra ambos runtimes para
   ADD/MUL F32 con NaN/Inf y formas impares; todavía no se verificó ese script en ejecución.
6. Evaluar otras cuantizaciones de pesos si se consiguen versiones verificadas del mismo
   modelo. No se compararon Q5/IQ4, forced MMQ/cuBLAS ni LTO. El perfil actual no justifica
   mantener un kernel personalizado sin evidencia adicional.
7. Ampliar a repositorios reales, monorepos y más lenguajes. LSP semántico disponible
   en JS/TS; referencias de otros lenguajes siguen siendo léxicas. No hay garantía de
   éxito general a partir de diez fixtures.

La fase inicial, su baseline y la comparación controlada del harness están en
[el reporte anterior](../coder-2026-10-28/RESUMEN.md). Sus límites históricos sobre
la ausencia de CUDA/Nsight/LSP quedan actualizados por este reporte.
