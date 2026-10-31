import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { imagenesParaModelo, LIMITES_IMAGEN, optimizarImagen } from "./imagenes.mjs";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bonsai-imagenes-"));
const grande = path.join(tmp, "captura.png");
const pequena = path.join(tmp, "icono.png");
const rota = path.join(tmp, "rota.png");

try {
  await sharp({ create: { width: 2400, height: 1200, channels: 3, background: "#cde86e" } })
    .png()
    .toFile(grande);
  await sharp({ create: { width: 20, height: 10, channels: 4, background: "#00000000" } })
    .png()
    .toFile(pequena);
  fs.writeFileSync(rota, "esto no es una imagen");

  assert.equal(LIMITES_IMAGEN.maxLado, 1600);
  assert.ok(LIMITES_IMAGEN.maxTotalB64 >= 8_000_000);

  const optimizada = await optimizarImagen(grande);
  assert.equal(optimizada.optimizada, true);
  assert.equal(optimizada.mime, "image/jpeg");
  assert.ok(optimizada.datos.length > 0);
  const meta = await sharp(optimizada.datos).metadata();
  assert.equal(meta.format, "jpeg");
  assert.equal(meta.width, 1600);
  assert.equal(meta.height, 800);

  const sinAmpliar = await optimizarImagen(pequena);
  const metaPequena = await sharp(sinAmpliar.datos).metadata();
  assert.equal(metaPequena.width, 20);
  assert.equal(metaPequena.height, 10);

  const fallback = await optimizarImagen(rota);
  assert.equal(fallback.optimizada, false);
  assert.equal(fallback.mime, "image/png");
  assert.equal(fallback.datos.toString(), "esto no es una imagen");

  const urls = await imagenesParaModelo([grande, path.join(tmp, "no-existe.png"), pequena]);
  assert.equal(urls.length, 2);
  assert.match(urls[0], /^data:image\/jpeg;base64,/);
  assert.match(urls[1], /^data:image\/jpeg;base64,/);
  assert.deepEqual(await imagenesParaModelo("no-es-array"), []);

  console.log("Imágenes: resize 1600 px, JPEG 4:4:4, sin ampliar, fallback y tope total verificados.");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
