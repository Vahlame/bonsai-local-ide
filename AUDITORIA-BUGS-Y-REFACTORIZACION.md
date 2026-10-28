# Auditoría Técnica, Corrección de Bugs y Plan de Simplificación de Bonsai IDE

> **Destinatario:** Agente de codificación / Desarrollador encargado de la refactorización.  
> **Objetivo:** Resolver bugs críticos, eliminar redundancias y simplificar la arquitectura del proyecto sin romper la compatibilidad con el entorno local (Windows 11, RTX 4060 8 GB, Node.js ESM, llama-server y Playwright).

---

## 1. Resumen del Diagnóstico

El proyecto **Bonsai Local IDE** es un entorno de desarrollo asistido por IA local optimizado para GPUs de 8 GB (actualmente enfocado en `Ornith-1.5-9B`). La lógica funcional y los tests básicos pasan, pero el código presenta **alta deuda técnica, duplicación masiva de código entre capas, scripts gigantescos monolíticos y varios bugs sutiles pero graves en producción local**.

### Principales fuentes de "Enredo" (Overengineering & Tangled Code):
1. **Monolito en `chat/ui-server.mjs` (3.263 líneas):** Contiene servidor HTTP, API REST, un bucle de agente LLM completo de ~1.000 líneas, gestión de procesos de GPU y manejo de estado, duplicando la lógica que ya existe en `chat/bonsai-chat.mjs`.
2. **Caos en el frontend (`chat/ui/`):** `index.html` contiene un script inline de 1.750 líneas con variables globales. Luego se carga `ide.js` y finalmente `app.js` (1.800 líneas), el cual sobreescribe (*monkeypatches*) las variables y funciones globales de `index.html`.
3. **Heurísticas de texto obsoletas y conflictivas:** Decenas de expresiones regulares compiten entre sí para adivinar si el modelo quiso ejecutar comandos o guardar archivos en texto plano (````archivo`, ````ejecutar`, ````leer`), aun cuando el modelo ya emite `tool_calls` nativas estructuradas.
4. **Frenos arbitrarios que frustran al agente:** Reglas duras como "bloquear lectura tras 4 archivos" o "bloquear comando tras 2 fallos" que impiden que el agente resuelva problemas reales.

---

## 2. Matriz de Hallazgos y Bugs

| ID | Archivo | Líneas aprox. | Severidad | Tipo | Descripción |
|---|---|---|---|---|---|
| **BUG-01** | `chat/guardia.mjs` | L47-57, L77 | **ALTA** | Red / Seguridad | `--host 0.0.0.0` no permite conexiones LAN reales y bloquea conexiones HTTPS/proxy inverso. |
| **BUG-02** | `chat/navegador.mjs` | L148-151 | **ALTA** | Runtime / Crash | `page.viewportSize()` puede devolver `null`, causando `TypeError` al acceder a `.width`. |
| **BUG-03** | `chat/navegador.mjs` | L220-224 | **MEDIA** | Lógica / UX | Mensaje de error engañoso cuando un selector no existe o está oculto. |
| **BUG-04** | `chat/procesos.mjs` | L133, L144 | **MEDIA** | Estabilidad Windows | `fs.rmSync(file, { force: true })` en `cleanup()` puede fallar con `EBUSY/EPERM` en Windows al cerrar el proceso. |
| **BUG-05** | `scripts/stop-managed-server.ps1` y `start-gpu-model.ps1` | L83 (gpu), L6-29 (stop) | **ALTA** | Procesos / Fuga VRAM | Se registra el PID de PowerShell en vez de `llama-server.exe`, dejando servidores huérfanos imposibles de cerrar desde el IDE. |
| **BUG-06** | `chat/modelo.mjs` y `modelo.json` | L14-25, L138, L153 | **MEDIA** | Consistencia / Tipos | Cálculos globales de VRAM desincronizados (calculan para Bonsai 27B en vez de Ornith 9B) y falta de optional chaining. |
| **BUG-07** | `chat/ui/markdown.js` | L218-225, L269 | **MEDIA** | Seguridad / Performance | Vector de inyección de atributos HTML en enlaces Markdown y compilación de RegExp dentro de un bucle `while`. |
| **BUG-08** | `chat/ui-server.mjs` | L93-112 | **BAJA** | Rendimiento I/O | `podarUndo()` hace `readdirSync` + `statSync` a hasta 400 archivos en CADA escritura síncrona. |
| **BUG-09** | `chat/ui-server.mjs` | L2803-2814, L2947-2950 | **ALTA** | Lógica de Agente | Bloqueo artificial tras 4 lecturas de archivos y bloqueo permanente tras 2 fallos de comando. |
| **BUG-10** | `chat/ui-server.mjs` | L2843-2853 | **MEDIA** | Heurística errónea | Ejecución forzada e involuntaria de archivos `.py` si el usuario menciona la palabra "pdf". |

---

## 3. Detalle de Bugs y Soluciones de Código

### BUG-01: Bloqueo de IP de LAN en `chat/guardia.mjs`
- **Problema:** Al iniciar con `--host 0.0.0.0`, `hostsPermitidos(args)` agrega `"0.0.0.0:8787"`, pero cuando un cliente entra con la IP local de la máquina (ej. `192.168.1.50:8787`), la cabecera `Host` es rechazada con `403 Host no permitido`. Además, la cabecera `Origin` exige `http://${host}`, bloqueando accesos por túneles HTTPS (Cloudflare, ngrok, Caddy).
- **Solución propuesta:**
```javascript
// En chat/guardia.mjs:
export function hostsPermitidos(args) {
  const puerto = String(args.port);
  const out = new Set([`127.0.0.1:${puerto}`, `localhost:${puerto}`, `[::1]:${puerto}`]);
  const host = normalizar(args.host);
  if (host && host !== "127.0.0.1" && host !== "localhost" && host !== "::1" && host !== "[::1]") {
    out.add(`${host}:${puerto}`);
  }
  return out;
}

export function revisarPeticion(req, args) {
  const cabeceras = req.headers || {};
  const host = normalizar(cabeceras.host);
  if (!host) return { ok: false, motivo: "falta la cabecera Host" };

  const permitidos = hostsPermitidos(args);
  // Si args.host es comodín (0.0.0.0 o ::), se acepta cualquier host que coincida en puerto
  const esComodin = args.host === "0.0.0.0" || args.host === "::";
  const puertoHost = host.split(":").pop();
  if (!permitidos.has(host) && !(esComodin && puertoHost === String(args.port))) {
    return { ok: false, motivo: `Host no permitido: ${host}` };
  }

  const origen = cabeceras.origin;
  if (origen !== undefined && origen !== "") {
    const normOrigen = normalizar(origen);
    // Permitir tanto http:// como https:// hacia el host permitido
    if (normOrigen !== `http://${host}` && normOrigen !== `https://${host}`) {
      return { ok: false, motivo: `Origin no permitido: ${origen}` };
    }
  }
  // ... resto igual
}
```

---

### BUG-02: Crash en `chat/navegador.mjs` por `page.viewportSize()` nulo
- **Problema:** Playwright devuelve `null` si la página no tiene un viewport fijo. `args.ancho ?? current.width` arroja `TypeError`.
- **Solución propuesta:**
```javascript
// En chat/navegador.mjs línea 148:
const current = this.page.viewportSize() || { width: 1280, height: 800 };
const width = Number(args.ancho ?? current.width);
const height = Number(args.alto ?? current.height);
```

---

### BUG-03: Mensaje de error engañoso en `chat/navegador.mjs` al inspeccionar selector
- **Problema:** Si el selector no existe en el DOM o está oculto (`display: none`), `target.boundingBox()` devuelve `null`. El código lanza: `"Elige un elemento visible más pequeño para la captura de detalle"`. El LLM asume que el elemento es enorme y se pierde intentando achicarlo.
- **Solución propuesta:**
```javascript
// En chat/navegador.mjs línea 222:
if (action === "captura" && args.selector) {
  target = this.page.locator(String(args.selector));
  const bounds = await target.boundingBox();
  if (!bounds) throw new Error(`El elemento con selector "${args.selector}" no existe o no está visible.`);
  if (bounds.width > 1920 || bounds.height > 1200) {
    throw new Error("Elige un elemento visible más pequeño para la captura de detalle (máx 1920x1200).");
  }
}
```

---

### BUG-04: Falla de borrado temporal en Windows en `chat/procesos.mjs`
- **Problema:** `fs.rmSync(file, { force: true })` en Windows arroja `EBUSY` o `EPERM` si el proceso cerró sus streams pero el sistema operativo aún retiene el handle del archivo `.cmd` / `.py`. Al no tener `try/catch`, produce un unhandled rejection.
- **Solución propuesta:**
```javascript
// En chat/procesos.mjs:
function safeUnlink(file) {
  try {
    fs.rmSync(file, { force: true, maxRetries: 3, retryDelay: 50 });
  } catch {
    // Si Windows aún lo tiene bloqueado, no tirar abajo el proceso
  }
}

