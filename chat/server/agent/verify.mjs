/**
 * Verificación del CoderTask con el mismo permiso, tarjeta y ejecutor que el
 * cierre normal. Vive aparte porque la usan tanto `present` como el atajo de
 * verificación del bucle.
 */
import { runCheck } from "../../coder-harness.mjs";
import { clipText } from "../text.mjs";
import { emitActionEvent } from "./action-rows.mjs";

/**
 * @param {{
 *   ctx: Record<string, any>,
 *   ac: AbortController,
 *   idTurno: string,
 *   send: (event: Record<string, unknown>) => void,
 *   nextStep: () => number,
 * }} input
 */
export function createVerifyCoder({ ctx, ac, idTurno, send, nextStep }) {
  return async function verifyCoder(coder, final, actions) {
    return coder.verify({
      final,
      run: async (file, argv, options) => {
        const title = [file, ...argv].join(" ");
        const row = {
          id: `${idTurno}-a${nextStep()}`,
          kind: "cmd",
          title,
          state: ctx.permitMode === "ask" ? "permit" : "run",
          detail: "",
        };
        actions.push(row);
        emitActionEvent(send, row);
        if (ctx.permitMode === "ask" && !await ctx.waitPermit(row.id, ac.signal)) {
          row.state = "denied";
          row.detail = "Verificación no autorizada";
          emitActionEvent(send, row);
          return { command: title, code: -1, output: row.detail };
        }
        const result = await runCheck(file, argv, options);
        row.state = "done";
        row.detail = clipText(result.output);
        row.code = result.code;
        emitActionEvent(send, row);
        return result;
      },
    });
  };
}
