# Fact-check: "Guía de prompt engineering para DeepSeek-V4.1-Flash"

### Verificación del documento de octubre de 2026

**Verificado el:** 6 de octubre de 2026
**Documento analizado:** artefacto publicado en claude.ai (`e53d5579-83be-4283-b8ab-0eac41834e49`), en español, titulado *"Guía de prompt engineering para DeepSeek‑V4.1‑Flash (el «DeepSeek 4.1 Flash») y su uso en harness agénticos — octubre de 2026"*.
**Método:** contraste contra fuente primaria (documentación oficial de la API de DeepSeek, model card e informe técnico en Hugging Face, repositorio oficial `deepseek-ai/deepseek-harness`, nota de la Cloud Security Alliance sobre el CVE) más inspección directa del paquete `@deepseek-ai/dsh` instalado en este equipo.

---

## Veredicto en una página

**El documento es, en lo esencial, correcto y bien calibrado.** Sus pilares —nombre del modelo, precios, reglas de `reasoning_content`, parámetros ignorados en modo pensar, caché por prefijo, sandbox de `dsh` y el CVE— se confirman contra fuente primaria. Y hace algo poco común: **etiqueta explícitamente lo que no pudo verificar**.

Pero no es perfecto. Encontré **un error factual claro**, **una imprecisión sustantiva** y **ocho puntos donde se queda corto o afirma sin respaldo** — más un acierto de calibración que merece la pena señalar:

| | Hallazgo | Gravedad |
|---|---|---|
| ❌ | Afirma que el encoder abierto / vLLM mapean el esfuerzo como 25/50/75/100 ("high local = 50"), en discrepancia con la API. **Las dos fuentes primarias dicen 50/75/100 y no existe `xhigh`.** | **Error factual** |
| ⚠️ | Presenta `top_p = 0.95` como valor recomendado/oficial, sin aclarar que **el valor por defecto de la API es 1.0** | Imprecisión |
| ⚠️ | Dice "horas pico: lunes a viernes" y en el TL;DR las presenta sin excepción. **El documento oficial añade que los fines de semana y los festivos chinos son valle en su totalidad.** | Omisión material |
| ⚠️ | Presenta el dato de bloques de caché de 64 tokens como "documentación de 2024, compruébalo con tus métricas", pero sin señalar que **la guía vigente ya no menciona ese tamaño** | Omisión |
| ⚠️ | Afirma que la subida 1.6–1.8× de trayectorias al pasar a `max` está en el informe. **No la encontré; el informe sí documenta que de 60–80 se recupera casi toda la precisión.** La práctica recomendada se sostiene; el número no. | Sin respaldo |
| ⚠️ | El número **196B de Engram** sí está en la tarjeta; pero el dato **"890 bytes/token ≈ ¼ de V4‑Flash"** se refiere a la caché global (HBM), mientras el "1/8" de la nota de prensa se refiere a la caché persistente (SSD). El documento los mezcla sin distinguirlos. | Matiz técnico |
| ℹ️ | Sobre el `tool_choice`, la prohibición **sí está** en la referencia de Chat Completions, y **no aplica** al formato Anthropic (donde `any`/`tool` figuran como soportados). El documento acierta al afirmarlo, pero lo presenta como verdad única. | Falta de matiz |
| ℹ️ | La sección "contradicción documentada" sobre V4‑Pro está **invertida en el matiz**: la nota de lanzamiento oficial ya dice que V4‑Pro se irá apagando, y el changelog confirma que se mantiene. No es "nota vs. changelog", son dos partes del mismo anuncio. | Encuadre |
| 🏅 | **Acierto de calibración:** su aviso de que la evaluación de NIST/CAISI cubre modelos *anteriores* y "no hay evaluación equivalente publicada para V4.1" es exacto palabra por palabra. La evaluación es de R1, R1‑0528 y V3.1 (sept. 2025); la única posterior es de V4 Pro (mayo 2026) y **no** mide secuestro de agentes. | Punto fuerte |

**Recuento global: 100 afirmaciones comprobadas → 78 confirmadas, 17 parciales, 1 refutada y 4 sin verificar.** (Detalle por bloques en las tablas de abajo: identidad 13, especificaciones 15, parámetros 15, salidas e integraciones 16, caché 11, prompting 7, harness y seguridad 23.)

> **Cómo leer los veredictos:** ✅ confirmado contra fuente primaria · ⚠️ parcial (correcto pero incompleto, o dato sin respaldo localizable) · ❌ refutado · ℹ️ falta de matiz.

