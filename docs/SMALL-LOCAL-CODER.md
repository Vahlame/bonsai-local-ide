# Small Local Coder

Modo de coding para un modelo local 7B–9B, una sola sesión y una GPU de 8 GB.
Se implementa sobre el IDE Node.js/JavaScript y su API SSE existentes. No necesita
embeddings, reranker, segundo modelo ni servicios de internet durante la ejecución.

## Uso

Instalar las dependencias una vez con `npm ci --prefix chat`. Tree-sitter usa los
WASM de `@vscode/tree-sitter-wasm@0.3.1` en CPU. No requiere compilar addons nativos.
También se instalan TypeScript 5.9.3 y typescript-language-server 5.0.1 en CPU.

```powershell
# Configuración guardada del escritorio: visión, 36k F16 y razonamiento 4k.
.\scripts\launch-ide.ps1
# Arranque explícito equivalente:
.\scripts\start-ui.ps1 -AgentProfile small-local-coder -EnginePreset 8GB-VISION-LONG -Pensar 4096

# Alternativa de menor VRAM, solo texto y contexto práctico 8k:
# Modelo recomendado: Ornith-1.5-9B-Q4_K_M.gguf, ya presente en models/.
.\scripts\start-server.ps1 -Modelo ornith9b -EnginePreset 8GB-BALANCED
# En otra terminal, con el mismo servidor:
.\scripts\start-ui.ps1 -AgentProfile small-local-coder -EnginePreset 8GB-BALANCED
```

También se selecciona en Ajustes → Agente. La selección guardada tiene prioridad
sobre el valor inicial de `BONSAI_AGENT_PROFILE`. El modo `legacy` conserva las
herramientas generales y el arranque histórico con visión. Un servidor que ya está
abierto se reutiliza: seleccionar un perfil de agente no cambia su reserva de KV.
Para reducir VRAM hay que arrancar el motor con su preset. Los scripts no detienen
servidores ajenos ni cargan otro modelo para hacer el cambio.

## Arquitectura

`code-context.mjs` construye un índice acotado, obtiene símbolos con Tree-sitter,
resuelve imports locales y crea un grafo de archivos. Git determina los archivos
cuando está disponible; hay recorrido local acotado para carpetas independientes,
incluidas carpetas seleccionadas dentro de una ruta ignorada por un Git padre.
Se rechazan enlaces descendientes con la política de rutas existente.

La búsqueda usa ripgrep si está instalado y búsqueda literal local como respaldo.
El ranking combina palabras del pedido, rutas, símbolos, imports, archivo reciente
y cambios. El mapa lleva rutas y metadatos; los snippets llevan líneas numeradas.
El índice tiene límites de 1.500 archivos, 128 KiB por archivo y 8 MiB de texto.
Las lecturas explícitas y la verificación pueden trabajar con archivos mayores.

`coder-harness.mjs` mantiene el estado y las transiciones fuera del modelo:

```text
descubrimiento determinista → [plan compacto] → edición
      → sintaxis → tests afectados → reparación limitada → resultado
```

La edición directa es la opción habitual. Se reserva la pasada PLAN del mismo
modelo para peticiones explícitas de planificación, migraciones, refactors o tareas
amplias. PLAN usa una llamada nativa forzada; no solicita razonamiento privado.
La heurística inicial que activaba PLAN por mencionar una API o export empeoró el
caso cross-file y se sustituyó tras la comparación con edición directa.

Se exponen nueve herramientas: `indice`, `buscar_codigo`, `simbolo`, `leer`,
`reemplazar`, `archivo`, `ejecutar`, `git_diff` y `plan`. Las llamadas nativas llevan
schema estricto y se validan también en el host. Un campo incorrecto produce un
error pequeño con su campo y tipo; se permite una corrección antes de detenerse.
Se conserva la correlación de todos los resultados con sus ids de llamada.

La edición reutiliza el reemplazo exacto y único, tolerancia CRLF, escritura
atómica y deshacer existentes. Se exige inspeccionar archivos existentes. El
reemplazo completo queda limitado a archivos pequeños de 12.000 bytes. Un fallo
de anchor devuelve una región parecida acotada, no el archivo completo.

