# Bonsai Local IDE 2.3.6

**Fecha:** 1 de noviembre de 2026
**Tema:** Detener y Cerrar IDE e IA de verdad, con evidencia real.

Esta release corrige dos fallos que hacían que los botones de apagado fueran
poco fiables: el modelo seguía vivo y la ventana del IDE no se cerraba. No es
un cambio de estética; se probó con el servidor GPT-OSS real y con la UI real.

---

## El fallo de Detener

El lanzador optimizado elige el primer binario que existe:

```text
bin\builds\lab-server-mvq2\bin\llama-server.exe
```

El script de parada solo aceptaba:

```text
bin\llama-server.exe
.local\opt\...\build-RTX4060-Opt-sm89\bin\llama-server.exe
%USERPROFILE%\.local\opt\...\build-RTX4060-Opt-sm89\bin\llama-server.exe
```

El marcador era válido, pero `Test-ServidorEsperado` rechazaba el ejecutable
real. El script no encontraba el servidor, veía un listener “ajeno” y lanzaba:

```text
El puerto 8080 pertenece a un proceso que esta interfaz no administra.
```

La UI podía decir que había apagado, pero `llama-server` seguía ocupando VRAM.

### Corrección

- Se añadió el build de laboratorio a la lista de ejecutables permitidos.
- El cierre espera hasta 8 s a que mueran los PIDs **y** se cierre el puerto.
- Si algo sigue vivo, falla y **no borra el marcador**; no se puede reintentar
  sobre un estado mentido.
- Si el wrapper quedó atascado, se cierra después del servidor.
- Se añadió una prueba que compara los binarios del lanzador con los que acepta
  el script de parada.

## El fallo de Cerrar IDE e IA

`chat/ui/app.js` hacía:

```js
const boton = $("#servidor-toggle");
boton.disabled = true;
```

Pero `#servidor-toggle` no existe en `chat/ui/index.html`. El `TypeError`
ocurría antes de llamar a `/api/servidor`, así que el botón no cerraba nada.

### Corrección

- El controlador es null-safe: funciona aunque el toggle no exista.
- Cerrar IDE e IA pide confirmación, para el modelo, comprueba que el puerto
  quedó cerrado, cierra el servidor Node e intenta `window.close()`.
- Si el cierre falla, el botón vuelve a estar disponible y se muestra el error.
- El botón sigue visible a 1280 px; antes una media query lo ocultaba.

## Verificación end-to-end

Con GPT-OSS cargado y la UI en 8787:

| Paso | Resultado |
|---|---|
| Pulsar **Detener** | `llama-server` muere, 8080 se cierra, marcador borrado |
| La UI tras Detener | Sigue viva en 8787 |
| Rearrancar el modelo | Nuevo `pidServidor`, `/health` responde |
| Pulsar **Cerrar IDE e IA** | Mueren modelo y UI, sin marcador |
| VRAM tras cerrar | Vuelve al nivel de reposo (`nvidia-smi`) |

Evidencia de la ejecución:

```text
UI: botón Detener visible
Detener: llama-server cerrado, UI viva, marcador limpio
Rearranque: llama-server PID 57712
Cerrar IDE e IA: UI y llama-server cerrados, sin marcador
```

## Pruebas

| Prueba | Resultado |
|---|---|
| `npm test` | **48/48** |
| `npm run test:navegador` | **7/7** |
| `node scripts/e2e-lifecycle.mjs` | **OK** |
| `npm run docs:links` | **102 enlaces, 0 roto** |

## Prompt de refactor 2.4

Se incluye [PROMPT-REFACTOR-2.4.md](PROMPT-REFACTOR-2.4.md) para que otro modelo
pueda hacer la modularización pendiente sin romper el parser Harmony, las tools
de GPT-OSS, el contexto automático ni el perfil de Ornith 9B. El prompt explica
los fallos, la arquitectura objetivo, los contratos, las pruebas y los criterios
de aceptación.

## Actualizar

```powershell
git pull
npm run build:ui-vendor
.\scripts\crear-acceso-directo.ps1
```

La UI 2.3.6 migra los ajustes una vez y mantiene el contexto automático.