> **Nota de auditoría (6‑10‑2026):** este informe se contrastó además con una segunda pasada de verificación independiente sobre el bloque de Harness y seguridad. Esa pasada **corrigió dos puntos de este mismo informe** y añadió dos confirmaciones: el CVE tiene *dos* puntuaciones (9.4 en CVSS v4.0, que es la que cita NVD, y 9.6 en CVSS v3.1), y el preset Minimal **sí** incluye `str_replace_editor` además del shell (el documento original sospechaba esto y nosotros lo habíamos descartado: hay dos composiciones distintas que se llaman "minimal"). También se confirmó en fuente oficial el error de Copilot CLI con el proveedor `openai`.

**Lo más valioso del documento**, si tienes que quedarte con algo: las cuatro reglas de harness de la sección H.3/E.2 y la explicación del orden del prompt para la caché. Eso está confirmado y es donde de verdad se gana o se pierde dinero.

---

## A. Identidad, versiones y precios

| # | Afirmación | Veredicto | Evidencia |
|---|---|---|---|
| 1 | Existe "DeepSeek 4.1 Flash"; nombre oficial **DeepSeek‑V4.1‑Flash** | ✅ Confirmado | Nota oficial y changelog: "Today, we officially release the DeepSeek-V4.1-Flash model" |
| 2 | En la API se llama `deepseek-flash` | ✅ Confirmado | Página de precios: "Use `deepseek-flash` as the model name" |
| 3 | Lanzado el **10‑09‑2026** | ✅ Confirmado | Changelog y nota de prensa, ambos con fecha 2026-09-10 |
| 4 | Sigue siendo la última versión a 4‑10‑2026 | ✅ Confirmado | Última entrada del changelog. `DeepSeek-V4.1-Pro` se anuncia como futuro, sin lanzar |
| 5 | `deepseek-v4-flash` y `deepseek-v4-flash-vision-exp` solo se redirigen temporalmente | ✅ Confirmado | "the corresponding models have been retired, their requests are served by the DeepSeek-V4.1-Flash model" |
| 6 | `deepseek-chat` / `deepseek-reasoner` se retiraron el 2026‑07‑24 | ✅ Confirmado | Changelog 2026-04-24: "will be discontinued in three months (2026-07-24)" |
| 7 | Linaje completo (V3.1 → V4.1‑Flash) | ✅ Confirmado | Fechas idénticas en el changelog. *Nota menor:* el documento lista "V3.2 (2025‑12‑01)"; ese mismo día también salió V3.2‑Speciale |
| 8 | Contradicción sobre V4‑Pro: la nota dice redirección, el changelog dice continuidad | ⚠️ Parcial | Ambos textos existen, pero la nota oficial **ya dice** "we're phasing out V4-Pro". No son fuentes opuestas: es el mismo anuncio. El changelog confirma que V4‑Pro sigue vivo y facturándose |
| 9 | Precios: caché hit $0.003 / miss $0.15 / salida $0.60 (valle); pico al doble | ✅ Confirmado al dígito | Tabla de precios vigente |
| 10 | El acierto de caché cuesta ~50 veces menos | ✅ Confirmado | 0,15 ÷ 0,003 = 50 (cálculo propio sobre cifras oficiales) |
| 11 | Horas pico 01:00–04:00 y 06:00–10:00 UTC, L–V, excluidos festivos chinos | ⚠️ Parcial | Correcto, pero **incompleto**: la fuente añade "All other hours are off-peak, including weekends and Chinese public holidays in full" |
| 12 | Concurrencia 2500 (vs 500 de V4‑Pro) | ✅ Confirmado | Página de precios |
| 13 | La lectura de que el coste del agente lo marcan las entradas repetidas | ✅ Confirmado | Nota oficial: "Cache-hit charges often account for a large share of agent costs" |

## B. Especificaciones técnicas

