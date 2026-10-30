/** Copia solamente el código y los recursos necesarios para ejecutar la interfaz de evaluación. */
import fs from "node:fs";
import path from "node:path";

// Mantener esta lista al agregar dependencias o recursos a la interfaz. No copiar por extensión:
// el directorio de la app puede contener archivos personales de cualquier tipo o nombre.
const ARCHIVOS = [
  "actions.mjs", "adaptadores.mjs", "almacen-json.mjs", "archivos-seguros.mjs", "bonsai-chat.mjs",
  "cambio-modelo.mjs", "context.mjs", "diagnosticos.mjs", "editar.mjs", "entorno.mjs", "escritura-incremental.mjs", "git-seguro.mjs", "guardia.mjs", "historial.mjs", "lecturas.mjs",
  "code-context.mjs", "coder-harness.mjs", "coder-profile.json", "project-verification.mjs", "code-intelligence.mjs", "engine-profiles.mjs",
  "investigacion.mjs", "mcp-playwright.mjs", "memoria-global.mjs", "registros.mjs", "modelo.mjs", "modelo.json", "navegador.mjs", "ocr.mjs", "procesos.mjs", "sse.mjs", "terminal.mjs", "ui-server.mjs",
  "ui/app.js", "ui/chat-core.js", "ui/iconos.js", "ui/ide.css", "ui/ide.js", "ui/index.html", "ui/markdown.js", "ui/paneles.js",
  "ui/tema.css", "ui/fuentes/fuentes.css", "ui/fuentes/inter-latin.woff2",
  "ui/fuentes/jetbrains-mono-latin.woff2",
];

export function copiarApp(origen, destino) {
  if (fs.existsSync(destino)) throw new Error(`La carpeta de evaluación ya existe: ${destino}. Elige otra carpeta de salida.`);
  for (const rel of ARCHIVOS) {
    // No seguir enlaces, incluidos enlaces a directorios intermedios.
    let actual = origen;
    for (const parte of rel.split("/")) {
      actual = path.join(actual, parte);
      if (fs.lstatSync(actual).isSymbolicLink()) throw new Error(`La aplicación contiene un enlace no admitido: ${actual}`);
    }
    if (!fs.statSync(actual).isFile()) throw new Error(`Falta un archivo de la aplicación: ${actual}`);
  }
  fs.mkdirSync(destino, { recursive: false });
  for (const rel of ARCHIVOS) {
    const salida = path.join(destino, rel);
    fs.mkdirSync(path.dirname(salida), { recursive: true });
    fs.copyFileSync(path.join(origen, rel), salida, fs.constants.COPYFILE_EXCL);
  }
  const presets = fs.existsSync(path.join(origen,"engine-presets.json")) ? path.join(origen,"engine-presets.json") : path.join(origen,"../config/local-engine-presets.json");
  if (fs.lstatSync(presets).isSymbolicLink()) throw new Error("Los presets no pueden ser un enlace");
  fs.copyFileSync(presets,path.join(destino,"engine-presets.json"),fs.constants.COPYFILE_EXCL);
}
