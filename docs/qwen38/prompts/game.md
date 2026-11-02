# Juego arcade jugable

Crea `index.html` autocontenido y **offline**: un juego arcade en canvas 2D
(Breakout o Snake). Sin librerías externas, sin CDN, sin imágenes.

## Requisitos

- Controles de teclado: flechas o WASD; **Espacio** para iniciar/reiniciar.
- Puntuación visible con `id="puntuacion"` y vidas o estado con `id="estado"`.
- Condición de victoria/derrota y reinicio claro.
- Física simple: rebote, colisiones y dificultad progresiva.
- Estética limpia, responsive, `pixelRatio` máximo 2.
- Sin errores de consola. Todo el CSS/JS inline.

## Cómo trabajar

- **La primera acción debe ser `archivo`** con el HTML completo.
- Después lee el archivo y comprueba que cierra bien y que no hay recursos
  externos.
- Verifica con el navegador que el canvas se ve y que no hay errores.
- Responde con un resumen breve.
