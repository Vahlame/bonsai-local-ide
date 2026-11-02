/**
 * Abre un index.html de Skyblock con Edge headless, comprueba THREE/canvas y
 * guarda una captura. Uso: node scripts/check-skyblock.cjs <html> <png>
 */
const path = require("path");
const { loadPlaywright, browserPath } = require("./lib/playwright.cjs");
const { chromium } = loadPlaywright();

const html = path.resolve(process.argv[2] || "");
const png = path.resolve(process.argv[3] || "skyblock-check.png");
const edge = browserPath();

(async () => {
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
  const url = "file:///" + html.replace(/\\/g, "/");
  await page.goto(url, { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(2500);
  const info = await page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    let sceneChildren = null;
    try {
      sceneChildren = typeof scene !== "undefined" ? scene.children.length : null;
    } catch {
      sceneChildren = null;
    }
    return {
      three: typeof THREE !== "undefined" ? THREE.REVISION : null,
      canvas: Boolean(canvas),
      canvasWidth: canvas ? canvas.width : 0,
      canvasHeight: canvas ? canvas.height : 0,
      sceneChildren,
      title: document.title,
      text: (document.body.innerText || "").slice(0, 300),
    };
  });
  await page.screenshot({ path: png });
  await browser.close();
  process.stdout.write(JSON.stringify({ info, errors }, null, 2) + "\n");
})().catch((err) => {
  process.stdout.write(JSON.stringify({ info: null, errors: [String(err)] }, null, 2) + "\n");
  process.exitCode = 1;
});
