# App de tareas con persistencia

Crea `index.html` autocontenido y **offline**: una app de tareas (CRUD) con
`localStorage`. Sin frameworks, sin CDN, sin fuentes externas.

## Requisitos

- Input `id="nueva-tarea"`, botón `id="agregar"` y lista `id="lista"`.
- Cada tarea: checkbox, texto, botón editar y botón borrar.
- Filtros: **Todas**, **Pendientes**, **Hechas**.
- Contador de pendientes visible.
- Persistencia real en `localStorage`; al recargar se conservan las tareas.
- Diseño responsive, tema oscuro o claro, sin errores de consola.
- Todo el CSS/JS inline.

## Cómo trabajar

- **La primera acción debe ser `archivo`** con el HTML completo.
- Después lee el archivo y comprueba que cierra bien y que no hay recursos
  externos.
- Verifica con el navegador que se puede añadir una tarea y que no hay errores.
- Responde con un resumen breve.