// Reemplazar cleanup: () => fs.rmSync(file, { force: true }) por:
cleanup: () => safeUnlink(file)
```

---

### BUG-05: Fuga de procesos de `llama-server.exe` en scripts PowerShell
- **Problema:** `start-gpu-model.ps1` guarda `$PID` en `logs/servidor-administrado-$Port.json`, que es el ID de la consola de PowerShell. Cuando el proceso PowerShell muere o se cierra la ventana, `llama-server.exe` sigue corriendo en el puerto 8080. Al llamar `stop-managed-server.ps1`, éste busca `$info.pid` (que ya no existe), asume que el proceso en el puerto 8080 es ajeno (`$managed` vacío) y se niega a cerrarlo, bloqueando la GPU.
- **Solución propuesta:**
  1. En `scripts/start-gpu-model.ps1`, registrar el PID real del ejecutable una vez lanzado, o lanzar `llama-server.exe` con `Start-Process -PassThru` para registrar su PID directo en el JSON marcador.
  2. En `scripts/stop-managed-server.ps1`, si el puerto está ocupado por `llama-server.exe` y coincide con la ruta esperada `bin\llama-server.exe`, permitir cerrarlo limpiamente y borrar el archivo marcador `logs/servidor-administrado-$Port.json`.

---

### BUG-06: Cálculos de VRAM en `chat/modelo.mjs` calculan arquitectura errónea
- **Problema:** `modelo.mjs` lee `MODELO.modelo` en el cálculo de `kvBytesPorToken` (64 capas, 16 de atención completa del modelo Ternary-Bonsai-2-27B). Pero el modelo activo actual es `Ornith-1.5-9B` (definido dentro de `catalogo.ornith9b`).
- **Solución propuesta:**
  Hacer que `kvBytesPorToken` y los cálculos de VRAM acepten opcionalmente la clave del modelo o tomen los datos del modelo activo del catálogo (`MODELO.catalogo[clave].servidor`).
  Además, proteger líneas 138 y 153 con optional chaining:
```javascript
export function perfilAgente(clave) {
  const fila = clave ? MODELO.catalogo?.[clave] : null;
  // ...
}
export function pensarDe(clave) {
  const fila = clave ? MODELO.catalogo?.[clave] : null;
  // ...
}
```

---

### BUG-07: Inyección en atributos en `chat/ui/markdown.js` y RegExp en bucles
- **Problema 1:** En `inlineMd()`, `[label](url)` concatena `${url}` directamente dentro de `<a href="${url}">`. Aunque la línea fue pre-escapada con `esc()`, las entidades `&quot;` dentro de atributos HTML son decodificadas por los navegadores, permitiendo salir del atributo `href`.
- **Problema 2:** En la línea 269, se compila un `new RegExp(...)` en cada iteración del bucle `while` para encontrar el cierre del fence de código.
- **Solución propuesta:**
```javascript
// 1. Validar y escapar atributos estrictamente en enlaces:
function safeUrl(rawUrl) {
  const clean = String(rawUrl || "").trim().replace(/[&<>"']/g, "");
  return /^https?:\/\//i.test(clean) ? clean : "#";
}
// En inlineMd:
.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, label, url) =>
  `<a href="${safeUrl(url)}" target="_blank" rel="noreferrer noopener">${label}</a>`
)

