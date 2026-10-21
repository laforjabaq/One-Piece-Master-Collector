#!/usr/bin/env node
// Genera el índice de embeddings de todo el catálogo para el reconocimiento por
// arte: public/embeddings/index.bin (int8, una fila por versión) + index.json.
//
// Mismo modelo y preprocesado que public/embed/worker.mjs (DINOv2-small int8
// de Hugging Face, imagen completa estirada a 224x224, normalización ImageNet,
// pooler_output o token CLS, L2), así los vectores son comparables con los que
// calcula el teléfono.
//
// Todo gratis: optcgapi.com (datos e imágenes), Hugging Face (modelo, Apache-2.0),
// onnxruntime-node y sharp (MIT/Apache-2.0). Lo corre .github/workflows/embeddings.yml.
//
// Uso:  npm i --no-save onnxruntime-node@1.30.0 sharp@0.35.5 && node scripts/build-embeddings.mjs
// Opciones (env): LIMIT=50 (solo N versiones, para probar), CONCURRENCY=8,
//                 MODEL_URL=..., OUT=public/embeddings,
//                 MODEL_FILE / CATALOG_FILE (rutas locales, para probar sin red;
//                 en CATALOG_FILE las imágenes pueden ser rutas locales)
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";

const BASE = "https://optcgapi.com/api";
const MODEL_URL = process.env.MODEL_URL || "https://huggingface.co/Xenova/dinov2-small/resolve/main/onnx/model_quantized.onnx";
// Debe coincidir con MODEL_VERSION de lib/embed.ts (la app compara por prefijo).
const MODEL_VERSION = "dinov2s-1";
const OUT = process.env.OUT || "public/embeddings";
const LIMIT = Number(process.env.LIMIT) || Infinity;
const CONCURRENCY = Number(process.env.CONCURRENCY) || 8;
const INPUT = 224;
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];
const UA = { "User-Agent": "OnePieceMasterCollector/0.1 (embeddings build)" };

const ort = await import("onnxruntime-node").catch(() => null);
const sharp = (await import("sharp").catch(() => null))?.default;
if (!ort || !sharp) {
  console.error("Faltan dependencias: npm i --no-save onnxruntime-node sharp");
  process.exit(1);
}

// ---------- Catálogo (misma normalización que lib/optcg.ts y lib/variants.ts) ----------

const str = (r, ...keys) => {
  for (const k of keys) {
    const v = r[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
};
function setOf(r) {
  const id = str(r, "set_id", "set_code");
  if (id) return id.replace(/-(?=\d)/, "").toUpperCase();
  const m = str(r, "set_name").match(/\b(OP|ST|EB|PRB)-?(\d{2})\b/i);
  if (m) return `${m[1].toUpperCase()}${m[2]}`;
  return str(r, "set_name") || "—";
}
const normSet = (s) => s.trim().toUpperCase().replace(/[\s-]+/g, "");

async function getJson(url) {
  let last = "";
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, { headers: { Accept: "application/json", ...UA } });
      last = `HTTP ${res.status}`;
      if (res.ok) {
        const d = await res.json();
        return Array.isArray(d) ? d : d?.results ?? d?.data ?? [];
      }
    } catch (e) {
      last = String(e?.cause?.code || e?.message || e);
    }
    await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
  }
  throw new Error(`No se pudo leer ${url} (${last})`);
}

async function catalog() {
  const lists = process.env.CATALOG_FILE
    ? [JSON.parse(await readFile(process.env.CATALOG_FILE, "utf8"))]
    : await Promise.all(
        ["allSetCards", "allSTCards", "allPromoCards"].map((p) =>
          getJson(`${BASE}/${p}/`).catch((e) => {
            // Una lista caída (p. ej. promos) no debe tumbar todo el índice.
            console.warn(`AVISO: ${e.message}`);
            return null;
          }),
        ),
      );
  if (lists.every((l) => l === null)) throw new Error("optcgapi no respondió en ninguna lista");
  const seen = new Map();
  for (const r of lists.filter(Boolean).flat()) {
    const code = str(r, "card_set_id", "card_id", "id").toUpperCase();
    const image = str(r, "card_image", "image", "image_url");
    if (!code || !image) continue;
    const variantId = str(r, "card_image_id") || code;
    if (!seen.has(variantId)) seen.set(variantId, { variantId, code, set: normSet(setOf(r)), image });
  }
  return [...seen.values()].sort((a, b) => a.variantId.localeCompare(b.variantId, "en", { numeric: true })).slice(0, LIMIT);
}

// ---------- Modelo ----------

async function model() {
  const cacheFile = process.env.MODEL_FILE || join(process.env.RUNNER_TEMP || "/tmp", "dinov2s-quantized.onnx");
  let bytes = await readFile(cacheFile).catch(() => null);
  if (!bytes) {
    const res = await fetch(MODEL_URL);
    if (!res.ok) throw new Error(`Modelo no disponible (${res.status})`);
    bytes = Buffer.from(await res.arrayBuffer());
    await writeFile(cacheFile, bytes);
  }
  return ort.InferenceSession.create(bytes, { executionProviders: ["cpu"], graphOptimizationLevel: "all" });
}

