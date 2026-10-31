# llguidance: structured outputs opcional

`llguidance` es la librería de Microsoft/Guidance AI para *constrained decoding*
(JSON Schema, regex y gramáticas CFG). En llama.cpp se activa en tiempo de
compilación; **no es una dependencia npm ni un servicio**.

## Por qué puede ayudar

- Fuerza JSON válido y tool calls con la forma exacta del schema.
- Evita reintentos por comillas, llaves o campos inventados.
- Es rápido: calcula máscaras de tokens bajo demanda (~50 µs/token en sus
  benchmarks).
- Complementa `--jinja` y el autoparser de tool calls; no los sustituye.

## Requisitos

1. **Rust y cargo** en el `PATH` (`rustup` es la vía recomendada).
2. El commit de llama.cpp debe incluir el soporte de `LLAMA_LLGUIDANCE`.
   El repo fija commits exactos; si el pin actual no lo incluye, hay que subir
   el pin y volver a pasar la suite.
3. MSVC, CMake y Ninja (ya los usa el build normal).

```powershell
rustc --version
cargo --version
```

## Compilar

Con el build principal:

```powershell
npm run build:llguidance
```

O directamente, conservando el resto de flags:

```powershell
.\scripts\build-inference-runtime.ps1 -Llguidance -Jobs 4
```

Para el build RTX 4060:

```powershell
.\scripts\build-rtx4060-optimized.ps1 -Llguidance -Variant RTX4060-Opt-MMQ
```

El informe en `reports/coder-phase2/build-*.json` incluye `llguidance: true` y
la lista exacta de flags.

## Usar

Con un build que tenga `LLAMA_LLGUIDANCE=ON`, las peticiones con `json_schema`
(o una gramática que empiece por `%llguidance`) se enrutan a llguidance. El
resto de gramáticas GBNF siguen funcionando como siempre.

Ejemplo de petición OpenAI-compatible:

```json
{
  "model": "local",
  "messages": [{"role": "user", "content": "Devuelve el plan"}],
  "response_format": {
    "type": "json_schema",
    "json_schema": {
      "name": "plan",
      "strict": true,
      "schema": {
        "type": "object",
        "properties": {
          "pasos": {"type": "array", "items": {"type": "string"}}
        },
        "required": ["pasos"],
        "additionalProperties": false
      }
    }
  }
}
```

## Seguridad y límites

- Un schema demasiado grande puede aumentar el coste de arranque; empieza por
  los schemas de herramientas, no por un schema gigante.
- Errores de gramática se imprimen en `stderr` y la generación continúa; revisa
  los logs si una respuesta no respeta el schema.
- Si el build no tiene Rust o el pin no incluye soporte, usa GBNF/JSON Schema
  normal. El IDE no depende de llguidance para arrancar.

## Referencias

- [llguidance](https://github.com/guidance-ai/llguidance)
- [llama.cpp: LLGuidance support](https://github.com/ggml-org/llama.cpp/blob/master/docs/llguidance.md)
- [JSONSchemaBench](https://github.com/guidance-ai/jsonschemabench)
