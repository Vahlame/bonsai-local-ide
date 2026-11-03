/**
 * Política central de rutas y comandos sensibles.
 *
 * El agente, el editor y el servidor estático comparten la misma lista: un
 * secreto no se protege en una ruta y se filtra por otra. La regla es denegar
 * por defecto los metadatos de Git, los archivos de entorno, credenciales y
 * claves privadas. El usuario puede seguir viéndolos fuera del IDE o con una
 * acción explícita del sistema, pero el modelo no los recibe por accidente.
 *
 * Esta lista es deliberadamente conservadora. Un falso positivo (por ejemplo,
 * negar `deploy.key` cuando era una clave pública) es preferible a exfiltrar
 * `.env` mediante una inyección de prompt.
 */

const SEGMENTOS_PROHIBIDOS = new Set([
  ".git",
  ".ssh",
  ".aws",
  ".azure",
  ".gnupg",
  ".kube",
  ".docker",
  ".npmrc",
  ".pypirc",
  ".netrc",
  ".git-credentials",
  "credentials",
  "credentials.json",
  "secrets.json",
  "secret.json",
  "id_rsa",
  "id_dsa",
  "id_ecdsa",
  "id_ed25519",
  "known_hosts",
]);

const EXTENSIONES_PROHIBIDAS = new Set([
  ".pem",
  ".key",
  ".pfx",
  ".p12",
  ".jks",
  ".keystore",
  ".kdbx",
  ".ppk",
]);

/** Plantillas de entorno sin secretos: se pueden leer y escribir. */
const ENV_EJEMPLO = /^\.env\.(?:example|sample|template|dist)$/;

/**
 * Normaliza un segmento de ruta como lo hace Windows para comparar: sin
 * puntos/espacios finales y en minúsculas. En sistemas POSIX se aplica igual:
 * la política es más estricta que el sistema de archivos, no menos.
 * @param {string} parte
 * @returns {string}
 */
function normalizar(parte) {
  return String(parte || "").replace(/[. ]+$/, "").toLowerCase();
}

/**
 * ¿La ruta relativa apunta a un secreto o metadato sensible?
 * @param {string} rel
 * @returns {boolean}
 */
export function esRutaSensible(rel) {
  const limpia = String(rel || "").replace(/\\/g, "/").replace(/^\.\/+/, "");
  if (!limpia) return false;
  const partes = limpia.split("/").filter(Boolean).map(normalizar);
  for (const [indice, parte] of partes.entries()) {
    if (!parte) continue;
    if (parte === ".git") return true;
    if (parte.startsWith(".env") && !ENV_EJEMPLO.test(parte)) return true;
    if (SEGMENTOS_PROHIBIDOS.has(parte)) return true;
    const ext = parte.includes(".") ? parte.slice(parte.lastIndexOf(".")) : "";
    if (EXTENSIONES_PROHIBIDAS.has(ext)) return true;
    // Un directorio `.docker` contiene config.json con credenciales de registry;
    // ya está en la lista de segmentos. `.config` es demasiado amplio.
    if (indice === 0 && (parte === ".git" || parte === ".env")) return true;
  }
  return false;
}

/**
 * ¿El texto de un comando menciona una ruta sensible? No pretende ser un
 * sandbox de shell: evita el accidente y el ataque trivial (`type .env`,
 * `cat .env`, `Get-Content .env`, `node -e "fs.readFileSync('.env')"`).
 * @param {string} command
 * @returns {boolean}
 */
export function esComandoSensible(command) {
  const texto = String(command || "");
  if (!texto) return false;
  // Las plantillas .env.example no son secretos: se retiran antes de mirar.
  const limpio = texto.replace(/\.env\.(?:example|sample|template|dist)\b/gi, "");
  const separador = String.raw`(?:^|[\\/\s"'=<>|&;,(])`;
  const fin = String.raw`(?=$|[\\/\s"'<>|&;,)])`;
  // `.env`, `.env.local`, `.env.production`… pero no `process.env`.
  if (new RegExp(`${separador}\\.env(?:\\.[\\w.-]+)?${fin}`, "i").test(limpio)) return true;
  if (new RegExp(`${separador}\\.git[\\\\/]`, "i").test(limpio)) return true;
  if (new RegExp(`${separador}(?:id_rsa|id_dsa|id_ecdsa|id_ed25519|credentials(?:\\.json)?|secrets?\\.json|\\.npmrc|\\.pypirc|\\.netrc|\\.git-credentials)${fin}`, "i").test(limpio)) return true;
  if (new RegExp(`[\\w.-]+\\.(?:pem|key|pfx|p12|jks|keystore|kdbx|ppk)${fin}`, "i").test(limpio)) return true;
  return false;
}
