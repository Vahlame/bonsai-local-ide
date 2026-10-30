# Bonsai Local IDE 1.6.2 — el acceso directo abre el IDE de verdad

Fecha: 30 de octubre de 2026

## El fallo

El acceso directo del escritorio se creó con **`-NoBrowser`**:

```
powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass ^
  -File "...\scripts\bonsai-rtx4060.ps1" launch -NoBrowser
```

`-NoBrowser` arranca el servidor Node de la interfaz pero **no abre ninguna ventana**.
Resultado: doble clic → no aparece nada (aunque por detrás quedaba un `ui-server`
escuchando en el puerto 8787).

## La corrección

- El acceso directo ya **no** pasa `-NoBrowser`; ahora hace lo mismo que
  `.\scripts\bonsai-rtx4060.ps1 launch`: levanta la UI y abre la **ventana de
  aplicación sin GPU**.
- `scripts/crear-acceso-directo.ps1` genera ese acceso correcto (lanzador RTX 4060,
  ventana oculta, icono de Bonsai) y avisa en el propio script de que **no** hay que
  añadir `-NoBrowser`.
- Si la interfaz ya estaba corriendo, el lanzador reutiliza el servidor y solo abre la
  ventana (no crea un duplicado).
- Nueva comprobación en `chat/prueba-perfil-gpu.mjs`: el script del acceso directo debe
  ser PowerShell válido, usar `bonsai-rtx4060.ps1` y **no** llevar `-NoBrowser` en la
  línea de argumentos.

## Cómo comprobarlo

```powershell
# regenerar el acceso directo (idempotente)
.\scripts\crear-acceso-directo.ps1

# abrir sin esperar al acceso directo
.\scripts\open-ide.ps1          # ventana de aplicación, sin GPU
.\scripts\open-ide.ps1 -Tab     # pestaña normal, también sin GPU
```

Con la ventana abierta, `nvidia-smi --query-gpu=memory.used --format=csv` sigue en
**0 MiB**.

## Pruebas

- `npm test`: **40/40** en verde.
- `npm run test:navegador`: **5/5** en verde.
- Verificado a mano: acceso directo → ventana «Bonsai» abierta y `ui-server` en 8787.
