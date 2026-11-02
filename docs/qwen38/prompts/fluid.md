# Simulador de fluidos con física

Crea `index.html` autocontenido y **offline**: un simulador de fluidos 2D con
física de partículas (SPH o metaballs) en canvas 2D o WebGL. Sin librerías
externas, sin CDN, sin imágenes, sin fuentes externas.

## Requisitos

- Al menos **600 partículas** con gravedad, colisiones con las paredes,
  amortiguación y coalescencia suave.
- Interacción con el ratón: atraer con clic izquierdo y repeler con clic
  derecho (o botones equivalentes).
- Botones visibles: **Reiniciar**, **Pausa** y **Añadir 200**.
- HUD con **FPS** y número de partículas. Usa `id="fps"` y `id="particulas"`.
- Render bonito: fondo oscuro, partículas con brillo/gradiente y estela.
- Responsive, `pixelRatio` máximo 2, `requestAnimationFrame` con delta.
- Sin errores de consola. Todo el CSS/JS inline.

## Cómo trabajar

- **La primera acción debe ser `archivo`** con el HTML completo.
- Después lee el archivo y comprueba que cierra bien y que no hay recursos
  externos.
- Verifica con el navegador que el canvas se ve y que no hay errores.
- Responde con un resumen breve.
