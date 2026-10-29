# Auditoría de los dos prompts originales

29 de octubre de 2026. Fuentes: el prompt «MISIÓN» vuelto a adjuntar en esta
conversación y «FASE EXTRA — OPTIMIZACIÓN DE BAJO NIVEL DEL MOTOR DE INFERENCIA».
Este archivo separa trabajo implementado, evidencia disponible y trabajo pendiente;
no declara cumplidos todos los experimentos solicitados.

Las instrucciones posteriores tienen prioridad: F16 activo, visión simultánea,
4.096 tokens disponibles para razonamiento, 400 MiB libres, pensamiento visible,
UI/temas/lanzador y menos pruebas repetitivas. Por eso se conserva el razonamiento
local visible aunque el primer prompt lo prohibía. Aumentar su presupuesto es una
preferencia de producto, no una mejora de calidad demostrada.

## Ya entregado

| Requisitos del prompt principal | Implementación y evidencia |
|---|---|
| Fase 0, baseline, 24–30 | Inspección de arquitectura real, harness reproducible de siete tareas ampliado a diez, baseline y comparación controlada; perfil small-local-coder seleccionable. Informes de las tres fases. |
| 1, 15–16: sesión, caché, speculative | Un solo modelo persistente y llamadas secuenciales, prefijo estable, reutilización KV medida; n-gram speculative probado y descartado por menor éxito de coding. |
| 2–4: descubrimiento/contexto | Tree-sitter CPU, búsqueda lexical/ripgrep, imports y grafo, ranking por tarea/ruta/símbolos/cambios, mapa acotado, snippets y lecturas por rango/símbolo. LSP semántico opcional en JS/TS. |
| 5–6: herramientas | Nueve herramientas con llamadas nativas/schema estricto, validación del host y corrección acotada. No se sustituyó por un parser de texto frágil. |
| 7–8, 17–18: protocolo | Estados externos DISCOVER/PLAN/EDIT/VERIFY/REPAIR/DONE; instrucciones breves por fase, edición directa y PLAN compacto del mismo modelo según heurística/configuración. |
| 9, 19, 21: edición y grounding | Reemplazo exacto/único, CRLF, precondiciones, fallback pequeño, deshacer y Git preexistente separado. Verificación de rutas, imports y símbolos mediante las herramientas. |
| 10–13: verificación y memoria | Sintaxis, imports, TypeScript/diagnósticos previos, tests Node/Python afectados y comandos configurables; dos reparaciones, repetición/ciclos/pasos/timeout; estado y logs externos; presupuesto exacto previo, salida protegida y pedido original íntegro. |
| 14: GPU | Presets de 8 GB, GPU offload por capas, KV/Flash/batch/ubatch/mmap medidos, estimación de VRAM y comprobación real. F16 activo con visión y margen de 400 MiB. |
| 20, 22: reglas y observabilidad | Reglas existentes del proyecto y metadatos compactos; trazas exportables con fase/contexto/tokens/herramientas/errores/latencias/verificación; pensamiento local visible por petición posterior, fuera del prompt reenviado. |
| 23: A/B | Baseline controlada, ablaciones iniciales limitadas, matriz KV/contexto, Flash, batch, caché, n-gramas y comparación pensamiento 0/1k a dos semillas. No todas las ablaciones solicitadas están completas. |

La comparación inicial a 8k pasó de 6/7 a 7/7; no se extrapola a proyectos
arbitrarios. En la comparación posterior a 32k, pensamiento 1k dio 18/20 frente
a 19/20 sin él. La configuración activa 36k F16/4k tiene comprobación funcional
visual 3/3, no una nueva matriz de calidad equivalente.

| Requisitos de la fase extra | Implementación y evidencia |
|---|---|
| 1–3, 26–29 | Motor/commit/build/hardware identificados, presupuesto explícito y autotuner acotado, presets y resultados crudos. Warm-up/medianas de tres repeticiones en microbenchmarks; scoring de tareas exige cierre real. |
| 5–8, 22–23 | Doce combinaciones de KV F16/Q8/Q4 a 2/4/8/16k, Flash ON/OFF y batch/ubatch; 34/34 capas GPU con buffer CPU_Mapped declarado. Perfiles pequeños y grandes disponibles. |
| 10–13, 16–17 | CUDA/nvcc/Nsight instalados, build sm89 del mismo commit, profiling Systems/Compute, observación de asignaciones y sincronización, CUDA Graphs medidos y reutilizados, prefijo frío/caliente medido. |
| 18–21 | N-gram speculative y sampling GPU evaluados y no adoptados; caché del conteo de prompts y streaming existentes. Auditoría parcial del pipeline, sin demostrar una copia eliminable nueva. |
| 24–25 | Configuración y tuning sin fork profundo ni kernel nuevo; 82/82 MUL_MAT y 18/18 ADD/MUL NaN/Inf/anchos impares por runtime. |

No quedan pendientes nvcc ni Nsight: ya están instalados y se usaron. No se cambió
el driver. La compilación sm89 tiene menor tamaño, pero no demostró mejor velocidad
de manera suficiente; por eso se entrega el runtime original.

