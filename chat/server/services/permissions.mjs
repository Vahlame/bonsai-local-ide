/**
 * Permisos de acciones del agente. El modo (`ask`/`all`) se persiste y las
 * esperas se resuelven por id, con timeout y cancelación del turno.
 *
 * Antes el listener de `abort` no se retiraba al resolver por timeout; aquí se
 * limpia siempre para no acumular listeners en turnos largos.
 */
import fs from "node:fs";
import { escribirJsonAtomico } from "../../almacen-json.mjs";

/**
 * @param {{stateFile: string, timeoutMs?: number}} ctx
 */
export function createPermissionService(ctx) {
  const timeoutMs = ctx.timeoutMs ?? 180_000;
  /** @type {"ask" | "all"} */
  let mode = "ask";
  try {
    const saved = JSON.parse(fs.readFileSync(ctx.stateFile, "utf8"));
    if (saved && (saved.mode === "ask" || saved.mode === "all")) mode = saved.mode;
  } catch {
    /* preguntar es el perfil inicial */
  }
  /** @type {Map<string, (allow: boolean) => void>} */
  const permits = new Map();

  /** @param {"ask" | "all"} nuevo */
  function setMode(nuevo) {
    if (nuevo !== "ask" && nuevo !== "all") throw new Error("Modo de permisos inválido");
    mode = nuevo;
    escribirJsonAtomico(ctx.stateFile, { mode }, { copia: false, espacio: 0 });
  }

  /**
   * Espera la decisión del usuario para una acción.
   * @param {string} id
   * @param {AbortSignal} signal
   * @returns {Promise<boolean>}
   */
  function wait(id, signal) {
    return new Promise((resolve) => {
      // Si el turno ya se canceló, `abort` no vuelve a dispararse: sin esta
      // comprobación el servidor se quedaba con busy=true hasta el timeout.
      if (signal.aborted) {
        resolve(false);
        return;
      }
      let settled = false;
      const finish = (allow) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        permits.delete(id);
        signal.removeEventListener("abort", onAbort);
        resolve(allow);
      };
      const onAbort = () => finish(false);
      const timer = setTimeout(() => finish(false), timeoutMs);
      // Un id repetido no debe dejar la promesa anterior colgada.
      permits.get(id)?.(false);
      permits.set(id, finish);
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }

  /** Cancela todas las esperas (apagado del servidor). */
  function cancelAll() {
    for (const finish of [...permits.values()]) finish(false);
    permits.clear();
  }

  return {
    permits,
    get mode() { return mode; },
    setMode,
    wait,
    cancelAll,
  };
}
