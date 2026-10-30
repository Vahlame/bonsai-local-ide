# Bonsai Local IDE 1.6.1 — IDE sin GPU, ventana propia y pulido de interfaz

Fecha: 30 de octubre de 2026 · RTX 4060 Laptop 8 GB (dedicada al modelo; pantalla en la APU)

## Lo importante

El IDE ahora se abre en **su propia ventana de aplicación** (sin pestañas ni barra de
direcciones) y **no toca la NVIDIA**: `scripts/open-ide.ps1` lanza Edge/Chrome con
`--disable-gpu`, `--disable-gpu-compositing`, `--disable-accelerated-2d-canvas` y
`--disable-gpu-rasterization`, con un perfil aislado en `logs\ui-app-profile`.

Comprobado con la ventana abierta: **0 MiB de VRAM usada**. La barra de estado muestra
«UI · CPU» y el modelo conserva los 8 GB para él. `-Tab` abre una pestaña normal con
los mismos flags.

## Por qué no Tauri ni Electron

El IDE ya es un servidor Node + UI web. Tauri (Rust + WebView2) o Electron añadirían
una cadena de compilación y un runtime extra para conseguir lo mismo que `--app`:
ventana propia, sin cromo del navegador y sin GPU. El coste/beneficio no compensa;
con Edge/Chrome en modo aplicación la ventana es idéntica en uso y **cero
dependencias nuevas**.

## Interfaz: pulido de calidad (todo CPU)

- **Cabecera en una sola línea a 1920×1080** con el selector de preset compacto
  (`110k · q8_0 · visión CPU`; el nombre completo queda en el tooltip).
- **«Iniciar» destaca** como acción principal cuando no hay modelo; «Detener» usa el
  color de peligro.
- **Mensajes**: el tuyo va en burbuja alineada a la derecha; las respuestas del modelo
  llevan una guía vertical azul que se intensifica al pasar el ratón. Entrada animada
  de 170 ms solo para mensajes nuevos (al restaurar una sesión no hay ráfaga).
- **Caja de escritura**: el foco ilumina todo el bloque con un anillo suave; el botón
  Enviar tiene estado deshabilitado claro y feedback al pulsar.
- **Barra de estado**: se acomoda en varias líneas, el resumen se recorta con puntos
  suspensivos y el medidor desaparece por debajo de 1280 px.
- **Detalles**: selección de texto con el acento, scrollbars finas que se aclaran al
  pasar el ratón, foco visible único, editor vacío con la pista centrada.
- **Tema Arena** afinado: acento verde oliva (identidad Bonsai) en vez del marrón.
- **Sin efectos de GPU**: se eliminó el único `backdrop-filter` y no hay blur ni
  filtros grandes. Las animaciones son `opacity`/`transform` cortos, y
  `prefers-reduced-motion` las desactiva.

## Responsive (1920×1080 y portátil)

- **1920×1080**: una sola fila de herramientas, tres paneles y chat a la derecha.
- **1600×900**: la cabecera reduce aire y el selector se acorta; todo sigue accesible.
- **≤1180 px**: la cabecera pasa a dos filas y el área de trabajo a una rejilla de dos
  filas (explorador + editor arriba, conversación abajo, a todo el ancho).
- Probado con capturas reales a 1920×1080, 1600×900, 1366×768 y 1024×768.

## Pruebas

- `npm test`: **40/40** en verde.
- `npm run test:navegador`: **5/5** en verde (incluye Ctrl+K de punta a punta).
- Nuevas comprobaciones en `chat/prueba-perfil-gpu.mjs`: `open-ide.ps1` debe ser
  PowerShell válido y llevar `--disable-gpu`, `--disable-gpu-rasterization`,
  `--app=` y `uicpu=1`.

## Extra

- **Arreglado un bug real de la UI**: `app.js` creaba un segundo contenedor
  `.avisos`, así que unos toasts salían en una caja y otros en otra; cualquier
  selector `.avisos` podía leer la vacía. Ahora todo usa `#avisos`.

## Reproducir

```powershell
# ventana de aplicación sin GPU (lo que hace el acceso directo)
.\scripts\open-ide.ps1

# pestaña normal, también sin GPU
.\scripts\open-ide.ps1 -Tab

# comprobar que el IDE no usa VRAM (con la ventana abierta)
nvidia-smi --query-gpu=memory.used --format=csv
```