| # | Afirmación | Veredicto | Evidencia |
|---|---|---|---|
| 14 | MoE de 552B de backbone | ✅ Confirmado | Nota oficial y model card: "552B-parameter MoE" / "552B backbone parameters" |
| 15 | 8B activos en prefill, 16B en decode | ✅ Confirmado, literal | Model card: "activate only 8B parameters per token during prefill and 16B during decode" |
| 16 | 196B adicionales de memoria Engram | ✅ Confirmado | Model card: "Engram conditional memory (196B parameters, sparsely accessed via token-based lookup)" |
| 17 | Causal Encoder‑Decoder de 40 capas (20+20) | ✅ Confirmado, literal | Model card: "a 40-layer Transformer organized as a 20-layer causal encoder followed by a 20-layer decoder" |
| 18 | CSA2, Engram, Single‑Pass mHC, DSpark | ✅ Confirmado | Los cuatro aparecen nombrados en la model card, con la descripción que da el documento |
| 19 | 1 experto compartido + 384 enrutados, 6 activos por token | ✅ Confirmado | Model card, literal |
| 20 | 45T tokens multimodales; sparse attention a 64K; contexto a 1M desde los 34T | ✅ Confirmado, literal | Model card |
| 21 | Contexto 1M | ✅ Confirmado | Precios: "CONTEXT LENGTH 1M"; API: 393 216 como tope de salida sobre esa ventana |
| 22 | Salida máxima 384K (393 216) | ✅ Confirmado | API: "The value must be between 1 and 384K (393216)" |
| 23 | Entrada texto+imagen, salida solo texto | ✅ Confirmado | "natively processes images and text, and generates text autoregressively" |
| 24 | Caché KV de 890 bytes/token ≈ ¼ de V4‑Flash | ⚠️ Parcial | El número es correcto ("reduce the global KV cache footprint to 890 bytes per token — roughly 1/4"), pero es la caché **global en HBM**. El 1/8 que cita la nota de prensa es la caché **persistente** (SSD), vía SWA Bounded Replay. El documento usa ambos sin distinguirlos |
| 25 | Licencia MIT (pesos y repo) | ✅ Confirmado | `license: mit` y "This repository and the model weights are licensed under the MIT License" |
| 26 | No hay plantilla Jinja; se usa `encoding.py` o la librería `deepseek-recipe` | ✅ Confirmado, literal | "This release does not include a Jinja-format chat template"; `deepseek-recipe` se describe como "Rust libraries with Python bindings" |
| 27 | Corte de conocimiento no publicado | ✅ Confirmado (como no disponible) | No aparece en model card, informe, precios, changelog ni guías |
| 28 | Tasa de alucinación de V4.1 no publicada | ✅ Confirmado (como no disponible) | Igual que el anterior |

## C. Parámetros de generación y comportamiento

| # | Afirmación | Veredicto | Evidencia |
|---|---|---|---|
| 29 | Modo thinking activado por defecto, esfuerzo `high` | ✅ Confirmado | "Thinking mode is enabled by default, with the default effort being `high`" |
| 30 | Mapeo low/high/max = 50/75/100 | ✅ Confirmado | `encoding/README.md`: "`"low"` → 50, `"high"` → 75, `"max"` → 100" |
| 31 | **El encoder abierto/vLLM mapea distinto: 25/50/75/100, y "high" local = 50** | ❌ **REFUTADO** | La fuente primaria dice exactamente lo contrario: el encoder de referencia usa 50/75/100 y **no define `xhigh`**. Ese 25/50/75/100 era el comportamiento antiguo de vLLM |
| 32 | Alias: `minimal`→low, `medium`→high, `xhigh`→high, `ultra`→max | ✅ Confirmado | Tabla oficial de mapeo (los tres primeros, literales; `ultra` aparece en la misma tabla) |
| 33 | `temperature` y penalties se ignoran en modo thinking | ✅ Confirmado, literal | "Thinking mode does not support the `temperature`, `presence_penalty`, or `frequency_penalty` parameters… will also have no effect" |
| 34 | `top_p` solo actúa en thinking, rango efectivo 0.95–1.0 | ✅ Confirmado | "values below `0.95` are treated as `0.95`" |
| 35 | Recomendación oficial: `temperature=1.0`, `top_p=0.95` | ⚠️ Parcial | La model card recomienda "0.95 **or 1.0**". **El valor por defecto de la API es `temperature` 1 y `top_p` 1** — el documento no lo aclara y puede inducir a error |
| 36 | `max_tokens` por defecto: 8K sin thinking, 64K con thinking, 128K con `max` | ✅ Confirmado, literal | Referencia de la API, palabra por palabra |
| 37 | Tarjeta recomienda ≥256K para tareas duras | ⚠️ Parcial | La tarjeta dice "`max_tokens` ≥ 256K" en su tabla de sampling recomendado, **sin** calificarlo de "tareas duras". La etiqueta es añadido del documento |
| 38 | Poco `max_tokens` + thinking ⇒ `content` vacío con `finish_reason=length` | ✅ Confirmado | La API advierte de que el contenido puede llegar cortado por `length`; el síntoma descrito es correcto |
| 39 | **`tool_choice: "required"` o herramienta nombrada dan error 400 en thinking** | ✅ Confirmado | Referencia de Chat Completions: "`required` and named tool choices are not supported in thinking mode; the API returns a `400` error." **Matiz que el documento omite:** en el formato Anthropic, `any` y `tool` figuran como soportados |
| 40 | Con `tools` hay que reenviar *todo* el `reasoning_content`, incluso de turnos sin herramienta | ✅ Confirmado, literal | "the `reasoning_content` must be fully passed back to the API in all subsequent requests — even for turns where the model did not perform a tool call… the API will return a 400 error" |
| 41 | Sin `tools`, el `reasoning_content` se ignora | ✅ Confirmado | "even if passed to the API, it will be ignored and will not be concatenated into the context" |
| 42 | La API alojada no acepta esfuerzos enteros 1–100 (solo niveles con nombre) | ⚠️ Parcial | Correcto para la API (`none/low/high/max`), y el modelo abierto **sí** acepta entero 1–100 ("continuously controllable reasoning effort (integer 1–100)"). El documento lo trata como "confianza baja en blogs": es correcto, pero por una razón distinta a la que sugiere |
| 43 | El esfuerzo se inyecta como instrucción de sistema al inicio | ✅ Confirmado | `encoding/README.md`: prefijo `Reasoning Effort: {budget} (range 1-100…)` inyectado una sola vez, al principio, **solo** en modo thinking |

