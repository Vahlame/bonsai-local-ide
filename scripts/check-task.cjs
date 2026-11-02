/**
 * Verifica una tarea generada por el agente con Edge headless.
 * Uso: node scripts/check-task.cjs <fluid|game|app|skyblock> <html> <png>
 */
const fs = require("fs");
const http = require("http");
const path = require("path");
const { loadPlaywright, browserPath } = require("./lib/playwright.cjs");
const { chromium } = loadPlaywright();

const task = process.argv[2] || "app";
const html = path.resolve(process.argv[3] || "");
const png = path.resolve(process.argv[4] || "task-check.png");
const root = path.dirname(html);
const edge = browserPath();
const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml" };

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const rel = decodeURIComponent((req.url || "/").split("?")[0]).replace(/^\/+/, "") || "index.html";
      if (rel === "favicon.ico") {
        res.writeHead(204).end();
        return;
      }
      const file = path.resolve(root, rel);
      if (!file.startsWith(root + path.sep) && file !== root) {
        res.writeHead(403).end("forbidden");
        return;
      }
      fs.readFile(file, (err, data) => {
        if (err) {
          res.writeHead(404).end("not found");
          return;
        }
        res.writeHead(200, { "Content-Type": mime[path.extname(file).toLowerCase()] || "application/octet-stream" });
        res.end(data);
      });
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

(async () => {
  const server = await serve();
  const port = server.address().port;
  const browser = await chromium.launch({
    executablePath: edge,
    headless: true,
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(String(e)));
  const result = { task, ok: false, errors, info: null };
  try {
    await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: "load", timeout: 30000 });
    await page.waitForTimeout(1500);
    if (task === "app") {
      const input = await page.$("#nueva-tarea");
      const add = await page.$("#agregar");
      const list = await page.$("#lista");
      result.info = { input: Boolean(input), add: Boolean(add), list: Boolean(list) };
      if (input && add && list) {
        await page.fill("#nueva-tarea", "Tarea de prueba");
        await page.click("#agregar");
        await page.waitForTimeout(600);
        const before = (await page.textContent("#lista")) || "";
        await page.reload({ waitUntil: "load" });
        await page.waitForTimeout(600);
        const after = (await page.textContent("#lista")) || "";
        result.info.before = before.slice(0, 500);
        result.info.after = after.slice(0, 500);
        result.info.persisted = after.includes("Tarea de prueba");
        result.info.added = before.includes("Tarea de prueba");
      }
      result.ok = Boolean(result.info.input && result.info.add && result.info.list && result.info.added);
    } else if (task === "game") {
      const canvas = await page.$("canvas");
      const score = await page.$("#puntuacion");
      const state = await page.$("#estado");
      result.info = { canvas: Boolean(canvas), score: Boolean(score), state: Boolean(state) };
      if (canvas) {
        const box = await canvas.boundingBox();
        result.info.canvasSize = box ? [Math.round(box.width), Math.round(box.height)] : null;
        await page.keyboard.press("Space");
        await page.waitForTimeout(800);
        await page.keyboard.press("ArrowRight");
        await page.waitForTimeout(800);
        result.info.scoreText = score ? (await page.textContent("#puntuacion"))?.trim() : null;
        result.info.stateText = state ? (await page.textContent("#estado"))?.trim() : null;
      }
      result.ok = Boolean(canvas && result.info.canvasSize && result.info.canvasSize[0] > 300);
    } else if (task === "fluid") {
      const canvas = await page.$("canvas");
      const fps = await page.$("#fps");
      const parts = await page.$("#particulas");
      result.info = { canvas: Boolean(canvas), fps: Boolean(fps), particulas: Boolean(parts) };
      if (canvas) {
        await page.evaluate(() => {
          const el = [...document.querySelectorAll('button, [role="button"], input[type="button"]')]
            .find((e) => /reiniciar/i.test((e.textContent || e.value || '').trim()));
          if (el) el.click();
        });
        await page.waitForTimeout(1200);
        const box = await canvas.boundingBox();
        result.info.canvasSize = box ? [Math.round(box.width), Math.round(box.height)] : null;
        result.info.fpsText = fps ? (await page.textContent("#fps"))?.trim() : null;
        result.info.particulasText = parts ? (await page.textContent("#particulas"))?.trim() : null;
        result.info.rafFrames = await page.evaluate(async () => {
          let n = 0;
          const start = performance.now();
          await new Promise((resolve) => {
            function tick(t) {
              n += 1;
              if (t - start >= 1000) resolve();
              else requestAnimationFrame(tick);
            }
            requestAnimationFrame(tick);
          });
          return n;
        });
      }
      const fpsVal = parseInt(String(result.info.fpsText || "").replace(/[^0-9]/g, ""), 10) || 0;
      const partsVal = parseInt(String(result.info.particulasText || "").replace(/[^0-9]/g, ""), 10) || 0;
      result.info.fpsValue = fpsVal;
      result.info.particulasValue = partsVal;
      result.ok = Boolean(canvas && result.info.canvasSize && result.info.canvasSize[0] > 300
        && ((result.info.rafFrames || 0) > 20 || fpsVal > 0)
        && (partsVal > 0 || !parts));
    } else {
      const canvas = await page.$("canvas");
      result.info = await page.evaluate(() => ({
        three: typeof THREE !== "undefined" ? THREE.REVISION : null,
        canvas: Boolean(document.querySelector("canvas")),
        canvasWidth: document.querySelector("canvas")?.width || 0,
        canvasHeight: document.querySelector("canvas")?.height || 0,
        title: document.title,
      }));
      result.ok = Boolean(result.info.canvas && result.info.three);
    }
    await page.screenshot({ path: png });
  } catch (err) {
    errors.push(String(err));
  } finally {
    await browser.close();
    server.close();
  }
  result.errors = errors;
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
})().catch((err) => {
  process.stdout.write(JSON.stringify({ task, ok: false, errors: [String(err)], info: null }, null, 2) + "\n");
  process.exitCode = 1;
});
