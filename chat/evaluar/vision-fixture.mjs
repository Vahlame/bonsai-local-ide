import zlib from "node:zlib";
const FUENTE = {
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["11111", "00010", "00100", "00010", "00001", "10001", "01110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
  B: ["11110", "10001", "11110", "10001", "11110", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  N: ["10001", "11001", "11001", "10101", "10011", "10011", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
};

/**
 * PNG en blanco y negro con el texto dibujado. Sin dependencias.
 * @param {string} texto
 * @param {number} escala
 * @returns {Buffer}
 */
export function pngConTexto(texto, escala = 24) {
  const ALTO_MAPA = 7;
  const ancho = (texto.length * 6 + 1) * escala;
  const alto = (ALTO_MAPA + 4) * escala;
  const filas = [];
  for (let y = 0; y < alto; y += 1) {
    const fila = Buffer.alloc(1 + ancho); // 1 byte de filtro + 1 byte por pixel (gris)
    fila[0] = 0;
    fila.fill(255, 1);
    for (let x = 0; x < ancho; x += 1) {
      const glifo = Math.floor(x / escala / 6);
      const dentroX = Math.floor((x - glifo * 6 * escala) / escala);
      const dentroY = Math.floor((y - 2 * escala) / escala);
      const mapa = FUENTE[texto[glifo]] || FUENTE[" "];
      if (dentroY >= 0 && dentroY < ALTO_MAPA && dentroX >= 0 && dentroX < 5 && mapa[dentroY][dentroX] === "1") {
        fila[1 + x] = 0;
      }
    }
    filas.push(fila);
  }
  const crudo = Buffer.concat(filas);
  /**
   * @param {string} tipo
   * @param {Buffer} datos
   * @returns {Buffer}
   */
  const trozo = (tipo, datos) => {
    const largo = Buffer.alloc(4);
    largo.writeUInt32BE(datos.length);
    const cuerpo = Buffer.concat([Buffer.from(tipo, "ascii"), datos]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(cuerpo) >>> 0);
    return Buffer.concat([largo, cuerpo, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(ancho, 0);
  ihdr.writeUInt32BE(alto, 4);
  ihdr[8] = 8; // bits por canal
  ihdr[9] = 0; // escala de grises
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    trozo("IHDR", ihdr),
    trozo("IDAT", zlib.deflateSync(crudo)),
    trozo("IEND", Buffer.alloc(0)),
  ]);
}

/** @type {number[]} */
const TABLA_CRC = (() => {
  /** @type {number[]} */
  const tabla = [];
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    tabla[n] = c;
  }
  return tabla;
})();

/** @param {Buffer} buf */
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = TABLA_CRC[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
