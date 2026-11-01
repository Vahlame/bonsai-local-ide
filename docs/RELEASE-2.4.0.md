# Bonsai Local IDE 2.4.0 — candidato local

Fecha de validación: 1 de noviembre de 2026. Notas preparadas para una versión futura;
no se crea tag ni se publica una release con este cambio.

El ciclo de vida del modelo tiene un registro único de binarios, un módulo Node con
exclusión mutua y adaptadores PowerShell con JSON. Iniciar, Detener, cambiar modelo y
Cerrar usan la misma política de verificación y recuperación. La UI tiene un solo
controlador de servidor y muestra los errores de parada.

La parada confirma PIDs muertos, puerto cerrado, marcador borrado y liberación de VRAM
cuando NVIDIA permite medirla. Cerrar solo apaga Node después de esa confirmación;
SSE/keep-alive no pueden dejar el cierre HTTP esperando indefinidamente. El navegador
intenta cerrar la ventana y ofrece un aviso si no lo permite.

El E2E usa GPT-OSS real, el build `lab-server-mvq2`, contexto 65536, KV `q8_0` y la UI
en 8787. También comprueba un hijo real con wrapper muerto y paradas concurrentes.
Las pruebas de fallo cargan el modelo real antes de provocar un error de verificación,
comprueban limpieza y restauración de la configuración anterior.

No se cambian Harmony, `--skip-chat-parsing`, las herramientas, el presupuesto de contexto,
el perfil de Ornith ni los binarios o GGUF. La lista permitida de la copia de evaluación
se amplía para empaquetar los nuevos módulos y el controlador de UI.

Contrato y comandos de prueba: [LIFECYCLE.md](LIFECYCLE.md).
Resultados y límites de la validación: [informe](../reports/lifecycle-2026-11-01/VALIDATION.md).