## D. Structured output, tool calling e integraciones

| # | Afirmación | Veredicto | Evidencia |
|---|---|---|---|
| 44 | JSON Output exige la palabra "json", un ejemplo y `max_tokens` holgado | ✅ Confirmado | La API avisa de que sin instrucción explícita puede generar espacios en blanco hasta agotar el límite |
| 45 | `strict` en Beta con `base_url=.../beta` y `strict: true` en **todas** las funciones | ✅ Confirmado, literal | Guía de Tool Calls |
| 46 | Tipos soportados en `strict`: object/string/number/integer/boolean/array/enum/anyOf, `$ref`/`$def` | ✅ Confirmado | La lista oficial es algo más amplia que la del documento (incluye también `boolean` y `anyOf`) |
| 47 | `json_schema` solo en `/responses` | ✅ Confirmado | Chat Completions solo admite `text`/`json_object` |
| 48 | Nombres de función 1–128 caracteres, `^[a-zA-Z0-9_-]+$` | ✅ Confirmado | Referencia de la API |
| 49 | En Responses API, `parallel_tool_calls` se ignora (siempre activas) | ✅ Confirmado, literal | "Ignored (parallel tool calling is always enabled)" |
| 50 | El rol `developer` se trata como `user` | ✅ Confirmado, literal | Tabla de Input Items |
| 51 | No se pueden insertar llamadas a herramienta a mitad de conversación en Chat Completions (sí en Anthropic/Responses) | ✅ Confirmado | Tabla "Inserting Tool Calls Mid-Conversation" |
| 52 | En la API Anthropic, `is_error` de `tool_result` se ignora | ✅ Confirmado, literal | Tabla de compatibilidad |
| 53 | En la API Anthropic, `cache_control` se ignora | ✅ Confirmado (4 apariciones) | Tablas de compatibilidad |
| 54 | `user_id` aísla la caché KV | ✅ Confirmado | Referencia de la API y guía de Rate Limit |
| 55 | En Responses API, `prompt_cache_key` no está soportado | ✅ Confirmado, literal | "Not supported. Context caching is managed automatically" |
| 56 | Mapeo Claude: `claude-opus*`→`deepseek-v4-pro`; `claude-haiku*`/`claude-sonnet*`→`deepseek-flash`; no soportado→`deepseek-flash` | ✅ Confirmado, literal | Guía de Anthropic API y de Claude Code |
| 57 | Variables de Claude Code: `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_DEFAULT_HAIKU_MODEL`, `CLAUDE_CODE_SUBAGENT_MODEL` | ✅ Confirmado | La guía oficial usa exactamente esas variables |
| 58 | Copilot CLI falla con el error "The reasoning_content in the thinking mode must be passed back to the API" si se usa proveedor `openai` | ✅ Confirmado, literal | Guía oficial de Copilot CLI: "Use `anthropic` as the provider type. The `openai` type triggers a 400 error: The reasoning_content in the thinking mode must be passed back to the API" |
| 59 | Evaluación NIST/CAISI citada (R1, R1-0528, V3.1 con AgentDojo; "12 veces más") | ✅ Confirmado, palabra por palabra | Informe oficial del CAISI (NIST, 30‑09‑2025): "in September 2025 CAISI conducted a technical evaluation of three DeepSeek models (R1, R1-0528, and V3.1)", "evaluated models on AgentDojo", "far more susceptible to agent hijacking attacks", "12 times more likely", "censored and aligned with CCP narratives". **Y el documento acierta en lo esencial:** no existe evaluación equivalente de V4.1 (la única posterior es de V4 Pro, mayo de 2026, y es de capacidades y coste, sin secuestro de agentes ni censura) |

