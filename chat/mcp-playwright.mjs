import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const modules = process.env.BONSAI_MCP_NODE_MODULES || fileURLToPath(new URL("./node_modules", import.meta.url));
const cli = path.join(modules,"@playwright","mcp","cli.js");

// The server and browser live only for the current agent turn. It never attaches
// to the user's browser profile and does not enable arbitrary code evaluation.
export class McpPlaywright {
  constructor({root, blockedPorts = [], signal}) {
    this.root = root; this.blockedPorts = blockedPorts.map(String); this.signal = signal;
  }
  async start() {
    if (this.client) return;
    const [{Client},{StdioClientTransport}] = await Promise.all([
      import(pathToFileURL(path.join(modules,"@modelcontextprotocol/sdk/dist/esm/client/index.js")).href),
      import(pathToFileURL(path.join(modules,"@modelcontextprotocol/sdk/dist/esm/client/stdio.js")).href),
    ]);
    this.outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "bonsai-mcp-"));
    const blocked = this.blockedPorts.flatMap(p => [`http://127.0.0.1:${p}`, `http://localhost:${p}`, `http://[::1]:${p}`]).join(";");
    const config = path.join(this.outputDir,"config.json");
    fs.writeFileSync(config, JSON.stringify({browser:{launchOptions:{args:["--disable-gpu"]}}}));
    const edge = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe","C:/Program Files/Microsoft/Edge/Application/msedge.exe"].find(p=>fs.existsSync(p));
    const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
    const executable = process.env.BONSAI_BROWSER || edge || (fs.existsSync(chrome) ? chrome : "");
    const args = [cli, "--config", config, "--headless", "--isolated", "--image-responses", "omit", "--no-webmcp", "--block-service-workers", "--output-dir", this.outputDir];
    if (executable) args.push("--executable-path", executable);
    else args.push("--browser", "msedge");
    if (blocked) args.push("--blocked-origins", blocked);
    const transport = new StdioClientTransport({command:process.execPath,args,cwd:this.root,stderr:"pipe"});
    transport.stderr?.on("data", () => {});
    const client = new Client({name:"bonsai-local-ide",version:"1.1.0"});
    try { await client.connect(transport); this.client = client; }
    catch (err) { await transport.close().catch(() => {}); this.cleanOutput(); throw err; }
  }
  async call(a) {
    this.signal?.throwIfAborted();
    const names = {abrir:"browser_navigate", inspeccionar:"browser_snapshot", clic:"browser_click", escribir:"browser_type", tecla:"browser_press_key", esperar:"browser_wait_for", consola:"browser_console_messages", red:"browser_network_requests", cerrar:"browser_close"};
    const name = names[a.accion];
    if (!name) throw new Error("Acción MCP desconocida");
    let args = {};
    if (a.accion === "abrir") {
      const url = new URL(a.url || "");
      if (!["http:","https:"].includes(url.protocol) || url.username || url.password) throw new Error("Usa una URL HTTP/HTTPS sin credenciales");
      if (["localhost","127.0.0.1","[::1]"].includes(url.hostname) && this.blockedPorts.includes(url.port || (url.protocol === "https:" ? "443" : "80"))) throw new Error("El puerto pertenece al IDE o al modelo");
      args = {url:url.href};
    } else if (a.accion === "clic") args = {target:a.selector || ""};
    else if (a.accion === "escribir") args = {target:a.selector || "",text:a.texto ?? ""};
    else if (a.accion === "tecla") args = {key:a.texto || ""};
    else if (a.accion === "esperar") args = a.texto ? {text:a.texto} : {time:Math.min(30, Math.max(0, Number(a.segundos) || 1))};
    else if (a.accion === "consola") args = {level:"error"};
    else if (a.accion === "red") args = {static:false};
    if (["clic","escribir"].includes(a.accion) && !args.target) throw new Error("Indica selector o referencia del snapshot");
    if (a.accion === "tecla" && !args.key) throw new Error("Indica la tecla en texto");
    await this.start();
    const result = await this.client.callTool({name,arguments:args}, undefined, {signal:this.signal, timeout:60000});
    let text = (result.content || []).filter(c => c.type === "text").map(c => c.text).join("\n");
    if (result.isError) throw new Error(text || "Falló la herramienta MCP");
    // Recent Playwright MCP versions return generated snapshots as file links.
    // Read only generated files in our private output directory, never arbitrary links.
    for (const match of text.matchAll(/\]\(([^)]+)\)/g)) {
      const name = path.basename(match[1].replace(/\\/g, "/"));
      if (!/^(?:page|console|network)-[a-z0-9_.-]+\.(?:yml|txt|log)$/i.test(name)) continue;
      const file = path.join(this.outputDir, name);
      try {
        const st = fs.lstatSync(file);
        if (st.isFile() && !st.isSymbolicLink() && st.size <= 2_000_000) text += `\nContenido ${name}:\n${fs.readFileSync(file,"utf8").slice(0,40000)}`;
      } catch { /* A link may not refer to a local generated file. */ }
    }
    return text || "Acción completada; sin salida de texto.";
  }
  cleanOutput() {
    const dir = this.outputDir; this.outputDir = null;
    if (dir && path.dirname(path.resolve(dir)) === path.resolve(os.tmpdir()) && path.basename(dir).startsWith("bonsai-mcp-")) fs.rmSync(dir,{recursive:true,force:true});
  }
  async close() { const client = this.client; this.client = null; try { if (client) await client.close(); } finally { this.cleanOutput(); } }
}
