/**
 * Smoke visual de la UI 2.4: carga, paneles, Hub y Ajustes.
 * Uso: node scripts/check-ui.cjs [http://127.0.0.1:8787]
 */
const { chromium } = require("C:/Users/user/Documents/prject_local_AI/chat/node_modules/playwright-core");

const url = process.argv[2] || "http://127.0.0.1:8787";
const edge = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const out = "C:/Users/user/Documents/prject_local_AI/docs/graficos";

(async () => {
  const browser = await chromium.launch({
    executablePath: edge,
    headless: true,
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(3000);

  let startup = null;
  try {
    const dialogo = await page.$(".inicio-modelo");
    if (dialogo) {
      startup = await page.evaluate(() => ({
        text: (document.querySelector(".inicio-modelo")?.innerText || "").slice(0, 1200),
        opciones: [...document.querySelectorAll(".inicio-modelo-opcion")].map((b) => (b.innerText || "").trim().slice(0, 160)),
      }));
      const opcion = page.locator(".inicio-modelo-opcion", { hasText: "Qwen3.6 35B-A3B" }).first();
      await opcion.click({ timeout: 15000 });
      await page.waitForSelector(".inicio-modelo", { state: "detached", timeout: 180000 });
      await page.waitForFunction(async () => {
        const s = await fetch("/api/server/state").then((r) => r.json());
        return s.state === "ready";
      }, { timeout: 180000 });
      await page.waitForTimeout(1500);
    }
  } catch (err) {
    errors.push(`startup: ${err}`);
  }

  const main = await page.evaluate(() => {
    const q = (s) => Boolean(document.querySelector(s));
    return {
      title: document.title,
      brand: q(".brand"),
      sidebar: q("#sidebar"),
      editor: q("#editor"),
      chat: q("#chat"),
      composer: q("#composer"),
      input: q("#input"),
      tree: q("#tree"),
      log: q("#log"),
      status: document.querySelector("#server-status")?.textContent?.trim() || "",
      meta: document.querySelector("#meta")?.innerText?.trim() || "",
      stats: document.querySelector("#stats-line")?.innerText?.trim() || "",
      buttons: [...document.querySelectorAll("header .top button, header .top select")].map((e) => (e.innerText || e.value || e.title || "").trim()).filter(Boolean).slice(0, 30),
      treeRows: document.querySelectorAll("#tree .row, #tree li, #tree a").length,
      chats: document.querySelectorAll("#log .msg").length,
    };
  });
  await page.screenshot({ path: `${out}/ui-2.4.0-main.png` });

  let hub = null;
  try {
    await page.click("#hub-abrir");
    await page.waitForSelector(".hub-dialog", { timeout: 10000 });
    await page.waitForTimeout(1200);
    hub = await page.evaluate(() => ({
      cards: document.querySelectorAll(".hub-card").length,
      sections: [...document.querySelectorAll(".hub-dialog h2, .hub-dialog h3")].map((e) => e.innerText.trim()).filter(Boolean).slice(0, 20),
      text: (document.querySelector(".hub-dialog")?.innerText || "").slice(0, 1200),
    }));
    await page.screenshot({ path: `${out}/ui-2.4.0-hub.png` });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
  } catch (err) {
    errors.push(`hub: ${err}`);
  }

  let settings = null;
  try {
    await page.keyboard.press("Control+Shift+P");
    await page.waitForSelector(".paleta input", { timeout: 5000 });
    await page.fill(".paleta input", "Ajustes");
    await page.waitForTimeout(500);
    await page.keyboard.press("Enter");
    await page.waitForSelector(".dialogo.ajustes", { timeout: 10000 });
    await page.waitForTimeout(800);
    settings = await page.evaluate(() => ({
      text: (document.querySelector(".dialogo.ajustes")?.innerText || "").slice(0, 2200),
      selects: [...document.querySelectorAll(".dialogo.ajustes select")].map((s) => ({ value: s.value, label: s.options[s.selectedIndex]?.text || "" })),
      checks: [...document.querySelectorAll(".dialogo.ajustes input[type=checkbox]")].map((c) => c.checked),
    }));
    await page.screenshot({ path: `${out}/ui-2.4.0-settings.png` });
    await page.keyboard.press("Escape");
  } catch (err) {
    errors.push(`settings: ${err}`);
  }

  let api = {};
  try {
    api = await page.evaluate(async () => {
      const [s, m, st] = await Promise.all([fetch("/api/settings").then((r) => r.json()), fetch("/api/modelos").then((r) => r.json()), fetch("/api/state").then((r) => r.json())]);
      return {
        uiVersion: s.uiVersion,
        pensar: s.pensar,
        efectivo: s.pensarInfo?.efectivo,
        coderContextTokens: s.coderContextTokens,
        enginePreset: s.enginePreset,
        actual: m.actual,
        guardado: m.guardado,
        modelos: m.modelos?.length,
        nuevos: m.modelos?.filter((x) => ["qwen3-coder-30b-a3b", "deepseek-coder-v2-lite", "qwen3-8b"].includes(x.clave)).map((x) => ({ clave: x.clave, existe: x.existe, gpu: x.gpuCompleta })),
        busy: st.busy,
        nCtx: st.nCtx,
        usage: st.usage,
      };
    });
  } catch (err) {
    errors.push(`api: ${err}`);
  }

  process.stdout.write(JSON.stringify({ url, errors, startup, main, hub, settings, api }, null, 2) + "\n");
  await browser.close();
})().catch((err) => {
  process.stdout.write(JSON.stringify({ url, errors: [String(err)], main: null, hub: null, settings: null, api: null }, null, 2) + "\n");
  process.exitCode = 1;
});