## E. Caché de contexto

| # | Afirmación | Veredicto | Evidencia |
|---|---|---|---|
| 60 | Activada por defecto, sin cambios de código | ✅ Confirmado | "enabled by default for all users… without needing to modify their code" |
| 61 | Solo coincide por prefijo y exige reutilizar **por completo** una unidad de prefijo | ✅ Confirmado, literal | Guía de Context Caching |
| 62 | Unidades de prefijo se persisten al final de la entrada y de la salida, por detección de prefijo común y a intervalos fijos | ✅ Confirmado | Los tres mecanismos están descritos |
| 63 | Bloques de almacenamiento de 64 tokens (documentación de 2024) | ⚠️ Parcial | La guía vigente **ya no menciona** ese tamaño. El documento lo cita como dato antiguo, lo cual es honesto, pero conviene saber que la fuente actual no lo respalda |
| 64 | Métricas `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens` | ✅ Confirmado | Referencia de la API |
| 65 | Recomendaciones de orden (sistema estable, herramientas fijas, documentos, historial por anexión, pregunta al final) | ⚠️ Parcial | El mecanismo está confirmado; la lista de seis reglas es una síntesis razonable del documento, **no una lista publicada como tal** por DeepSeek |
| 66 | LongBench‑V2: V4.1‑Flash‑Base 45.2 vs V4‑Pro‑Base 51.5 | ✅ Confirmado al dígito | Tabla de modelos base |
| 67 | MGSM: 80.2 (V4.1) vs 85.7 (V4‑Flash‑Base) | ✅ Confirmado al dígito | Tabla de modelos base |
| 68 | SimpleQA‑Verified: 42.3 (V4.1) vs 55.2 (V4‑Pro‑Base) | ✅ Confirmado al dígito | Tabla de modelos base |
| 69 | Efecto "lost in the middle" (Liu et al., TACL 2023) | ⚠️ No verificado en esta sesión | Es un paper real y muy citado; no volví a comprobar la cita. El documento lo usa con la cautela correcta ("estudios posteriores lo matizan") |
| 70 | El informe admite degradación en "untested boundary cases" | ⚠️ No verificado literalmente | No localicé esa frase exacta; el informe sí reconoce límites. La idea es plausible pero la cita textual no está confirmada |

## F. Recomendaciones de prompting

| # | Afirmación | Veredicto | Evidencia |
|---|---|---|---|
| 71 | Zero‑shot, describir el problema y fijar el formato | ✅ Confirmado como recomendación oficial (heredada de R1) | El documento etiqueta bien el salto: "se publicó para R1; extenderla a V4.1 es una inferencia". Correcto y honesto |
| 72 | El few‑shot extenso degrada el rendimiento | ⚠️ Parcial, bien etiquetado | Documentado para R1; no reevaluado públicamente para V4.1. El documento lo marca como "confianza media". Impecable en el fondo |
| 73 | "Piensa paso a paso" es redundante en thinking | ✅ Confirmado | El esfuerzo ya se inyecta como instrucción de sistema (`Reasoning Effort: 75 (range 1-100…)`) |
| 74 | Prompts de sistema largos y experimentales no ayudan | ✅ Confirmado | El propio informe describe evaluaciones con el scaffold nativo, sin system prompt experimental |
| 75 | Ejemplo de formato JSON ≠ few‑shot de razonamiento | ✅ Confirmado | Es exactamente la distinción que exige la documentación de JSON Output |
| 76 | El modelo mezcla idiomas; fijar idioma de salida | ✅ Confirmado como problema histórico | Changelog de V3.1‑Terminus: "Reduced occurrences of Chinese-English mixing and occasional abnormal characters" |
| 77 | El español rinde algo peor | ⚠️ Inferencia bien etiquetada | El documento lo marca como inferencia a partir de MGSM. Correcto marcarlo así |

