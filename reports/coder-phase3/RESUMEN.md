# IDE, visión, contexto y razonamiento — entrega del 29 de octubre de 2026

El IDE queda operativo en <http://127.0.0.1:8787>, con una sola instancia local de
Ornith 1.5 9B Q4_K_M. Se conserva el runtime original `b10743-adfffbe41` y el
workspace del usuario. No se modificó su proyecto externo.

## Configuración activa

| Parámetro | Valor |
|---|---|
| Agente / motor | small-local-coder / 8GB-VISION-LONG |
| Ventana total | 36.864 tokens |
| KV | **F16**, sin conversión automática a Q8 |
| Salida reservada | 6.144 tokens: hasta **4.096 de razonamiento**, 2.048 para responder/editar |
| Historial efectivo sin imágenes | 30.592 tokens, incluyendo instrucciones y herramientas |
| Visión | Proyector BF16 en CUDA, hasta 512 tokens por imagen |
| Batch / ubatch / secuencias | 512 / 256 / 1 |
| Flash Attention / caché de prefijo | activadas |
| Mínimo libre solicitado | **400 MiB** |
| Admisión de imágenes | al menos 464 MiB libres: 400 + 64 transitorios |

El razonamiento de 4k es un presupuesto disponible, no una obligación de generar
4k tokens. El modelo puede concluir antes. En coding se activa al inicio y tras
fallos; los pasos rutinarios no repiten ese coste. Entrada, imágenes, razonamiento
y respuesta comparten la misma ventana; aumentar la reserva de salida reduce la
entrada disponible. No se añaden 4k por fuera de los 36k.

El presupuesto previo conservador suma 4.864 MiB de pesos CUDA calibrados + 1.152
de KV + 620 de cómputo/runtime + 900 de visión + 400 de margen = **7.936 MiB**.
Es una estimación de arranque, no memoria medida. Todas las capas se solicitan en
GPU: el log confirma 34/34; la colocación estándar conserva **545,62 MiB de pesos
CPU_Mapped** y 4.812,25 MiB de pesos CUDA. No equivale a todos los tensores en GPU.

Cerrar el navegador liberó memoria para conservar F16. Otras aplicaciones pueden
volver a consumir VRAM. El arranque y la admisión de imágenes comprueban memoria
real; si no alcanza se informa del error, sin cambiar silenciosamente el KV.
Ninguna comprobación puede reservar memoria frente a futuras asignaciones de otra app.

## UI y lanzador

- Seis temas persistentes: Grafito, Niebla azul, Bosque, Arena, Marfil y Medianoche.
  Superficies más suaves, tipografía y espaciado legibles, ajustes agrupados y
  menos información repetida en la barra inferior; interfaz adaptable a móvil.
- Pensamiento del **modelo local** en un panel desplegable, separado de la salida
  y las acciones. Se muestra como texto seguro y se guarda localmente para poder
  verlo al recargar; hasta 65.536 caracteres por turno. No se reenvía al modelo.
  Los chats anteriores que no lo registraron no pueden recuperarlo.
- VRAM libre real visible, consultada con `nvidia-smi memory.free`; no se deduce
  restando usado a total porque existe memoria reservada por el sistema.
- El acceso directo **Bonsai IDE** apunta a `scripts/launch-ide.ps1`: reutiliza una
  instancia propia sana, recuerda ajustes y registra fallos en `logs/ide-launcher.log`.
  Arranca sin consola permanente. `-NoBrowser` permite iniciarlo sin abrir navegador.

Las solicitudes nuevas pueden ver el pensamiento desde la UI. Estos cambios siguen
la petición posterior del usuario, que sustituye la instrucción inicial de no mostrarlo.

## Comprobación final acotada

[vision-36k-f16-4k.json](vision-36k-f16-4k.json): **3/3 casos pasan**, con F16 y
presupuesto efectivo de razonamiento 4.096; 6.144 de salida en cada primera llamada.
Incluye lectura de cifras solo presentes en una imagen de 1.200 × 528, consulta con
texto largo y recuerdo de constantes distribuidas, y edición guiada por imagen
con tests originales, oráculo oculto, verificación automática e imagen conservada
durante los tres pasos. OCR desactivado.

La consulta larga usa **28.266 tokens nativos de entrada**. Pico global de GPU:
**7.363 MiB usados y al menos 594 MiB libres**. Se excede el mínimo de 400 MiB.
No se afirma haber consumido 4k de razonamiento: las tres tareas breves terminaron
antes. Tampoco se afirma comprensión arbitraria de toda la ventana.

La comprobación anterior con reserva 3.072/pensamiento 1.024 había pasado 3/3 con
**32.906 tokens nativos de entrada**, pico 7.365 y 592 MiB libres. Es evidencia de
la ventana de 36k, **no** del mismo presupuesto de entrada con razonamiento 4k.
Se conserva localmente en `runs/final-36k-vision/vision.json` y en el resumen de métricas.

[runtime-final.json](runtime-final.json) confirma página y APIs sanas, un único
modelo, visión, KV F16, pensamiento 4k, perfil/contexto/tema guardados y carpeta
original conservada. El lanzador se comprobó reutilizando el IDE.

