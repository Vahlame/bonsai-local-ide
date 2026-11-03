# Runtime PrismML para modelos ternarios

Los GGUF `PTQ1_0` y `PQ2_0` de `prism-ml/Ternary-Bonsai-2-27B-gguf` usan
kernels ternarios que el llama.cpp stock rechaza con:

```text
tensor 'output.weight' has invalid ggml type 143. should be in [0, 43)
```

No es un archivo corrupto: hace falta el fork de PrismML. El IDE no reemplaza
el binario global; el modelo declara `servidor.binario = "prism-b10822"` y el
lanzador elige ese ejecutable solo para él.

## Instalación en Windows

1. Descarga el ZIP CUDA 12.4 (probado en la RTX 4060):

   <https://github.com/PrismML-Eng/llama.cpp/releases/download/prism-b10822-bf8c069/llama-prism-b10822-bf8c069-bin-win-cuda-12.4-x64.zip>

   SHA-256 del ZIP: `301ba8957030e46386917d659f7412e77df899b868ad642f83a1dfb4d91b3a7f`.

2. Extrae en:

   ```text
   .local/opt/bonsai-inference/prism-b10822/bin/
   ```

   El ZIP deja los `.exe` y `.dll` en la raíz; muévelos a `bin/` para que
   coincida con `config/llama-binaries.json`:

   ```powershell
   $base = ".local\opt\bonsai-inference\prism-b10822"
   New-Item -ItemType Directory -Force "$base\bin" | Out-Null
   Get-ChildItem $base -File | Where-Object Name -ne "prism.zip" | Move-Item -Destination "$base\bin" -Force
   & "$base\bin\llama-server.exe" --version
   ```

   Debe imprimir `build 10822` o superior.

3. Comprueba que el registro lo ve:

   ```powershell
   node -e "import('./chat/lifecycle/binary-registry.mjs').then(m=>console.log(m.selectBinary(process.cwd(),{preferred:'prism-b10822'})))"
   ```

4. Descarga el modelo (5,95 GB):

   ```powershell
   node scripts/hub.mjs download-url "hf://prism-ml/Ternary-Bonsai-2-27B-gguf/Ternary-Bonsai-2-27B-PTQ1_0.gguf"
   ```

   El Hub lo registra como `ternary-bonsai-2-27b-ptq1-0` y conserva el perfil
   medido de 24 576 tokens con KV q8_0.

## Verificación rápida

```powershell
node scripts/model-lab.mjs probe --model ternary-bonsai-2-27b-ptq1-0 --sin-vision
```

En la RTX 4060 de 8 GB la medición del 2026-11-02 dio 27,64 tok/s de generación,
7 013 MiB de VRAM pico y 4/5 pruebas. El detalle está en
[reports/bench-nuevos-modelos-2026-11-02.md](../reports/bench-nuevos-modelos-2026-11-02.md).

## Si el runtime no está instalado

El IDE muestra un error claro al intentar arrancar el modelo:

> Este modelo exige el binario 'prism-b10822' y no está disponible; instálalo
> en la ruta del registro de binarios.

No cae silenciosamente al llama.cpp stock, que cargaría el archivo y produciría
resultados incorrectos o fallaría al leer los tensores.