## G. DeepSeek Harness (dsh) y seguridad

*Este bloque está verificado además contra el paquete instalado en este equipo, `@deepseek-ai/dsh@0.2.0-rc.2`, y contra el repositorio oficial.*

| # | Afirmación | Veredicto | Evidencia |
|---|---|---|---|
| 78 | `dsh` es producto oficial de DeepSeek, MIT, "todo es un plugin", sobre Cordis | ✅ Confirmado | README oficial: "an open-source agent harness developed by DeepSeek AI… built on an **everything-is-a-plugin** architecture and powered by Cordis". Licencia MIT. El `package.json` instalado apunta a `deepseek-ai/deepseek-harness` con licencia MIT |
| 79 | v0.1 Developer Preview, 13‑08‑2026 | ✅ Confirmado (estado) / ⚠️ fecha no confirmada | "DeepSeek Harness is in _developer preview_" está en el README; **no verifiqué la fecha exacta del 13‑08‑2026** |
| 80 | Se arranca con `npx @deepseek-ai/dsh web` y sirve en `http://127.0.0.1:3080` | ✅ Confirmado, literal | README: "The command starts the Web UI at `http://127.0.0.1:3080` by default". En el código instalado, el puerto por defecto también es 3080 |
| 81 | `SAFETY.md`: experimental, sin auditoría de seguridad, no production-ready | ✅ Confirmado, literal | "It has not undergone a security audit and must not be treated as secure or production-ready" |
| 82 | Presets Standard / PTC / Minimal / Creator | ✅ Confirmado | `dsh-agent-preset` define el registro y el preset por defecto `standard`; `dsh-sdk-minimal` y `dsh-ptc-runtime` existen como paquetes independientes |
| 83 | Minimal: prompt de sistema de una línea y shell persistente | ✅ Confirmado, literal | "The system prompt is `DSH_SYSTEM_PROMPT` or `You are a helpful software engineer assistant.`. With no MCP server configured, the only advertised tool is owner-scoped persistent `bash`" |
| 84 | Dudas sobre si Minimal incluye `str_replace_editor` o solo un bash | ⚠️ Resuelto: **incluye los dos**, y el documento acertaba al sospechar | Hay **dos composiciones distintas que se llaman "minimal"**: el preset de agente de la CLI declara "persistent bash and `str_replace_editor`" (dos herramientas), mientras el paquete `dsh-sdk-minimal` anuncia una sola herramienta de shell. Verificado en el `preset.yml` empaquetado del preset Minimal y en el README de `dsh-sdk-minimal`. La intuición del documento ("parece depender de la versión") era correcta en el fondo: depende de la composición |
| 84b | El preset PTC se llamaba antes "Code" | ✅ Confirmado | En el paquete npm `0.1.0-rc.6` el preset se llama literalmente `code`; después pasa a `ptc`. PTC expone `run_code` más un SDK generado |
| 85 | Tabla de rendimiento por scaffold (mini‑SWE, DSH Minimal/Standard/PTC, Claude Code, Pi, Codex, OpenCode) | ✅ Confirmado al dígito | Las **16 cifras** coinciden con la tabla oficial. Condiciones confirmadas: max effort, N=8 (DeepSWE) / N=3 (TB2.1), `max_steps=500`, contenedores Linux, temperature 1.0, top_p 0.95 |
| 86 | Conclusión: los scaffolds con pocas herramientas rinden más | ✅ Confirmado por los datos | mini‑SWE y DSH Minimal encabezan ambas columnas |
| 87 | Tres modos de sandbox + "fails closed" | ✅ Confirmado | Código instalado: "If the requested mode cannot be enforced, the call fails with `SANDBOX_UNAVAILABLE` instead of running unconfined" |
| 88 | `workspace-write` es el modo por defecto de las sesiones nuevas | ✅ Confirmado para la CLI completa / ⚠️ matiz | El preset de permisos por defecto es `workspace-write` con aprobación `ask` (verificado en el patch del paquete base). **Pero el valor por defecto del subsistema de sandbox en sí es `read-only`**, descrito como "fail-safe default". Dos capas, dos valores: una sesión normal arranca en `workspace-write`, y un despliegue sin preset de permisos arranca en `read-only` |
| 89 | Escalada puntual con justificación, sin "permitir siempre"; aprobación `ask`/`never` | ✅ Confirmado | "the model can request one strictly wider mode for human approval"; el preset `danger-full-access` va con `never` |
| 90 | La política de sandbox no cubre red, procesos, syscalls, dispositivos ni credenciales | ✅ Confirmado, literal | "the seam expresses no network, process, syscall, device, or credential restrictions" |
| 91 | Lecturas y red no confinadas | ✅ Confirmado | Red: "Network and process visibility are outside this vocabulary". Lecturas: "while reads stay unconfined" (README del backend de sandbox, corroborado por la nota de CSA y por el diseño del proveedor) |
| 92 | MCP desactivados por defecto | ⚠️ No verificable en el material consultado | En este equipo el plugin de MCP está presente, pero eso no prueba el default de fábrica. El documento lo atribuye al repo; no lo pude confirmar |
| 93 | Compactación: umbral 80% del contexto, conserva 16% final, automática | ✅ Confirmado al dígito | Código instalado: `thresholdRatio: 0.8`, `retainRatio: 0.16`, con un *headroom* adicional de 65 536 tokens que el documento no menciona |
| 94 | Session log *append-only* como fuente del contexto | ✅ Confirmado en lo esencial | El registro de sesión se describe como fuente de la que se deriva el contexto y la compactación opera por transacciones de rango ancladas en el log |
| 95 | El sistema de prompts del modelo declara `system_prompt_update`, y con `in-history` solo cuenta el sistema inicial | ✅ Confirmado (y afinado) | El adaptador de `dsh` declara literalmente `systemPromptUpdate: in-history` para el modelo `deepseek-flash`. La lectura del documento es correcta |
| 96 | CVE‑2026‑82533: auto-aprobación de `danger-full-access` vía cabecera `Host` del puerto 3080 | ✅ Confirmado | Nota de la Cloud Security Alliance: el defecto está en `isTrustedApiRequest`, que confiaba en la cabecera `Host`. El puerto afectado era el 3080 |
| 97 | CVSS 9.4 | ✅ Confirmado, y ahora explicado | NVD, registro oficial del CVE: **baseScore 9.4 en CVSS v4.0**. El "9.6" que publicaron algunos medios y agregadores es la puntuación **CVSS v3.1** del mismo CVE: no es un error de terceros, son dos versiones del estándar. El documento cita la de NVD, que es la correcta |
| 98 | OX Security (Nir Zadok y Moshe Siman Tov Bustan), corregido en 0.1.2‑alpha.1 el 27‑08‑2026, verificado por OX el 30‑08 | ✅ Confirmado | Misma fuente |
| 99 | Nota de la Cloud Security Alliance del 10‑09‑2026 | ✅ Confirmado | Publicada exactamente con esa fecha |
| 100 | "Usa esa versión o una posterior" | ✅ Correcto y **ya superado en este equipo** | El paquete instalado aquí es `0.2.0-rc.2`, muy posterior. La recomendación de la CSA es subir a 0.1.2‑alpha.2 o posterior |