Después de editar se comprueba sintaxis y se ejecutan tests Node o Python relacionados
por imports inversos. Python resuelve imports relativos y paquetes bajo `src/`;
usa unittest o pytest cuando corresponde, con el Python del entorno virtual si existe.
La ejecución evita reutilizar bytecode obsoleto después de ediciones del mismo tamaño.
La verificación precede al cierre aunque el modelo no la pida.
Se detectan imports locales inexistentes y se distinguen diagnósticos previos.
Revertir un patch al código inicialmente defectuoso vuelve a ejecutar los tests.
Los comandos de verificación respetan el modo de permisos del IDE y tienen timeout
y cierre del árbol de procesos en Windows.

En TypeScript se ejecuta el compilador real con `noEmit`, respetando tsconfig o
jsconfig y distinguiendo errores anteriores de errores introducidos. La comprobación
automática admite hasta 256 archivos raíz; proyectos mayores pueden configurar sus
comandos. El grafo resuelve aliases de tsconfig, imports de paquete y NodeNext.
`simbolo` admite `ruta`, `linea`, `columna` y `referencias`: consulta el LSP cuando
hay una posición inequívoca y obtiene definiciones de origen y referencias semánticas.
Si falla el LSP se indican expresamente las coincidencias léxicas. Los nombres
ambiguos requieren posición; el proceso LSP se cierra al acabar la tarea.

Para otros compiladores, lint, tipos o tests, configurar comandos explícitos:

```json
{
  "verification": [
    {"file": "python", "args": ["-m", "pytest", "tests/test_parser.py", "-q"]}
  ]
}
```

Guardar ese JSON como `.bonsai-coder.json` en la raíz del proyecto. Los comandos
se ejecutan sin interpolación de shell. Para scripts npm en Windows puede usarse
`cmd.exe` con argumentos `/d`, `/s`, `/c`, `npm test`.

## Presupuestos, memoria y trazas

`chat/coder-profile.json` contiene los valores predeterminados: 8.192 tokens de
contexto práctico, 1.536 de salida, 600 para mapa, 1.800 para snippets iniciales,
1.000 por resultado, 32 pasos, dos reparaciones y cinco minutos por tarea.
`BONSAI_CODER_OPTIONS` permite probar presupuestos y estrategia sin editar código.

El prefijo conserva sistema, herramientas, entorno y reglas del proyecto. El estado
variable queda después. Se mantienen el pedido original íntegro y hasta cuatro
grupos recientes completos de llamadas/resultados. Se eliminan primero grupos
obsoletos, después mapa y snippets secundarios. Si siguen sin caber los requisitos,
se devuelve un error explícito. El conteo usa el tokenizer del servidor; sin él se
usa un límite conservador por bytes UTF-8, incluyendo los schemas.

La vista del estado tiene un presupuesto propio de 180–600 tokens, conserva el
primer error y muestra contadores de elementos omitidos. Los logs completos siguen
fuera del prompt. Si una última llamada contiene argumentos enormes, se retira el
grupo completo, se exige releer las líneas necesarias y se conserva el pedido íntegro.

El estado guarda objetivo, inspecciones, modificaciones, plan, tests, errores,
reparaciones y diff respecto al inicio de la tarea. Git conserva por separado el
estado previo. No se ejecutan reset, checkout ni borrados para limpiar cambios del
usuario. El historial visible se conserva fuera del prompt.

Las trazas JSONL y los logs completos de verificaciones se guardan bajo
`BONSAI_STATE/agent-traces/` (por defecto `chat/agent-traces/`). La API
`GET /api/agent-trace?id=<taskId>` exporta una traza. `/api/state` incluye el estado
de la tarea. Los eventos operativos registran fases, selección, tokens, cache,
latencia, TTFT, llamadas inválidas y resultados. Por petición posterior del usuario,
la UI muestra además el razonamiento que transmite el modelo local, separado de la
respuesta. Se guarda localmente en el historial, con tope de 65.536 caracteres por
turno; no se reinyecta al modelo. Ajustes permite contraerlo por defecto. Los
benchmarks solo conservan sus contadores. Las repeticiones
y ciclos se detectan por argumentos y contenido del proyecto.