## Pendiente, ordenado por impacto

1. **Validación sobre repositorios reales y omisiones de requisitos.** Añadir tareas
   representativas de trabajo cotidiano y monorepos, medir requisitos completos,
   regresiones y tiempo a solución correcta. Los fixtures sintéticos todavía dejan
   escapar omisiones cross-file y roturas de API; DONE del host no garantiza cubrir
   todo el pedido. Es el mayor límite de calidad conocido.
2. **Calidad con el presupuesto actual de 4k.** Falta comparación controlada frente
   a 0/1k con las mismas reservas, código y fixtures. La comprobación final verifica
   que se envía el presupuesto y que funcionan visión/contexto/edición, pero no
   prueba una mejora de tasa de éxito ni fuerza consumir 4k tokens. Se aplazó la
   matriz por petición expresa de reducir pruebas.
3. **Ablaciones discriminantes del harness (principal 8 y 23).** Completar mapa
   0/600/1.800 sobre el fixture amplio, snippets/archivos completos y DIRECT/PLAN
   sobre cambios amplios con rutas idénticas y varias semillas. Los fixtures
   pequeños iniciales no discriminaban los tamaños del mapa; algunas corridas
   iniciales tenían otras diferencias. El runner existe, no se ejecutó al cierre.
4. **Comparación final de motores y contextos.** Original/sm89 con exactamente el
   mismo harness final, varias semillas y mediciones comparables de RAM/arranque,
   4k después de compactación y 8k/16k después de los últimos cambios. Las matrices
   anteriores pertenecen a snapshots identificados; no se atribuyen automáticamente
   al código actual ni al preset 36k.
5. **Cobertura semántica y verificación adicional (principal 2, 10, 19–20).** LSP
   fuera de JS/TS, importaciones/APIs externas y resolución semántica de otros
   lenguajes, extracción más amplia de reglas de CLAUDE/CONTRIBUTING/metadata y
   selección automática de linters/compiladores de otros ecosistemas. Actualmente
   hay AST/búsqueda, Python y comandos explícitos; los límites del índice/tipos se
   anuncian y no equivalen a indexar/verificar un monorepo completo.
6. **Cuantizaciones alternativas de pesos (extra 4).** Conseguir GGUF verificados
   del mismo modelo Q5/IQ4 y comparar calidad/memoria/tiempo. No se descargaron ni
   midieron esas variantes. El modelo activo conserva Q4_K_M; F16 se refiere al KV,
   y BF16 al proyector, no a pesos completos F16.
7. **MMQ/cuBLAS/LTO y profiling CPU específico (extra 9–10, 19–21).** Faltan las
   comparaciones forzadas y una atribución separada de tokenización, construcción
   del prompt, serialización/copies y sampling. Hay scripts de build/opciones y
   contadores de GPU; no se afirma que una variante no medida sea superior.
8. **Selección automática de reserva KV por tarea (extra 22).** Hay presets SMALL/
   NORMAL/LARGE y selección manual persistente; no hay un cambio automático por
   tarea que libere/reasigne KV sin interrumpir la sesión. Se conserva el modelo
   cargado y el contexto solicitado para evitar recargas inesperadas.
9. **Correctness y portabilidad ampliadas.** Más arquitecturas, modelos, lenguajes,
   batches/contextos, casos numéricos y tareas visuales reales. La comprobación
   final mantiene 594 MiB libres en el muestreo; no cubre aplicaciones ajenas que
   asignen memoria durante una petición ni todos los transitorios del driver.

## Experimentos que no corresponde presentar como pendientes de implementación

- **Kernels nuevos/fusión/allocations/sincronización (extra 12–16, 20):** no se
  implementaron porque el profiling no demostró un cambio concreto correcto y
  rentable. Crear un patch solo para completar una lista contradice PROFILE →
  BENCHMARK → OPTIMIZE. Cualquier candidato futuro necesitará correctness y A/B.
- **Tool calling de texto y unified diff como reemplazo (principal 23):** no se
  ejecutó ese contraste independiente; el proyecto ya tenía llamadas nativas y
  reemplazo estructurado. Se conservaron esas partes sanas.
- **Edición AST:** AST se usa para descubrir/leer/verificar; no se agregó una API
  de transformación semántica de árboles. El reemplazo exacto con precondición es
  el camino normal medido y no requiere una reescritura de editor.
- **N-gramas, sampling GPU y build sm89 por defecto:** experimentados, sin beneficio
  suficiente de extremo a extremo; no se activan por completar una casilla.
- **Contexto máximo nativo de 262k:** no certificado en esta GPU. Se respeta F16
  y el margen, manteniendo 36.864; no se pretende ocupar todos los bytes libres.

Los cambios del agente, benchmarks y documentación se entregan versionados. Los
modelos, binarios, toolchain, sesiones privadas y trazas voluminosas permanecen
locales e ignorados. La evidencia detallada está en [RESUMEN.md](RESUMEN.md),
[la fase inicial](../coder-2026-10-28/RESUMEN.md) y [la fase 2](../coder-phase2/RESUMEN.md).