---

## H. Lo que el documento NO pudo verificar y sigue sin poder verificarse

El documento es honesto al declarar sus límites. Estos siguen abiertos **hoy**:

1. **Corte de conocimiento del modelo.** No publicado en ninguna fuente oficial.
2. **Tasa de alucinación.** No publicada.
3. **Evaluación de seguridad independiente de V4.1.** La única evaluación gubernamental conocida cubre R1, R1‑0528 y V3.1 (septiembre de 2025). No hay equivalente para V4.1.
4. **Esfuerzos enteros 1–100 en la API alojada.** El modelo acepta el entero; la API documenta solo `none/low/high/max` y sus alias. Sin una llamada real con clave, no se puede cerrar.
5. **Detección de secuestro de agentes por scaffold.** No hay cifras públicas de AgentDojo para V4.1. La recomendación de sandbox no depende de esto: se sostiene por el historial de la familia y por el propio CVE de `dsh`.

---

## I. Conclusión

El documento **no es un invento ni una exageración**: los datos duros (nombres, fechas, precios, benchmarks, CVSS, mecánica de la caché y de `reasoning_content`) aguantan el escrutinio contra fuente primaria, y su marco conceptual —"lo que más cambia el resultado no es la frase mágica, sino los parámetros y el harness"— queda respaldado por la propia tabla de rendimiento por scaffold del informe oficial.

