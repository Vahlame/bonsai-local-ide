# Bonsai Local IDE v1.2.0

**30 de octubre de 2026** · Windows 10/11 · inferencia 100 % local con llama.cpp

Esta versión convierte la memoria entre chats en una función de primera clase, añade un
navegador Playwright MCP aislado para el agente, permite controlar el servidor desde la
interfaz y cierra varias fugas de robustez detectadas en uso real. La suite completa se
verificó con el modelo real en una RTX 4060 Laptop de 8 GB.

## Lo más importante

### Memoria global entre chats

- Capa **separada** de la memoria de la conversación abierta; se guarda en el estado
  local, **fuera del proyecto y de Git**.
- Solo viaja al modelo lo relevante para el pedido actual (más las notas fijadas), con un
  presupuesto explícito por turno de 0 a 2.000 tokens. Sin coincidencia no se inyecta nada.
- Captura automática **conservadora**: preferencias y decisiones duraderas, nunca secretos
  ni órdenes transitorias. Todo queda visible y borrable.
- Editor en Ajustes para añadir, editar, fijar, borrar y vaciar notas, y API
  `GET/POST /api/memoria` para inspeccionarla.

### Navegador Playwright MCP aislado

El agente dispone de `mcp_playwright` para probar páginas HTTP/HTTPS: abrir, inspeccionar
el árbol accesible, pulsar, escribir, enviar teclas, esperar y consultar consola y red.
Usa un perfil efímero por turno, bloquea los puertos del IDE y del modelo y no habilita
evaluación arbitraria de código. Para HTML local sin servidor sigue disponible `navegador`.

### Control y cancelación del servidor

- La interfaz puede consultar, **detener y volver a arrancar** el servidor administrado
  sin cerrar el IDE (`GET/POST /api/servidor`).
- **Detener** ahora cancela de verdad: aborta la inferencia, las herramientas y los
  procesos del turno. Antes el servidor seguía generando y `busy` quedaba bloqueado.
- Tras una verificación correcta y sin escrituras nuevas, el agente cierra y pide el
  resumen en vez de encadenar lecturas sin fin.

### Agente y edición más robustos

- Validación de lotes con límites por herramienta, rechazo de escrituras conflictivas en
  el mismo archivo y errores que explican cómo continuar.
- Escrituras concurrentes en archivos distintos con colas por ruta, temporales
  independientes y comprobación de cambios externos antes de sustituir.
- Un archivo creado o escrito en el turno ya cuenta como inspeccionado: corregirlo no
  exige volver a leerlo.
- Escritura por partes recuperable (`estado`) y cancelable (`cancelar`).
- Diagnóstico de JavaScript inline en HTML con `node --check`.
- Lectura de registros acotada en líneas y bytes, incluso con líneas de decenas de MiB.

## Verificación

| Grupo | Resultado | Tiempo |
| --- | ---: | ---: |
| `npm test` (aisladas, sin GPU) | **40/40** | 125,3 s |
| `npm run test:navegador` (Edge/Chrome) | **5/5** | 16,4 s |
| `npm run test:gpu` (modelo real cargado) | **4/4** | 95,4 s |
| `npm run test:gpu-exclusiva` (GPU libre) | **1/1** | 89,6 s |

Configuración real: **Ornith-1.5-9B-Q4_K_M**, 43.008 tokens, KV F16, visión y
pensamiento hasta 4.096. `/props` confirmó `n_ctx: 43008`, `vision: true` y el GGUF
esperado.

- 34/34 capas en GPU, pesos y KV en `CUDA0`, sin KV en CPU.
- Prefill de **30.205 tokens a 1.656,4 tok/s**; tool call nativa y continuación correcta.
- VRAM: pico **7.481 MiB**; mínimo **476 MiB** libres en la pasada final. Otra pasada con
  más carga externa midió **62 MiB**. El objetivo de aviso sigue en 180 MiB.
- Visión: leyó **4** y **2** en dos sesiones limpias. El estrés de cuatro cifras no es
  fiable y se registra solo como información.
- Calidad KV (pasada única): A · 32K · q8_0 · visión **8/8**; B · 16K · f16 · visión
  **6/8**; C · 32K · f16 · sin visión **6/8**. A es la configuración recomendada.

Evidencia completa, con los JSON saneados y las cifras sin retocar:
[docs/evidencia/2026-10-30](https://github.com/Vahlame/bonsai-local-ide/blob/v1.2.0/docs/evidencia/2026-10-30/RESUMEN.md).

## Instalación y actualización

Requisitos: Windows 10/11, Node.js 22 o superior, GPU NVIDIA con espacio para el modelo
completo y `llama-server` con CUDA en `bin/`. Los modelos y binarios **no** se incluyen en
el repositorio.

```powershell
git clone --branch v1.2.0 https://github.com/Vahlame/bonsai-local-ide.git
cd bonsai-local-ide
npm ci --prefix chat       # dependencias de navegador, MCP y pruebas
.\scripts\start-ui.ps1    # modelo + interfaz en http://127.0.0.1:8787
```

Para actualizar una copia existente: `git pull`, `npm ci --prefix chat` y reinicia el IDE.
La memoria global y los chats viven en el estado local, así que la actualización no los
borra.

## Límites conocidos

- **43.008 tokens es una selección manual con margen limitado**, no una garantía de
  estabilidad. 44.032 falló con error CUDA de memoria. Si aparecen cuelgues o errores de
  VRAM, baja a 39.936 o usa un perfil de 32K.
- La visión es útil para una cifra o una captura sencilla; **no es OCR general**. Las
  cadenas de varias cifras con el fixture bitmap no son fiables.
- La comparación de calidad KV es una **pasada única**, no una medida estadística.
- El proyecto es solo para Windows y no reparte capas en CPU: el modelo debe caber entero
  en la GPU.
- La API y la interfaz no tienen autenticación y están pensadas para `127.0.0.1`. **No
  expongas los puertos 8080/8787 a Internet.**

## Licencia

Código bajo licencia **MIT**. Los pesos del modelo, `llama.cpp` y las dependencias
conservan sus propios términos. Consulta [LICENSE](https://github.com/Vahlame/bonsai-local-ide/blob/v1.2.0/LICENSE).

---

Cambios completos: [CHANGELOG.md](https://github.com/Vahlame/bonsai-local-ide/blob/v1.2.0/CHANGELOG.md).
