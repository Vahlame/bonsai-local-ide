/**
 * Construcción del comando reproducible de llama-server para el perfil elegido.
 * La interfaz corre en el navegador y no conoce el disco: este módulo traduce
 * preset + modelo a una línea de PowerShell con rutas absolutas.
 *
 * El comando debe reproducir el MISMO perfil que arranca el lanzador real:
 * si aquí se fija -t 4, --gpu-layers 99 o --reasoning-budget 4096 mientras el
 * perfil medido usa 8 hilos, un ngl parcial o -1, el usuario pega una línea que
 * no mide lo mismo (o no arranca). Todo sale de catalogo.<clave>.servidor/plan.
 */
import fs from "node:fs";
import path from "node:path";

/**
 * @param {{
 *   projectRoot: string,
 *   catalog: Record<string, any>,
 *   isNamedEnginePreset: (nombre: string) => boolean,
 *   engineProfile: (nombre: string) => Record<string, any>,
 *   selectBinary: (root: string) => {exe: string},
 *   LifecycleError: new (message: string, state: any, status: number) => Error,
 * }} ctx
 */
export function createLauncherService(ctx) {
  /**
   * @param {string} preset
   * @param {number} puerto
   * @param {string} [clave]
   * @returns {string}
   */
  function comandoServidorOptimizado(preset, puerto, clave = "ornith9b") {
    const modeloItem = ctx.catalog.catalogo?.[clave];
    if (!modeloItem) {
      throw new ctx.LifecycleError(`Modelo desconocido: ${clave}`, { state: "error", port: puerto }, 400);
    }
    const planGuardado = modeloItem.plan;
    const servidor = modeloItem.servidor || {};
    const nombre = ctx.isNamedEnginePreset(preset)
      ? preset
      : (preset === "AUTO" || preset === "CUSTOM") && planGuardado
        ? ""
        : "8GB-VISION-MAX-Q8-100K";
    const p = nombre
      ? ctx.engineProfile(nombre)
      : {
          context: Number(planGuardado?.contexto) || 16384,
          kv: String(planGuardado?.kv || "q8_0"),
          vision: planGuardado?.vision !== false,
          mmprojCPU: planGuardado?.mmprojCPU === true,
          batch: Number(servidor.batch) || 512,
          ubatch: Number(servidor.ubatch) || 256,
        };
    const ctxWindow = Number(p.context) || 16384;
    const kv = String(p.kv || "f16");
    const vision = Boolean(p.vision);
    const esParcial = servidor.tipo === "gpu-parcial";
    const ngl = esParcial ? Math.max(1, Math.min(511, Number(servidor.ngl) || 0)) : 99;
    const hilos = Math.max(1, Number(servidor.threads) || Number(p.threads) || (servidor.moe ? 8 : 4));

    const modelPath = path.join(ctx.projectRoot, "models", modeloItem.archivo || "Ornith-1.5-9B-Q4_K_M.gguf");
    const projArchivo = modeloItem.vision && modeloItem.vision.archivo;
    const projPath = projArchivo ? path.join(ctx.projectRoot, "models", projArchivo) : "";
    const templatePath = path.join(ctx.projectRoot, "logs", `chat_template_${puerto}.jinja`);
    const { exe: bin } = ctx.selectBinary(ctx.projectRoot, { preferred: String(servidor.binario || "") });

    const a = ["-m", modelPath, "--gpu-layers", String(ngl)];
    if (esParcial) {
      a.push("--fit", "off", "--load-mode", "mmap");
      const cacheRam = Number.isFinite(Number(servidor.cacheRamMiB)) ? Math.max(0, Number(servidor.cacheRamMiB)) : 0;
      a.push("--cache-ram", String(cacheRam));
      if (cacheRam > 0 && servidor.cacheRecurrentPrefix === true) a.push("--cache-recurrent-prefix");
    }
    const moe = servidor.moe || planGuardado?.moe || null;
    if (moe?.activo) {
      const capas = Math.max(1, Number(moe.capas) || 1);
      const nCpuMoe = Math.max(0, Math.min(capas, Number(moe.nCpuMoe) || 0));
      a.push("--fit", "off", "--load-mode", String(moe.loadMode || "mmap"));
      if (nCpuMoe >= capas) a.push("--cpu-moe");
      else if (nCpuMoe > 0) a.push("--n-cpu-moe", String(nCpuMoe));
      if (!esParcial) a.push("--cache-ram", "0");
    }
    a.push("--flash-attn", "on", "-c", String(ctxWindow), "-ctk", kv, "-ctv", kv);
    a.push(
      "-b", String(Number(p.batch) || 512),
      "-ub", String(Number(p.ubatch) || 256),
      "-t", String(hilos),
      "--host", "127.0.0.1",
      "--port", String(puerto),
      "--jinja",
      "--metrics",
    );
    a.push(
      "-lv", "4",
      "--cors-origins", `http://127.0.0.1:${puerto},http://localhost:${puerto},http://127.0.0.1:8787,http://localhost:8787,http://127.0.0.1:8788,http://localhost:8788`,
      "--temp", "0.6", "--top-p", "0.90", "--top-k", "20", "--min-p", "0.05",
      "--presence-penalty", "0", "--repeat-penalty", "1", "--spec-type", "none", "--no-context-shift",
      "--ctx-checkpoints", "0",
    );

    // La plantilla se genera desde modelo.json para que exista al pegar el comando.
    // Si el modelo no trae plantilla, no se añade una ruta que no existe.
    let plantillaEscrita = false;
    if (modeloItem.chat_template) {
      try {
        fs.mkdirSync(path.dirname(templatePath), { recursive: true });
        fs.writeFileSync(templatePath, modeloItem.chat_template, "utf8");
        plantillaEscrita = true;
      } catch {
        /* se intentará igualmente, pero no se referencia un archivo que no se escribió */
      }
    }
    if (plantillaEscrita) a.push("--chat-template-file", templatePath);
    if (modeloItem.clave === "gpt-oss-20b" || (Array.isArray(modeloItem.capacidades) && modeloItem.capacidades.includes("Harmony"))) {
      a.push("--skip-chat-parsing");
    }
    if (vision && projPath && fs.existsSync(projPath)) {
      a.push("--mmproj", projPath);
      if (p.mmprojCPU) a.push("--no-mmproj-offload");
      else a.push("--mmproj-offload", "--mmproj-device", "CUDA0");
      a.push("--image-max-tokens", "512");
    }
    if (servidor.noPreserveThinking === true) a.push("--no-reasoning-preserve");

    // MTP: la cabeza nextn viaja en el mismo GGUF y exige un solo slot.
    if (servidor.mtp === true) {
      a.push("--spec-type", "draft-mtp", "--spec-draft-n-max", String(Math.max(1, Number(servidor.specDraftNMax) || 4)));
      if (servidor.specDraftPMin !== undefined) a.push("--spec-draft-p-min", String(servidor.specDraftPMin));
      a.push("--parallel", "1");
    } else if (p.spec === "draft" && p.draftModel) {
      const draftPath = path.join(ctx.projectRoot, "models", String(p.draftModel));
      try {
        if (fs.existsSync(draftPath)) {
          a.push("--spec-type", "draft-simple", "--spec-draft-model", draftPath, "--spec-draft-n-max", String(p.draftTokens || 4));
        }
      } catch {
        /* sin draft */
      }
    } else if (servidor.draftModel) {
      const draftPath = path.join(ctx.projectRoot, "models", String(servidor.draftModel));
      try {
        if (fs.existsSync(draftPath)) {
          a.push("--spec-type", "draft-simple", "--spec-draft-model", draftPath, "--spec-draft-n-max", String(servidor.draftTokens || 4));
        }
      } catch {
        /* sin draft */
      }
    }

    // El presupuesto de razonamiento también sale del perfil. Los perfiles que
    // recomiendan pensar sin límite usan -1; los que no piensan no llevan flag.
    const pensar = modeloItem.pensar;
    const presupuesto = Number(pensar?.presupuesto);
    if (pensar?.compatible === true || Number.isFinite(presupuesto)) {
      const valor = Number.isFinite(presupuesto) ? presupuesto : -1;
      if (valor !== 0) {
        a.push("--reasoning-budget", String(valor), "--reasoning-format", "deepseek");
        const nivel = pensar?.nivel;
        if (nivel && nivel !== "default") a.push("--reasoning-effort", String(nivel));
      }
    }

    const quote = (s) => (/[\s"]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s);
    const linea = [bin, ...a].map(quote).join(" ");
    const entorno = servidor.mmapTrimGpu === true ? "$env:LLAMA_MMAP_TRIM_GPU='1'; " : "";
    return `${entorno}cd "${ctx.projectRoot}"; & ${linea}`;
  }

  return { comandoServidorOptimizado };
}
