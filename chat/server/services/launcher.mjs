/**
 * Construcción del comando reproducible de llama-server para el perfil elegido.
 * La interfaz corre en el navegador y no conoce el disco: este módulo traduce
 * preset + modelo a una línea de PowerShell con rutas absolutas.
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
          batch: Number(modeloItem.servidor?.batch) || 512,
          ubatch: Number(modeloItem.servidor?.ubatch) || 256,
        };
    const ctxWindow = Number(p.context) || 16384;
    const kv = String(p.kv || "f16");
    const vision = Boolean(p.vision);

    const modelPath = path.join(ctx.projectRoot, "models", modeloItem.archivo || "Ornith-1.5-9B-Q4_K_M.gguf");
    const projArchivo = modeloItem.vision && modeloItem.vision.archivo;
    const projPath = projArchivo ? path.join(ctx.projectRoot, "models", projArchivo) : "";
    const templatePath = path.join(ctx.projectRoot, "logs", `chat_template_${puerto}.jinja`);
    const { exe: bin } = ctx.selectBinary(ctx.projectRoot);

    const a = ["-m", modelPath, "--gpu-layers", "99"];
    a.push("--flash-attn", "on", "-c", String(ctxWindow), "-ctk", kv, "-ctv", kv);
    a.push(
      "-b", String(Number(p.batch) || 512),
      "-ub", String(Number(p.ubatch) || 256),
      "-t", "4",
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
    try {
      if (modeloItem.chat_template) {
        fs.mkdirSync(path.dirname(templatePath), { recursive: true });
        fs.writeFileSync(templatePath, modeloItem.chat_template, "utf8");
      }
    } catch {
      /* se intentará igualmente */
    }
    a.push("--chat-template-file", templatePath);
    if (modeloItem.clave === "gpt-oss-20b" || (Array.isArray(modeloItem.capacidades) && modeloItem.capacidades.includes("Harmony"))) {
      a.push("--skip-chat-parsing");
    }
    if (vision && projPath) {
      a.push("--mmproj", projPath);
      if (p.mmprojCPU) a.push("--no-mmproj-offload");
      else a.push("--mmproj-offload", "--mmproj-device", "CUDA0");
      a.push("--image-max-tokens", "512");
    }
    if (p.spec === "draft" && p.draftModel) {
      const draftPath = path.join(ctx.projectRoot, "models", String(p.draftModel));
      try {
        if (fs.existsSync(draftPath)) {
          a.push("--spec-type", "draft-simple", "--spec-draft-model", draftPath, "--spec-draft-n-max", String(p.draftTokens || 4));
        }
      } catch {
        /* sin draft */
      }
    } else if (modeloItem.servidor?.draftModel) {
      const draftPath = path.join(ctx.projectRoot, "models", String(modeloItem.servidor.draftModel));
      try {
        if (fs.existsSync(draftPath)) {
          a.push("--spec-type", "draft-simple", "--spec-draft-model", draftPath, "--spec-draft-n-max", String(modeloItem.servidor.draftTokens || 4));
        }
      } catch {
        /* sin draft */
      }
    }
    a.push("--reasoning-budget", "4096", "--reasoning-format", "deepseek");

    const quote = (s) => (/[\s"]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s);
    const linea = [bin, ...a].map(quote).join(" ");
    return `cd "${ctx.projectRoot}"; & ${linea}`;
  }

  return { comandoServidorOptimizado };
}