// 2. Pre-compilar el RegExp de cierre fuera del while:
const markChar = mark[0] === "\\" ? "\\\\" : mark[0];
const fenceEnd = new RegExp(`^\\s*${markChar}{${mark.length},}\\s*$`);
while (i < lines.length && !fenceEnd.test(lines[i])) {
  body.push(lines[i]);
  i += 1;
}
```

---

### BUG-08: Bloqueo sincrónico en `podarUndo()` en `chat/ui-server.mjs`
- **Problema:** En cada guardado de archivo o acción del agente se llama a `podarUndo()`, que lee y hace stat sincrónico de hasta 400 archivos JSON en disco.
- **Solución propuesta:**
  Podar de forma diferida (por ejemplo, con un contador o `setTimeout` para que se ejecute en background y no en la ruta crítica del guardado), o podar sólo cuando el número de operaciones en memoria supere un umbral.

---

### BUG-09 y BUG-10: Restricciones excesivas y heurísticas erróneas en el bucle del agente
- **Problema BUG-09:** `ui-server.mjs` corta las lecturas si `archivosVistos.size >= 4` con el mensaje: *"Ya leíste suficiente en este mensaje. No abras más archivos."* Esto rompe tareas complejas de refactorización donde el agente legítimamente necesita consultar 5 o más archivos. También bloquea un comando permanentemente si falló 2 veces (`fails >= 2`).
- **Problema BUG-10:** Si el texto del usuario contiene `"pdf"` o `"ejecut"`, `ui-server.mjs` fuerza automáticamente `requested.push(python script.py)`, ejecutando código sin que el modelo haya decidido ejecutarlo.
- **Solución propuesta:**
  - Aumentar el límite de archivos vistos a un valor razonable (ej. 15 o sin límite duro mientras quepa en contexto).
  - Permitir reintentar comandos si el modelo lo solicita explícitamente mediante `tool_calls`.
  - Eliminar la inyección mágica de comandos basada en palabras clave en el texto del usuario cuando el modelo tiene soporte para `tool_calls` nativas.

---

## 4. Plan de Simplificación y Desacoplamiento ("Sin Tanto Enredo")

### Diagnóstico de la Arquitectura Actual
```
ui-server.mjs (3263 líneas)
  ├── Servidor HTTP y rutas REST
  ├── Bucle de Agente inline con SSE (900 líneas duplicadas)
  ├── Parser de heurísticas de texto repetido
  └── Control de procesos de llama-server
         │
         ▼