async function embed(session, img) {
  // = pixels() de lib/embed.ts: imagen completa estirada a 224x224
  const rgb = await sharp(img).removeAlpha().resize(INPUT, INPUT, { fit: "fill", kernel: "lanczos3" }).raw().toBuffer();
  const n = INPUT * INPUT;
  const data = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) data[c * n + i] = (rgb[i * 3 + c] / 255 - MEAN[c]) / STD[c];
  const out = await session.run({ [session.inputNames[0]]: new ort.Tensor("float32", data, [1, 3, INPUT, INPUT]) });
  const t = out.pooler_output ?? out.last_hidden_state ?? out[session.outputNames[0]];
  const dim = t.dims[t.dims.length - 1];
  const v = Float32Array.from(t.data.subarray(0, dim));
  const s = Math.hypot(...v) || 1;
  for (let i = 0; i < dim; i++) v[i] /= s;
  return v;
}

async function fetchImage(url) {
  if (!/^https?:/.test(url)) return readFile(url).catch(() => null);
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, { headers: UA });
      if (res.ok) return Buffer.from(await res.arrayBuffer());
      if (res.status === 404) return null;
    } catch {
      /* reintento */
    }
    await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
  }
  return null;
}

// ---------- Índice anterior (para no recalcular lo que no cambió) ----------

async function previous() {
  try {
    const meta = JSON.parse(await readFile(join(OUT, "index.json"), "utf8"));
    const bin = new Int8Array(await readFile(join(OUT, "index.bin")));
    if (meta.model !== MODEL_VERSION) return new Map();
    const m = new Map();
    meta.items.forEach((it, i) => m.set(`${it[0]}|${it[3]}`, { q: bin.subarray(i * meta.dims, (i + 1) * meta.dims), scale: meta.scales[i], dims: meta.dims }));
    return m;
  } catch {
    return new Map();
  }
}

const imgKey = (url) => createHash("sha1").update(url).digest("hex").slice(0, 10);

function quantize(v) {
  let max = 0;
  for (const x of v) max = Math.max(max, Math.abs(x));
  const scale = max / 127 || 1 / 127;
  const q = new Int8Array(v.length);
  for (let i = 0; i < v.length; i++) q[i] = Math.max(-127, Math.min(127, Math.round(v[i] / scale)));
  return { q, scale };
}

// ---------- Principal ----------

const cards = await catalog();
console.log(`Catálogo: ${cards.length} versiones`);
const prev = await previous();
const session = await model();
const rows = new Array(cards.length);
let done = 0, reused = 0, failed = 0;
let next = 0;
async function work() {
  while (next < cards.length) {
    const i = next++;
    const c = cards[i];
    const key = imgKey(c.image);
    const old = prev.get(`${c.variantId}|${key}`);
    if (old) {
      rows[i] = { ...c, key, q: old.q, scale: old.scale };
      reused++;
    } else {
      const img = await fetchImage(c.image);
      try {
        if (!img) throw new Error("sin imagen");
        rows[i] = { ...c, key, ...quantize(await embed(session, img)) };
      } catch (e) {
        failed++;
        if (failed <= 20) console.warn(`  ${c.variantId}: ${e.message}`);
      }
    }
    if (++done % 250 === 0) console.log(`  ${done}/${cards.length} (reutilizadas ${reused}, fallos ${failed})`);
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, work));

const ok = rows.filter(Boolean);
if (!ok.length) throw new Error("No se generó ningún vector");
if (failed > cards.length * 0.2) throw new Error(`Demasiados fallos (${failed}/${cards.length}); no se escribe el índice`);
const dims = ok[0].q.length;
const bin = new Int8Array(ok.length * dims);
ok.forEach((r, i) => bin.set(r.q, i * dims));
const meta = {
  version: 1,
  model: MODEL_VERSION,
  dims,
  count: ok.length,
  quant: "int8",
  builtAt: new Date().toISOString(),
  source: { catalog: BASE, model: MODEL_URL },
  items: ok.map((r) => [r.variantId, r.code, r.set, r.key]),
  scales: ok.map((r) => Number(r.scale.toPrecision(6))),
};
// Sin cambios (aparte de la fecha): no se reescribe, así el workflow no hace commits vacíos.
const same = await (async () => {
  try {
    const old = JSON.parse(await readFile(join(OUT, "index.json"), "utf8"));
    const oldBin = await readFile(join(OUT, "index.bin"));
    return JSON.stringify({ ...old, builtAt: 0 }) === JSON.stringify({ ...meta, builtAt: 0 }) && Buffer.from(bin.buffer).equals(oldBin);
  } catch {
    return false;
  }
})();
if (same) {
  console.log("El índice no cambió.");
  process.exit(0);
}
await mkdir(OUT, { recursive: true });
await writeFile(join(OUT, "index.bin"), bin);
await writeFile(join(OUT, "index.json"), JSON.stringify(meta));
console.log(`Listo: ${ok.length} vectores x ${dims} (${(bin.byteLength / 1e6).toFixed(1)} MB), reutilizados ${reused}, fallos ${failed}`);
