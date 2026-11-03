/** Router del IDE: cada grupo recibe el mismo contexto explícito del servidor. */
import { createStaticRoutes } from "./static.mjs";
import { createFilesRoutes } from "./files.mjs";
import { createGitRoutes } from "./git.mjs";
import { createModelsRoutes } from "./models.mjs";
import { createSettingsRoutes } from "./settings.mjs";
import { createChatRoutes } from "./chat.mjs";
import { createContractRoutes } from "./contracts.mjs";

/**
 * @param {Record<string, any>} ctx
 * @returns {(req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse, url: URL) => Promise<boolean>}
 */
export function createRoutes(ctx) {
  const grupos = [
    createContractRoutes(ctx),
    createStaticRoutes(ctx),
    createFilesRoutes(ctx),
    createGitRoutes(ctx),
    createModelsRoutes(ctx),
    createSettingsRoutes(ctx),
    createChatRoutes(ctx),
  ];
  return async function route(req, res, url) {
    for (const handle of grupos) {
      if (await handle(req, res, url)) return true;
    }
    return false;
  };
}
