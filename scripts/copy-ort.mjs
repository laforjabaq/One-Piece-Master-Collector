// Copia ONNX Runtime Web (JS + WASM) a /public/ort para el reconocimiento por
// arte: se sirve desde el mismo origen (sin CDN) y el service worker lo guarda.
import { cpSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const src = "node_modules/onnxruntime-web/dist";
const out = join("public", "ort");
mkdirSync(out, { recursive: true });
for (const f of [
  "ort.wasm.min.mjs",
  "ort.webgpu.min.mjs",
  "ort-wasm-simd-threaded.mjs",
  "ort-wasm-simd-threaded.wasm",
  "ort-wasm-simd-threaded.asyncify.mjs",
  "ort-wasm-simd-threaded.asyncify.wasm",
]) cpSync(join(src, f), join(out, f));
console.log("ONNX Runtime Web copiado a public/ort");
