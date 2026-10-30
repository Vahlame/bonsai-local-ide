import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { McpPlaywright } from "./mcp-playwright.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "bonsai-mcp-"));
const server = http.createServer((req,res) => {
  res.writeHead(200,{"Content-Type":"text/html; charset=utf-8"});
  res.end('<!doctype html><button id="add" onclick="document.querySelector(\'#value\').textContent=\'2\'">Sumar</button><output id="value">1</output>');
});
await new Promise(r=>server.listen(0,"127.0.0.1",r));
const browser = new McpPlaywright({root,blockedPorts:[8787,8080]});
try {
  const address = `http://127.0.0.1:${server.address().port}`;
  const page = await browser.call({accion:"abrir",url:address});
  assert.match(page,/Sumar/);
  await browser.call({accion:"clic",selector:"#add"});
  const snap = await browser.call({accion:"inspeccionar"});
  assert.match(snap, /2/);
  await browser.call({accion:"consola"});
  await assert.rejects(()=>browser.call({accion:"abrir",url:"http://127.0.0.1:8080"}),/puerto/);
  console.log("Playwright MCP: abrir, clic, inspección, consola y puertos protegidos OK");
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise(r=>server.close(r));
  if (path.dirname(path.resolve(root)) !== path.resolve(os.tmpdir())) throw new Error("ruta temporal inesperada");
  fs.rmSync(root,{recursive:true,force:true});
}