## Motor y presets

Los presets de `config/local-engine-presets.json` usan el mismo GGUF Q4_K_M,
una secuencia, Flash Attention y colocación estándar de tensores con todas las
capas solicitadas en GPU. En este equipo el log confirma 34/34 capas CUDA y
545,62 MiB de pesos CPU_Mapped. Es diferente del modo histórico que fuerza todos
los tensores a CUDA. El KV permanece en GPU. No se cambia ningún kernel.

| Preset | Contexto | KV | Batch / ubatch | Margen exigido | Visión |
|---|---:|---|---|---:|---|
| 8GB-SAFE | 4096 | F16 | 256 / 128 | 1024 MiB | apagada |
| 8GB-BALANCED | 8192 | F16 | 512 / 256 | 768 MiB | apagada |
| 8GB-MAX-SPEED | 8192 | F16 | 1024 / 512 | 768 MiB | apagada |
| 8GB-CONTEXT | 16384 | F16 | 512 / 256 | 768 MiB | apagada |
| 8GB-VISION | 16384 | F16 | 512 / 256 | 768 MiB | activa |
| 8GB-VISION-CONTEXT | 32768 | Q8 | 512 / 256 | 768 MiB | activa |
| 8GB-VISION-QUALITY | 32768 | F16 | 512 / 256 | 400 MiB | activa |
| 8GB-VISION-LONG | 36864 | F16 | 512 / 256 | 400 MiB | activa |

Los perfiles con visión permiten conservar el proyector y el contexto de código
simultáneamente. QUALITY y LONG reservan **6.144 tokens de salida**, incluyendo
hasta **4.096 de pensamiento y 2.048 de respuesta/edición**. El modelo puede terminar
de razonar antes: no se fuerza un gasto mínimo. Se piensa al iniciar y tras fallos; los pasos rutinarios
reutilizan la evidencia sin repetir ese coste. Los perfiles anteriores conservan
su límite de 512 tokens de pensamiento. Para salidas pequeñas se conservan dos
tercios para responder; para salidas mayores se protegen 2.048 tokens. La ventana
es compartida: LONG admite hasta 30.592 tokens de historial sin imágenes; los
adjuntos descuentan su presupuesto antes del empaquetado. Ver los resultados en
[la fase 3](../reports/coder-phase3/RESUMEN.md).

En Ajustes → Motor, elegir un perfil y pulsar **Aplicar perfil** reinicia el servidor
administrado, verifica su salud y guarda la selección. También ajusta el historial
al contexto real. El modo **Consulta** responde con texto e imágenes sin ejecutar
herramientas; el modo **Agente** puede editar y verificar el proyecto.
Las imágenes de una tarea de coding permanecen en el pedido original durante
las lecturas, las ediciones y las reparaciones. Su presupuesto se descuenta antes
de empaquetar el contexto y sus píxeles no se guardan en la sesión.

MAX-SPEED favorece el prefill corto: ganó un 2,4 % en pp512, sin mejora de decode
y sin ganar en pp4096. BALANCED es la recomendación para coding. Los n-gramas se
descartaron: la ganancia en texto repetitivo produjo 6/7 tareas de coding y mayor
tiempo total frente a 7/7 con BALANCED. Ningún preset los activa. La
comprobación previa suma el buffer CUDA de pesos calibrado para esta colocación,
KV de la arquitectura, reserva de cómputo/runtime, proyector si está activo y margen.
Es una estimación conservadora, distinta de la VRAM observada. Para BALANCED suma
4.864 + 256 + 620 + 768 = 6.508 MiB libres requeridos. LONG suma
4.864 + 1.152 + 620 + 900 + 400 = 7.936 MiB. Los 4.864 incluyen los 4.812,25 MiB
CUDA observados y un pequeño margen; el modo histórico mantiene su estimación propia.

