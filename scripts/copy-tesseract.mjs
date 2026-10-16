// Copia el motor de OCR (Tesseract) y el idioma inglés a /public para que
// la app no dependa de CDNs externos y funcione como PWA.
import { cpSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

const out = join("public", "tesseract");
mkdirSync(join(out, "core"), { recursive: true });
mkdirSync(join(out, "lang"), { recursive: true });

cpSync("node_modules/tesseract.js/dist/worker.min.js", join(out, "worker.min.js"));
const coreDir = "node_modules/tesseract.js-core";
for (const f of readdirSync(coreDir)) {
  if (f.startsWith("tesseract-core") && f.endsWith("-lstm.wasm.js")) {
    cpSync(join(coreDir, f), join(out, "core", f));
  }
}
cpSync("node_modules/@tesseract.js-data/eng/4.0.0/eng.traineddata.gz", join(out, "lang", "eng.traineddata.gz"));
console.log("Tesseract copiado a public/tesseract");