bonsai-chat.mjs (1333 líneas)
  ├── Otro bucle de Agente paralelo
  └── Manejo de contexto y token packing
```

```
index.html (2442 líneas)
  └── Script inline global de 1750 líneas
         ▲
         │ (Sobreescribe variables globales con monkeypatching)
app.js (1800 líneas) + ide.js (205 líneas)
```

### Arquitectura Recomendada y Modular
Para desenredar el proyecto sin alterar su funcionamiento:

1. **Separar `chat/ui-server.mjs` en 3 módulos específicos:**
   - `chat/servidor-rutas.mjs`: Maneja las peticiones HTTP/REST (`/api/file`, `/api/fs`, `/api/undo`, `/api/modelos`, `/api/git`, etc.) y sirve estáticos.
   - `chat/agente-runner.mjs`: Centraliza el bucle de ejecución de agentes, herramientas y eventos SSE. Unifica la lógica entre la consola (`bonsai-chat.mjs`) y la interfaz web (`ui-server.mjs`) usando una sola clase base o pipeline.
   - `chat/servidor-modelo.mjs`: Maneja el ciclo de vida, arranque, parada y verificación de salud de `llama-server`.

2. **Unificar el frontend de `chat/ui/`:**
   - Extraer el código JavaScript incrustado en `chat/ui/index.html` (líneas 663-2420) a un archivo limpio `chat/ui/chat-core.js`.
   - Eliminar el patrón de sobreescritura global donde `app.js` reemplaza funciones de `index.html`. Convertir el estado de la UI en un objeto de estado unificado (`BonsaiState`) accesible por ambos archivos sin colisiones ni escuchadores duplicados.

3. **Eliminar el doble camino de Tool Calling:**
   - Si el modelo configurado (`Ornith 9B` o compatible) emite llamadas de herramientas nativas (`tool_calls`), dar **prioridad absoluta** a los argumentos de la función.
   - Desactivar las expresiones regulares heurísticas de texto libre (cercas ````archivo`, ````ejecutar`, inferencias de "voy a buscar...") cuando existan llamadas de herramientas válidas, evitando dobles ejecuciones o archivos no solicitados (como `lee-ventas-json.json`).

4. **Reemplazar el algoritmo LCS O(N×M) de `unifiedDiff` en `actions.mjs`:**
   - La matriz bidimensional `Uint16Array` asignada celda por celda es innecesariamente compleja. Se puede reemplazar por un generador de diff línea a línea basado en bloques coincidentes, mucho más liviano y sin riesgo de consumo excesivo de memoria.

---

## 5. Plan de Ejecución para el Agente de Coding

El agente encargado de implementar los cambios debe seguir estas fases estrictas para no generar regresiones:

### Fase 1: Corrección de Bugs Inmediatos (Bajo Riesgo, Alto Impacto)
1. **Editar `chat/guardia.mjs`**: Corregir la validación de `Host` para permitir comodines `0.0.0.0` y permitir `Origin` con `https://`.
2. **Editar `chat/navegador.mjs`**: Añadir fallback para `viewportSize()` y corregir el mensaje de error cuando el selector no se encuentra.
3. **Editar `chat/procesos.mjs`**: Proteger `safeUnlink` contra `EBUSY/EPERM` en Windows.
4. **Editar `chat/ui/markdown.js`**: Sanitizar URLs en enlaces Markdown y compilar RegExp fuera de bucles.
5. **Editar `chat/modelo.mjs`**: Añadir optional chaining en `perfilAgente` y `pensarDe`.

