# Integración del modelo · 2026-10-04

El proyecto arrancaba con `BoldingBuilds/Ternary-Bonsai-2-27B-Abliterated-PTQ1_0-GGUF` (la "v1").
Esta sesión añade un segundo modelo **mejor medido** y deja el anterior como respaldo, sin tocar la
matemática de VRAM.

## Cuál se añadió y por qué

**`Override-6/Ternary-Bonsai-2-27B-abliterated-gguf`** (PTQ1_0, 5.946.648.928 bytes).

Es la mejora más sólida **dentro del mismo formato que cabe en 8 GB**. La comparación la publica el
propio autor del modelo anterior en el mismo arnés (104 prompts dañinos, mismo juez):

| | BoldingBuilds v1 (antes) | **Override-6 (ahora)** |
|---|---:|---:|
| Sin thinking: cumplen / deflectan / rechazan | 47 / 57 / 0 | **74 / 30 / 0** |
| Con thinking: cumplen / deflectan / **vacíos** | 56 / 29 / **19** | **76 / 27 / 0** |
| MMLU (n=1000) | 79,5 | 79,0 (stock 78,9) |
| GSM8K | 92 | **94 = stock** |
| IFEval estricto | — | **81,7 vs 78,4 stock** |
| NIAH 8k–64k | — | **100 %** |
| KL chat / wiki | 0,055 / 0,050 | **0,019 / 0,013** |

Lo que arregla: **el defecto que más molestaba del modelo anterior**. Con thinking activado y 4.096
tokens, la v1 dejaba **19 de 104 respuestas vacías** (redactaba la respuesta dentro del razonamiento
y no la cerraba); Override-6 **no deja ninguna**. Además pierde menos capacidad y deflexiona menos.

Lo que NO arregla, y hay que decirlo: **~26-30 % de los prompts dañinos reciben una respuesta
edulcorada** en vez de operativa (cero rechazo explícito ≠ cumplimiento real), y su tarjeta **no
re-evaluó tool calling ni visión**. Por eso el modelo se probó con el evaluador del proyecto antes
de darlo por bueno (ver más abajo).

Se descartaron, con datos:
- **Hikari07jp** y **dealignai CRACK**: escriben mejores respuestas, pero cuestan MMLU (−0,64 y
  −1,04 pp medidos) y **no aportan nada en thinking**.
- **OS-Software Heretic v2** (3-oct): promete el mejor equilibrio pero **no está verificado** y la v1
  de ese autor no reprodujo (decía 0/100 y se midieron 12 % de rechazos).
- **PQ2_0 (7,21 GB)**, **v2 de BoldingBuilds** y todo lo de 4 bits: **no caben** en 8 GB con contexto
  útil. Y por la tabla de PrismML, subir de bits del mismo modelo base da **+0,4 puntos de media**
  (el ternario nativo ya rinde al 98,2 % del FP16), así que tampoco compensa.

## Cómo está integrado

`chat/modelo.json` es la fuente única y ahora tiene un **catálogo**:

```
modelo.archivo = Ternary-Bonsai-2-27B-PTQ1_0-abliterated-Override6.gguf   <- el que arranca
catalogo.override6   = { rol: "predeterminado", sha256, metodo, evidencia, pega }
catalogo.bolding_v1  = { rol: "respaldo",       sha256, metodo, evidencia, pega }
```

```powershell
.\scripts\start-server.ps1                 # Override-6 (predeterminado)
.\scripts\start-server.ps1 -Modelo bolding_v1   # el de antes, sin editar nada
.\scripts\start-server.ps1 -Modelo nope    # error que lista las claves validas
```

Como los dos archivos pesan **exactamente lo mismo**, la tabla de VRAM, el contexto automático
(77.824 tokens con KV `q4_0`) y la velocidad **no cambian** al cambiar de modelo.

`start-server.ps1` ahora **verifica el tamaño antes de arrancar** y se niega si no cuadra: antes, un
archivo a medio descargar habría arrancado y generado basura sin avisar.

## Verificación hecha

| Comprobación | Resultado |
|---|---|
| Descarga íntegra | 5.946.648.928 bytes |
| SHA-256 | `0b310654…378ed` — **coincide con el publicado por Hugging Face** |
| Arranque real | carga y escucha; contexto automático 77.824 |
| Tarea del evaluador | `OK hola-py · 4,7 s · 2 saltos · 28,4 t/s · GPU 97 %` |
| Velocidad | 28,4 t/s, igual que antes (mismo tamaño) |

**Nota:** el SHA-256 del modelo anterior también se comprobó
(`94dd53cb…52900a`) y coincide con el que ancló el shootout público de 11 builds: el archivo que se
midió y el que hay en disco son el mismo.

## Evaluación completa: 19/19

Corrida completa de las 19 tareas del evaluador con este modelo:

| Corrida | Nota | Tiempo | Tokens |
|---|---:|---:|---:|
| Modelo anterior (sin arreglos) | 15/19 | 9 min 40 s | 11 974 |
| **Override-6** | 18/19 | 6 min 9 s | 7 233 |
| **Override-6 + arreglo del mensaje de sistema** | **19/19** | **5 min 13 s** | 7 441 |

Los informes están en `chat/evaluar/resultados/`. El único fallo intermedio (`solo-chat`) era
**sobre-llamada de herramientas** —un efecto conocido de la abliteración, no del modelo— y se
corrigió en el mensaje de sistema de `chat/bonsai-chat.mjs`. Detalle en
[AUDITORIA-HANDOFF.md](AUDITORIA-HANDOFF.md) §10.

## Pendiente

Nada de la integración del modelo. Las funciones de interfaz que quedaban (deshacer del agente,
reglas en el mensaje de sistema, Ctrl+K, crear/renombrar/borrar y adjuntar imágenes) están hechas y
probadas: ver [AUDITORIA-HANDOFF.md](AUDITORIA-HANDOFF.md) Parte 3. La **visión** también está
integrada con `mmproj-Q8_0` en CPU (§16 de ese documento).

