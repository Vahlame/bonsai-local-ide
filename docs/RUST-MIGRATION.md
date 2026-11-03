# Migración gradual de Node.js a Rust

Estado: **propuesta**, no iniciada. La prioridad sigue siendo terminar la
desmonolitización de Node.js (ver `docs/REFACTORING.md`).

## Decisión

No se reescribe la aplicación de golpe. Se migran componentes con una frontera
estable, una ganancia medible y pruebas diferenciales que permitan volver atrás.

La UI, el bucle del agente y la integración con llama-server se quedan en
Node.js hasta que exista una razón medida. Un sidecar Rust que añade latencia o
duplica estado no es una mejora.

## Criterios para migrar un componente

1. **Frontera clara**: entrada/salida JSON o un contrato pequeño, sin callbacks
   de UI ni estado global.
2. **Ganancia medible**: CPU, memoria, latencia o robustez; se mide antes y
   después con el mismo corpus.
3. **Pruebas diferenciales**: la versión Node y la Rust producen el mismo
   resultado para los mismos casos, incluidos errores y límites.
4. **Interruptor de vuelta**: variable de entorno o configuración para usar la
   implementación Node si la Rust falla.
5. **Empaquetado claro**: binario por plataforma o N-API; nunca exigir Rust en
   tiempo de ejecución para quien solo usa la app.

## Orden propuesto

### 1. Búsqueda e índice de workspace

- Contrato: `search(root, query, {max, glob}) -> [{rel, line, text}]` y
  `symbols(root, files) -> Map<name, definitions>`.
- Por qué: CPU puro, sin UI, ya aislado en `server/services/project-search.mjs`
  y `server/services/symbol-index.mjs`.
- Integración: sidecar de larga vida por stdio JSON-RPC, o N-API si el coste de
  IPC supera al de recorrer el árbol.
- Pruebas: corpus con archivos grandes, binarios, symlinks, `.gitignore` y
  rutas Unicode.

### 2. Almacén de sesiones e historial

- Contrato: cargar/validar/guardar JSON atómico y recuperar `.bak`.
- Por qué: la lógica ya está centralizada en `almacen-json.mjs`,
  `session-store.mjs` e `historial.mjs`.
- Integración: N-API o sidecar; la escritura atómica y el fsync son críticos.

### 3. Escaneo y hash de modelos

- Contrato: recorrer `models/`, detectar GGUF/mmproj, SHA-256 y metadata.
- Por qué: I/O intensivo y verificable; ya aislado en `model-hub.mjs`.
- Integración: binario CLI invocado en segundo plano; no bloquea la UI.

### 4. Diagnósticos

- Solo si se integra un parser maduro (tree-sitter o rust-analyzer). Reescribir
  a mano los diagnósticos actuales no aporta.

## Lo que no se migra

- `ui-server.mjs` y rutas HTTP: el coste de un servidor Rust no compensa.
- El bucle del agente: depende de SSE, permisos y herramientas de Node.
- La UI del navegador: seguirá siendo HTML/CSS/JS.

## Primer paso concreto (cuando se autorice)

1. Crear `rust/bonsai-workspace/` con `cargo test`.
2. Implementar `search` y `symbols` con el mismo contrato y un corpus de prueba.
3. Añadir `scripts/bench-search.mjs` para comparar Node y Rust.
4. Integrar detrás de `BONSAI_RUST_SEARCH=1`; el valor por defecto sigue siendo
   Node.
5. Solo cambiar el valor por defecto si las pruebas y la medición lo justifican.