La barra de la UI usa `nvidia-smi memory.free`, no total menos usado. Antes de una
petición con imágenes se vuelve a medir: se exigen 400 MiB más 64 MiB transitorios
(464 MiB libres). Si otras aplicaciones consumen GPU, se rechaza esa petición con
un error explícito. No se cambia F16 por Q8 automáticamente. La reserva no puede
impedir que otra aplicación consuma memoria durante la inferencia.

La UI tiene seis temas persistentes y un panel de pensamiento desplegable. El
lanzador registra fallos en `logs/ide-launcher.log`, comprueba que el puerto sea
del IDE y reutiliza una instancia sana. El acceso directo del escritorio apunta
a ese lanzador, sin consola permanente.

El arranque con navegador conserva `--open` como un argumento completo en
Windows PowerShell 5.1. `node chat/prueba-lanzador.mjs` comprueba esa frontera
PowerShell/Node tanto con apertura del navegador como con `-NoBrowser`, sin
arrancar modelos ni tocar el workspace.

## Evaluación y alcance

```powershell
npm test
npm run benchmark:coder -- --out reports/mi-corrida --seed 42
node chat/evaluar/coder.mjs --out reports/ablation --ablation map-off --seed 42
npm run benchmark:engine -- --base-url http://127.0.0.1:8080 --out reports/motor.json
# Detener primero el servidor propio: el autotuner necesita un puerto libre.
npm run benchmark:engine -- --tune --out reports/tuning.json
node chat/evaluar/comparar-coder.mjs before/informe.json after/informe.json comparacion.json
```

El benchmark contiene siete proyectos Node sin dependencias: bug simple,
descubrimiento sin ruta, cambio entre módulos, test fallido, API de otro módulo,
compatibilidad y reparación con inyección de error. Ejecuta tests resultantes,
aserciones originales inmutables, oráculos ocultos y sintaxis. Añadir tests válidos
está permitido salvo prohibición explícita. Los informes v1 que exigían igualdad
literal de tests se recalcularon con `revalidar-coder.mjs`; se conservan los originales.

`--suite extended` añade descubrimiento entre 43 archivos con distractores, una API
Python y una API TypeScript con verificación de tipos. `--workspace-root` permite
comparaciones con la misma ruta absoluta; `--context-tokens` fija el presupuesto del
agente. Las ablaciones `map-off`, `map-large`, `full-files`, `snippets-off`, `cache-off`,
`direct` y `plan` registran la configuración real. El fixture amplio sí diferencia
los mapas de 600 y 1.800 tokens; los fixtures originales eran demasiado pequeños.
`--thinking 1024 --coder-options '{"outputTokens":3072,"thinkingTokens":1024}'`
permite comparar pensamiento con el mismo presupuesto de salida. El proxy conserva
el número de caracteres de razonamiento, sin almacenar su contenido.

Ver [mediciones iniciales](../reports/coder-2026-10-28/RESUMEN.md) y
[continuación con CUDA, LSP y contexto](../reports/coder-phase2/RESUMEN.md).
Son tareas sintéticas, no una garantía sobre repositorios arbitrarios. El LSP
semántico cubre JS/TS; en otros lenguajes las referencias siguen siendo léxicas.
No se evaluaron otras cuantizaciones de pesos ni monorepos grandes. Los comandos
de verificación explícitos permiten integrar otros compiladores y suites.
La [toolchain instalada y su reproducción](INFERENCE-TOOLCHAIN.md) incluyen nvcc,
Nsight y un build CUDA específico; los resultados diferencian medidas reales y
opciones que todavía no se han comparado.

Fuentes de las capacidades del runtime: [llama.cpp, servidor en adfffbe41](https://github.com/ggml-org/llama.cpp/blob/adfffbe41/tools/server/README.md),
[speculative decoding](https://github.com/ggml-org/llama.cpp/blob/adfffbe41/docs/speculative.md)
y [compilación](https://github.com/ggml-org/llama.cpp/blob/adfffbe41/docs/build.md).