Corrección posterior del acceso directo: PowerShell 5.1 convertía la opción
`--open` en argumentos de un carácter y Node rechazaba `-`. Se conservaron arrays
tipados en el arranque y se añadió `prueba-lanzador.mjs` para ambos modos. También
se ejecutó el `.lnk` real desde servicios detenidos: el IDE abrió el navegador,
cargó 36.864/F16 y conservó el razonamiento 4.096. Esta comprobación no hizo
inferencias adicionales. Los 594 MiB de la medición anterior corresponden al
navegador cerrado; la UI abierta puede reducir ese margen y se mantiene la
comprobación de 464 MiB antes de admitir imágenes.

La suite focalizada `prueba-small-coder.mjs` pasa, incluyendo 4k de pensamiento
con 2k protegidos para editar. Pasan las comprobaciones de sintaxis de los archivos
modificados. La prueba UI ya pasó los seis temas, streaming seguro del pensamiento,
persistencia, VRAM visible, Ctrl+K, conflicto 409, ajustes y viewport móvil
390 × 844: [escritorio](ui-desktop.png), [móvil](ui-mobile.png).
Las **34 suites aisladas** pasaron en 106,6 s antes del último ajuste de presupuesto
y del rediseño final; no se repitieron en bloque por petición del usuario.

## Qué mejoró y qué no está demostrado

La [comparación inicial controlada](../coder-2026-10-28/RESUMEN.md) a 8k F16 pasó
de **6/7 a 7/7**, con **59,2 % menos tokens de entrada** y **28,2 % menos tiempo**.
Mismo motor y servidor, una semilla; no es una tasa general sobre repos reales.

La comparación posterior pareada mantiene **32k F16, visión y salida 3.072**:

| Presupuesto de razonamiento | Tareas correctas y terminadas | Tiempo total | Llamadas LLM | Tokens entrada | Tokens generados |
|---|---:|---:|---:|---:|---:|
| 0 | 19/20 | 560,6 s | 153 | 428.150 | 17.221 |
| 1.024 | 18/20 | 653,9 s | 148 | 404.640 | 21.560 |

Dos semillas, diez tareas por semilla, mismo código/fixtures/workspace. Con pensamiento
se observó **16,6 % más tiempo** y 3,3 % menos llamadas; **no mejoró la calidad**
en esa muestra. Falló una omisión cross-file y una reparación TypeScript; sin
pensamiento falló descubrimiento. Los oráculos detectan requisitos omitidos aunque
los tests públicos pasen y el agente cierre. Los **4.096 tokens activos** responden
a la preferencia del usuario; no cuentan con una nueva matriz de calidad y no se
presentan como una mejora demostrada.

[final-comparison.json](final-comparison.json) distingue esa comparación histórica
de la comprobación actual. [measurements.json](measurements.json) y
[coding.csv](coding.csv) conservan los resultados agregados. Las trazas de evaluación
guardan contadores de razonamiento, no su texto; el historial de la UI es independiente.

El scoring v4 exige patch correcto, turno completo y DONE del host. Una corrida
parcial de `engine-quality-thinking.json` fue puntuada erróneamente 12/12 por un
scorer anterior: se excluye de recomendaciones y se conserva como evidencia.
Los primeros informes visuales incluyen los fallos corregidos del modo Consulta.

## Motor y herramientas

CUDA 12.9.1, nvcc y Nsight Systems/Compute están instalados y usados. El build
Release sm89 del mismo commit redujo la DLL CUDA de 563 a 60 MB, sin demostrar una
mejora suficiente de velocidad: continúa el binario original. Decode medido alrededor
de 42 tokens/s; la mejora principal viene del harness y del contexto selectivo.

Nsight sitúa los matvec cuantizados en aproximadamente 84,7 % del tiempo GPU;
el kernel muestreado muestra presión DRAM. CUDA Graphs ya se reutilizan, con una
comparación 41,90 frente a 38,20 tokens/s sin graphs. No se identificó una asignación
CUDA nueva por token ni una sincronización eliminable con seguridad. No hay patches
low-level ni kernels personalizados: clasificación **UPSTREAM CONFIGURATION / LOCAL TUNING**.

Se ejecutaron **82/82 MUL_MAT** contra CPU y, en esta fase, **18/18 casos ADD/MUL
F32 por cada runtime** con NaN/Inf, anchos impares y batches diferentes. No equivalen
a validar todos los kernels. N-gram speculative y sampling GPU se probaron y no se
adoptaron por sus resultados. La [fase 2](../coder-phase2/RESUMEN.md) conserva las
matrices de KV, perfiles y contadores de Nsight.

## Lo pendiente de los dos prompts

La auditoría por requisito y prioridad está en
[PENDIENTES-PROMPTS.md](PENDIENTES-PROMPTS.md). Quedan principalmente validación en
repos reales/monorepos, ablaciones amplias y comparaciones adicionales de runtime
y cuantización. No se ejecutaron más matrices repetitivas al cierre.

Para regenerar solo resúmenes, sin inferencia:

```powershell
node reports/coder-phase3/summarize.mjs
node reports/coder-phase3/verify-final.mjs
node reports/coder-phase3/complete-report.mjs
```

`summarize` y `complete-report` requieren las trazas originales locales ignoradas
por Git. Los JSON compactos quedan versionados; los modelos, binarios, sesiones,
workspace, instalaciones y capturas personales no se publican.
