// Genera los íconos PNG de la app (sombrero de paja) sin dependencias.
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};

function icon(size, padding) {
  const rows = [];
  const BG = [13, 27, 42], STRAW = [244, 201, 93], BAND = [230, 57, 70], EDGE = [196, 150, 52];
  for (let y = 0; y < size; y++) {
    const row = [0];
    for (let x = 0; x < size; x++) {
      // coordenadas normalizadas -1..1 con margen para íconos "maskable"
      const u = ((x + 0.5) / size * 2 - 1) / (1 - padding);
      const v = ((y + 0.5) / size * 2 - 1) / (1 - padding);
      let col = BG;
      const brim = (u / 0.92) ** 2 + ((v - 0.22) / 0.26) ** 2;
      const dome = (u / 0.52) ** 2 + ((v + 0.02) / 0.5) ** 2 <= 1 && v <= 0.2;
      if (brim <= 1) col = brim > 0.82 ? EDGE : STRAW;
      if (dome) col = v > -0.02 && v < 0.16 ? BAND : STRAW;
      row.push(...col);
    }
    rows.push(Buffer.from(row));
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

writeFileSync("public/icon-192.png", icon(192, 0.1));
writeFileSync("public/icon-512.png", icon(512, 0.1));
writeFileSync("public/icon-maskable-512.png", icon(512, 0.3));
writeFileSync("public/apple-touch-icon.png", icon(180, 0.15));
console.log("Íconos generados");
