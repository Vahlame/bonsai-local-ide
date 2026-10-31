# Bonsai Local IDE 2.0.0 — precisión local

**Fecha:** 31-oct-2026  
**Tag:** `v2.0.0`  
**Base:** 1.9.0 (MoE híbrido) sin cambios de motor.

## La idea

1.9 demostró que un modelo de 35B puede vivir entre 8 GB de VRAM y 16 GB de RAM.
2.0 no persigue otro récord de tamaño: pule lo que rodea al modelo para que cada
turno sea más rápido, más limpio y más agradable de usar. La inferencia sigue
siendo 100 % local y el motor sigue siendo llama.cpp sm89 con FlashAttention,
MMQ, CUDA graphs, KV q8/q4 y decodificación especulativa.

## Lo nuevo

### Visión que no desperdicia píxeles

- `chat/imagenes.mjs` normaliza cada adjunto antes de mandarlo a llama.cpp:
  orientación EXIF, lado mayor **≤1600 px**, transparencia aplanada sobre blanco
  y JPEG **4:4:4** para que el texto de las capturas siga nítido.
- Se conserva el original si `sharp` no puede procesar la imagen. La visión es
  una mejora, nunca un motivo para romper el turno.
- Tope de entrada de 8 MB y tope total de body base64 de 12 MB.
- Test dedicado: `chat/prueba-imagenes.mjs`.

### Investigación con menos ruido

- `chat/investigacion.mjs` usa `@mozilla/readability` para aislar el artículo,
  `turndown` para convertirlo a **Markdown GFM** y `linkedom` para tener DOM sin
  navegador.
- El extractor regex histórico queda como *fallback* para páginas cortas o
  malformadas.
- La guardia SSRF, el bloqueo de puertos del IDE/modelo, los límites de descarga
  y el aviso de contenido no confiable **no cambian**.
- Test: `chat/prueba-investigacion.mjs`.

### Model Hub con identidad

- Logos SVG locales de Qwen, Meta/Llama, Mistral, DeepSeek, OpenAI, Gemma,
  NVIDIA, IBM, Hugging Face, Liquid, Zhipu, Kimi y otros.
- Se sirven desde `chat/ui/iconos/modelos/`; sin CDN ni peticiones externas.
- Si no se reconoce el proveedor, se usa la marca Bonsai. Nunca se inventa una
  afiliación.

### Avisos nativos opt-in

- Nuevo ajuste **Avisar al terminar (ventana oculta)**.
- Solo pide permiso cuando lo activas; solo notifica si `document.hidden` y el
  turno terminó de verdad (no en continuaciones automáticas ni cancelaciones).
- Sin servidor de notificaciones, sin push, sin cuenta.

### Release reproducible

- Dependencias nuevas con versión exacta y licencia permisiva:
  `sharp`, `@mozilla/readability`, `turndown`, `turndown-plugin-gfm`,
  `linkedom`, `@lobehub/icons-static-svg`.
- `npm audit`: **0 vulnerabilidades**.
- Nueva documentación: [DEPENDENCIAS-2.0](DEPENDENCIAS-2.0.md).
- Nueva portada con evolución, modelos y novedades en SVG.

## Lo que no cambia

- **Sin nube:** el modelo, las imágenes, los chats y el código no salen del
  equipo.
- **Sin reescribir la UI:** sigue siendo vanilla, con el sistema de diseño y los
  temas existentes.
- **Sin cambiar el motor:** los presets, el plan por modelo, el MoE híbrido y
  los benchmarks de 1.9 siguen siendo válidos.
- **Sin descargas nuevas de modelos:** 2.0 no exige volver a bajar GGUF.

## Modelos recomendados (medidos en 1.9, vigentes en 2.0)

| Modelo | Coding real | Web app | Generación | Uso |
|---|---:|---:|---:|---|
| **GPT-OSS-20B** | **100 %** | **100 %** | 31 tok/s | Proyecto complejo desde cero |
| **Qwen3.6-35B-A3B** | **96 %** | 91 % | 39 tok/s | Código guiado, bugfix y visión |
| **Qwen3-30B-A3B 2507** | 86 % | 55 % | **42 tok/s** | Velocidad con calidad |
| Qwen3 4B Instruct 2507 | 64 % | — | **74 tok/s** | Ediciones rápidas |
| Qwen3.5 9B | 57 % | — | 41 tok/s | Chat técnico general |
| Qwen2.5 Coder 7B | 49 % | — | 67 tok/s | Cambios pequeños |
| Ornith 1.5 9B | 35 % | — | 26 tok/s | Agente del IDE, no one-shot |

Detalle: [CODING-2026-10-31](../reports/CODING-2026-10-31.md),
[MOE-2026-10-31](../reports/MOE-2026-10-31.md) y
[WEBAPP-2026-10-31](../reports/WEBAPP-2026-10-31.md).

## Actualizar desde 1.9.0

```powershell
git pull
npm ci --prefix chat
.\scripts\bonsai-rtx4060.ps1 launch
```

No hace falta borrar `models/`, `chat/ui-settings.json` ni `chat/ui-chats/`.
Los ajustes existentes se conservan; la notificación nativa empieza apagada.

## Verificación de la release

```powershell
npm test                    # 43 suites aisladas
npm run test:navegador      # Edge/Chrome headless
npm audit --prefix chat     # 0 vulnerabilidades
npm run docs:links          # enlaces de documentación
```

Resultado esperado: **43/43** en aislamiento, **6/6** en navegador, **0**
vulnerabilidades y enlaces válidos.

## Licencias

El código sigue bajo **MIT**. `sharp` es Apache-2.0 y arrastra libvips
(LGPL-3.0); Readability es Apache-2.0; Turndown, Linkedom y los iconos son
MIT/ISC. Los GGUF y los binarios de llama.cpp conservan sus términos. El
repositorio no incluye modelos, binarios ni datos locales.

## Enlaces

- [README](../README.md)
- [CHANGELOG](../CHANGELOG.md)
- [DEPENDENCIAS-2.0](DEPENDENCIAS-2.0.md)
- [Evolución](graficos/evolucion-2.0.svg)
- [Modelos](graficos/modelos-2.0.svg)
- [Novedades](graficos/novedades-2.0.svg)