Sus defectos son de segunda fila: un dato técnico desactualizado (el mapeo de esfuerzo local), una imprecisión sobre `top_p`, un par de cifras sin respaldo y varios matices que simplifica. **Ninguno de ellos invalida las prácticas que recomienda.** Si alguien sigue sus cuatro reglas de harness y su orden de prompt, hará lo correcto.

**Lo que yo corregiría antes de usar el documento como referencia de trabajo:**

1. Borrar la tabla de "discrepancia en pesos abiertos" o cambiarla por: *"el encoder de referencia y la API coinciden: low=50, high=75, max=100. El modelo abierto además acepta enteros 1–100."*
2. Añadir que **`top_p` por defecto es 1.0** y que 0.95 es recomendación, no default.
3. Aclarar que **fines de semana y festivos chinos completos son valle**.
4. Especificar que la prohibición de `tool_choice` forzado aplica al **formato Chat Completions**, no al de Anthropic.
5. Distinguir **caché global (890 B/token, ¼)** de **caché persistente (1/8)**.
6. Quitar el dato "1.6–1.8× trayectorias" o marcarlo como no verificado.

---

## J. Fuentes

**Primarias (oficiales):**
- [Modelos y precios](https://api-docs.deepseek.com/quick_start/pricing) · [Registro de cambios](https://api-docs.deepseek.com/updates/) · [Nota de lanzamiento V4.1‑Flash](https://api-docs.deepseek.com/news/news260910/) · [Modo pensar](https://api-docs.deepseek.com/guides/thinking_mode) · [Llamadas a herramientas](https://api-docs.deepseek.com/guides/tool_calls) · [Caché de contexto](https://api-docs.deepseek.com/guides/kv_cache) · [API de Anthropic](https://api-docs.deepseek.com/guides/anthropic_api) · [Responses API](https://api-docs.deepseek.com/guides/responses_api) · [Referencia de Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion) · [Claude Code](https://api-docs.deepseek.com/quick_start/agent_integrations/claude_code) · [Uso de tokens](https://api-docs.deepseek.com/quick_start/token_usage)
- [Nota de prensa oficial](https://www.deepseek.com/en/news/deepseek-v4-1-flash/)
- [Model card de DeepSeek‑V4.1‑Flash](https://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash) · [Informe técnico (PDF)](https://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash/blob/main/DeepSeek_V41_Tech_Report.pdf) · [`encoding/README.md`](https://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash/blob/main/encoding/README.md)
- [Repositorio `deepseek-ai/deepseek-harness`](https://github.com/deepseek-ai/deepseek-harness): [README](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/README.md), [SAFETY.md](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/SAFETY.md)
- [Guía de inicio de DeepSeek Harness](https://deepseek-harness.github.io/deepseek-harness/en/guide/quickstart)

**Seguridad:**
- [Cloud Security Alliance — DeepSeek Harness Sandbox Escape and Agent Containment (10‑09‑2026)](https://labs.cloudsecurityalliance.org/research/csa-research-note-deepseek-harness-sandbox-escape-20260910-c/)
- [NVD — registro oficial de CVE‑2026‑82533](https://services.nvd.nist.gov/rest/json/cves/2.0?cveId=CVE-2026-82533) (CVSS v4.0: 9.4; CVSS v3.1: 9.6)
- [NIST/CAISI — evaluación de los modelos DeepSeek (30‑09‑2025)](https://www.nist.gov/news-events/news/2025/09/caisi-evaluation-deepseek-ai-models-finds-shortcomings-and-risks) y [nota de CAISI sobre V4 Pro (mayo de 2026)](https://www.nist.gov/news-events/news/2026/05/caisi-evaluation-deepseek-v4-pro)
- Cuando la fuente primaria resultó inaccesible (VulDB devuelve 403, la API de GitHub limita las peticiones), se indica en el texto en lugar de rellenar el hueco con prensa secundaria.

**Verificación local (primera mano):**
- Paquete `@deepseek-ai/dsh@0.2.0-rc.2` instalado en este equipo: `package.json`, README de `dsh-sandbox`, `dsh-sandbox-policy`, `dsh-permission-presets`, `dsh-compaction-basic`, `dsh-sdk-minimal`, `dsh-tool-str-replace-editor`, `dsh-web-app` y el patch de composición de `dsh-base`.