### Fase 2: Flexibilización de Heurísticas en `chat/ui-server.mjs`
1. Relajar el bloqueo de lectura de 4 archivos (permitir hasta 12 o no bloquear si son rutas válidas).
2. Eliminar la auto-ejecución involuntaria de scripts cuando el usuario dice palabras como "pdf".
3. Evitar que `podarUndo()` bloquee síncronamente el hilo principal en cada guardado.

### Fase 3: Desacoplamiento y Modularización
1. Extraer la lógica de `ui-server.mjs` en submódulos especializados.
2. Limpiar la duplicación entre `index.html` y `app.js`.

### Fase 4: Verificación y Test Suite
Ejecutar la suite completa de pruebas automáticas para comprobar que todo sigue funcionando:
```powershell
node chat/prueba-archivos-seguros.mjs
node chat/prueba-git-seguro.mjs
node chat/prueba-procesos.mjs
node chat/prueba-seguridad.mjs
node chat/prueba-sin-gpu.mjs
node chat/prueba-ui.mjs
node chat/prueba-api.mjs
node chat/prueba-agente.mjs
node chat/prueba-truncado.mjs
node chat/modelo.mjs
node chat/actions.mjs
node chat/editar.mjs
node chat/adaptadores.mjs
```
Todos los tests deben reportar `OK`.
