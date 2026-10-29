# CUDA y profiling local

La instalación de este equipo está en `%USERPROFILE%\.local\opt\bonsai-inference`.
No se sustituyó el driver NVIDIA ni el runtime original de `bin/`.
CUDA 12.9.1, Nsight Systems 2026.3.2 y Nsight Compute 2026.3 están instalados
y se ejecutaron sobre Ornith 9B en la RTX 4060 Laptop. MSVC 2022 Build Tools,
CMake y Ninja ya estaban presentes y se reutilizaron.

## Reproducir la instalación y compilación

```powershell
node scripts/install-inference-tools.mjs --threads 12
# Sesión actual; -Persist añade también las herramientas al PATH del usuario.
. .\scripts\enable-inference-tools.ps1 -Persist
.\scripts\build-inference-runtime.ps1 -Jobs 4
```

El instalador utiliza exclusivamente los paquetes oficiales y verifica los SHA-256
y tamaños de `config/inference-toolchain-packages.json`. Reanuda descargas por
partes y conserva recibos de instalación. La configuración de rutas locales y el
respaldo de PATH/CUDA_PATH se guardan en `config/inference-toolchain.local.json`,
excluido de Git. Las terminales nuevas reciben el PATH persistente; una aplicación
que ya estaba abierta necesita cargar el script anterior o volver a abrirse.

El build obtiene la revisión exacta `adfffbe41b2cabcd51fff326ab045662265062bb`
de llama.cpp y rechaza un checkout con modificaciones. Detecta la arquitectura
CUDA de la GPU; en este equipo genera `89-real`. Usa Release, instrucciones CPU
nativas, CUDA Graphs y selección automática de kernels. No modifica kernels.
La salida está fuera del repositorio, en `build-Auto-sm89/bin/`. El informe de
flags y hashes está en `reports/coder-phase2/build-Auto.json`.

No hacen falta CUDA ni Nsight para usar normalmente el IDE. Una vez descargados
los paquetes y fuentes, la compilación y el agente pueden funcionar offline.
Cambiar la GPU o CPU requiere recompilar este build específico del equipo.

## Medir sin cambiar el runtime habitual

```powershell
$tools = Get-Content config/inference-toolchain.local.json -Raw | ConvertFrom-Json
$nativeServer = Join-Path $tools.installRoot 'build-Auto-sm89\bin\llama-server.exe'

# Necesita :8080 libre. Carga y detiene una configuración a la vez.
node scripts/benchmark-local-engine.mjs --tune --binary $nativeServer `
  --candidates balanced --repetitions 3 --out reports/native-engine.json

# Calidad real: tests, aserciones originales y oráculos independientes.
node scripts/benchmark-local-engine.mjs --tune --binary $nativeServer `
  --contexts 8192,16384 --kvs f16 --quick --repetitions 3 `
  --coding-app chat --coding-suite extended --coding-seeds 42,43 `
  --out reports/native-coding.json

# Experimentos explícitos de runtime; no cambian los presets.
node scripts/benchmark-local-engine.mjs --tune --binary $nativeServer `
  --runtime-experiments --candidates balanced,no-graphs,backend-sampling `
  --quick --repetitions 3 --out reports/runtime-experiments.json
```

Los informes distinguen el microbenchmark de la evaluación del agente. Registran
medianas, warm-up, TTFT, hashes de salida greedy, VRAM, RAM del proceso, parámetros
y calidad cuando se solicitó. Las ejecuciones del agente mantienen el mismo path
de workspace entre configuraciones y archivan cada resultado antes de limpiarlo.
No usar la misma raíz de evaluación desde dos procesos simultáneos.

El script también permite compilar variantes MMQ, CUBLAS y NoGraphs. Su existencia
no demuestra una ganancia. No se activan en producción sin una comparación válida.

## Profiling

```powershell
$bench = Join-Path (Get-Location) 'bin\llama-bench.exe'
$model = Join-Path (Get-Location) 'models\Ornith-1.5-9B-Q4_K_M.gguf'
& $tools.nsys status --environment
& $tools.nsys profile --trace=cuda,nvtx --sample=none --cpuctxsw=none `
  --cuda-graph-trace=node --output reports/profile `
  $bench -m $model -ngl 99 -p 0 -n 0 -pg 512,128 -r 3 `
  -b 512 -ub 256 -t 4 -ctk f16 -ctv f16 -fa on -o json
& $tools.nsys stats --report cuda_gpu_kern_sum,cuda_api_sum,cuda_gpu_mem_time_sum `
  --format csv --output reports/profile-stats reports/profile.nsys-rep

& $tools.ncu --config-file off --set basic --kernel-name regex:mul_mat_vec_q `
  --launch-skip 300 --launch-count 6 --cache-control none --clock-control none `
  --export reports/matvec $bench -m $model -ngl 99 -p 0 -n 0 -pg 512,128 `
  -r 1 -b 512 -ub 256 -t 4 -ctk f16 -ctv f16 -fa on -o json
```

Nsight Compute puede generar `.ncu-repz` en esta versión. Consultar los informes
de rendimiento fuera del profiler: la instrumentación y los replays cambian los
tiempos. Los contadores muestreados no prueban por sí solos que un patch sea útil.

Fuentes: [paquetes CUDA 12.9.1](https://developer.download.nvidia.com/compute/cuda/redist/redistrib_12.9.1.json),
[paquetes de profilers](https://developer.download.nvidia.com/compute/cuda/redist/redistrib_13.4.1.json),
[CUDA para Windows](https://docs.nvidia.com/cuda/archive/12.9.1/cuda-installation-guide-microsoft-windows/index.html),
[Nsight Systems](https://docs.nvidia.com/nsight-systems/UserGuide/),
[Nsight Compute CLI](https://docs.nvidia.com/nsight-compute/NsightComputeCli/)
y [build de llama.cpp](https://github.com/ggml-org/llama.cpp/blob/adfffbe41b2cabcd51fff326ab045662265062bb/docs/build.md).
