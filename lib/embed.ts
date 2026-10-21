"use client";
// Reconocimiento por arte: embeddings de imagen en el dispositivo (DINOv2-small,
// Apache-2.0) con ONNX Runtime Web en un Web Worker. Sin API keys ni servidores:
// el modelo se baja de Hugging Face una sola vez y queda en la caché del
// navegador; los vectores de las imágenes de referencia se calculan al vuelo y
// se guardan en IndexedDB.
//
// La capa es inyectable: si existe window.__opmcEmbedder se usa en lugar del
// modelo (las pruebas e2e meten ahí embeddings falsos y deterministas).
import { useSyncExternalStore } from "react";
import { readableUrl } from "./phash";
import type { ArtScores } from "./variants";
import { compatible, loadArtIndex, nearest, rowVector, scoreIds, type ArtIndex, type Hit } from "./artindex";
export type { ArtScores };

type Rect = { x: number; y: number; w: number; h: number };

export const INPUT = 224;
const HF = "https://huggingface.co/Xenova/dinov2-small/resolve/main/onnx";
export const MODEL = {
  name: "DINOv2-small",
  license: "Apache-2.0",
  // WASM: int8 (~23 MB). WebGPU: fp16 (~44 MB), si falla se usa el int8 en WASM.
  wasm: { url: `${HF}/model_quantized.onnx`, mb: 23 },
  webgpu: { url: `${HF}/model_fp16.onnx`, mb: 44 },
  // ONNX Runtime Web (WASM), servido desde /ort
  runtimeMb: { wasm: 14, webgpu: 27 },
};
const MODEL_VERSION = "dinov2s-1";

/** Lo que tiene que dar una capa de embeddings (real o falsa). */
export interface Embedder {
  version: string;
  /** rgba: size x size píxeles. Devuelve un vector normalizado (L2). */
  embed(rgba: Uint8ClampedArray, size: number): Promise<Float32Array | number[]>;
}

declare global {
  interface Window {
    __opmcEmbedder?: Embedder | { fail: true };
  }
}

// ---------- Ajustes ----------

const ON_KEY = "opmc.artRecognition.v1";
const NOTICE_KEY = "opmc.artModelNotice.v1";
const MARGIN_KEY = "opmc.artMargin.v1";
const settingsListeners = new Set<() => void>();

export function artEnabled(): boolean {
  try {
    return localStorage.getItem(ON_KEY) !== "0";
  } catch {
    return true;
  }
}
export function setArtEnabled(on: boolean) {
  try {
    localStorage.setItem(ON_KEY, on ? "1" : "0");
  } catch {
    /* nada */
  }
  settingsListeners.forEach((l) => l());
}
export function useArtEnabled(): boolean {
  return useSyncExternalStore(
    (l) => {
      settingsListeners.add(l);
      return () => settingsListeners.delete(l);
    },
    artEnabled,
    () => true,
  );
}

/** Ventaja mínima de similitud (coseno) de la 1.ª sobre la 2.ª para aceptar sola. */
export function artMargin(): number {
  try {
    const n = parseFloat(localStorage.getItem(MARGIN_KEY) || "");
    if (Number.isFinite(n) && n > 0 && n < 1) return n;
  } catch {
    /* nada */
  }
  return 0.04;
}

// ---------- Estado del modelo (para el aviso de descarga) ----------

export type ModelState =
  | { phase: "idle" }
  | { phase: "loading"; loaded: number; total: number; mb: number; firstTime: boolean }
  | { phase: "ready"; backend: string; mb: number }
  | { phase: "failed"; error: string };

let state: ModelState = { phase: "idle" };
const stateListeners = new Set<() => void>();
function setState(s: ModelState) {
  state = s;
  stateListeners.forEach((l) => l());
}
export const modelState = () => state;
export function useModelState(): ModelState {
  return useSyncExternalStore(
    (l) => {
      stateListeners.add(l);
      return () => stateListeners.delete(l);
    },
    () => state,
    () => state,
  );
}

const noticeSeen = () => {
  try {
    return localStorage.getItem(NOTICE_KEY) === "1";
  } catch {
    return false;
  }
};

// ---------- Capa real (Web Worker) ----------

let embedderP: Promise<Embedder | null> | null = null;

function workerEmbedder(): Promise<Embedder | null> {
  return new Promise((resolve) => {
    let worker: Worker;
    try {
      worker = new Worker("/embed/worker.mjs", { type: "module" });
    } catch (e) {
      setState({ phase: "failed", error: String(e) });
      return resolve(null);
    }
    let seq = 0;
    const pending = new Map<number, { ok: (d: { vector?: Float32Array; info?: { backend: string; bytes: number } }) => void; err: (e: Error) => void }>();
    worker.onmessage = (e) => {
      const d = e.data;
      if (d.progress) {
        const s = state;
        if (s.phase === "loading") setState({ ...s, loaded: d.progress.loaded, total: d.progress.total || s.total });
        return;
      }
      const p = pending.get(d.id);
      if (!p) return;
      pending.delete(d.id);
      if (d.ok) p.ok(d);
      else p.err(new Error(d.error));
    };
    worker.onerror = (e) => {
      pending.forEach((p) => p.err(new Error(e.message || "worker")));
      pending.clear();
    };
    const call = (msg: object, transfer: Transferable[] = []) =>
      new Promise<{ vector?: Float32Array; info?: { backend: string; bytes: number } }>((ok, err) => {
        const id = ++seq;
        pending.set(id, { ok, err });
        worker.postMessage({ id, ...msg }, transfer);
      });
    const gpu = typeof navigator !== "undefined" && "gpu" in navigator;
    const models = [
      ...(gpu ? [{ url: MODEL.webgpu.url, backend: "webgpu" }] : []),
      { url: MODEL.wasm.url, backend: "wasm" },
    ];
    const mb = gpu ? MODEL.webgpu.mb + MODEL.runtimeMb.webgpu : MODEL.wasm.mb + MODEL.runtimeMb.wasm;
    setState({ phase: "loading", loaded: 0, total: 0, mb, firstTime: !noticeSeen() });
    call({ type: "init", models })
      .then(({ info }) => {
        try {
          localStorage.setItem(NOTICE_KEY, "1");
        } catch {
          /* nada */
        }
        const backend = info?.backend ?? "wasm";
        setState({ phase: "ready", backend, mb: Math.round((info?.bytes ?? 0) / 1e6) });
        resolve({
          version: `${MODEL_VERSION}-${backend}`,
          embed: async (rgba, size) => {
            const copy = new Uint8ClampedArray(rgba);
            return (await call({ type: "embed", rgba: copy, size }, [copy.buffer])).vector!;
          },
        });
      })
      .catch((e) => {
        worker.terminate();
        setState({ phase: "failed", error: e.message });
        resolve(null);
      });
  });
}

/** La capa de embeddings, cargada al primer uso. null si no se pudo (se sigue sin arte). */
export function getEmbedder(): Promise<Embedder | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  const injected = window.__opmcEmbedder;
  if (injected) {
    if ("fail" in injected) {
      setState({ phase: "failed", error: "inyectado" });
      return Promise.resolve(null);
    }
    if (state.phase !== "ready") setState({ phase: "ready", backend: "test", mb: 0 });
    return Promise.resolve(injected);
  }
  if (!embedderP) {
    embedderP = workerEmbedder();
    // Si falló, se puede reintentar en la próxima sesión de escaneo.
    embedderP.then((e) => {
      if (!e) setTimeout(() => (embedderP = null), 60_000);
    });
  }
  return embedderP;
}

// ---------- Utilidades ----------

export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    d += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? d / Math.sqrt(na * nb) : 0;
}

/** Recorte (rect de src, o una fracción vertical de él) a size x size en RGBA. */
function pixels(src: CanvasImageSource, r: Rect, size = INPUT): Uint8ClampedArray {
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, r.x, r.y, r.w, r.h, 0, 0, size, size);
  return ctx.getImageData(0, 0, size, size).data;
}

// Zonas de la carta (fracciones de alto). La del sello coincide con la que lee el OCR.
export const ZONES = { card: [0, 1], stamp: [0.3, 0.58] } as const;
type Zone = keyof typeof ZONES;
const zoneRect = (r: Rect, z: Zone): Rect => ({ x: r.x, y: r.y + r.h * ZONES[z][0], w: r.w, h: r.h * ZONES[z][1] });

// ---------- Caché de vectores (IndexedDB) ----------

let dbP: Promise<IDBDatabase | null> | null = null;
function db(): Promise<IDBDatabase | null> {
  return (dbP ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open("opmc-embeddings", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("vec");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  }));
}
async function idbGet(key: string): Promise<Float32Array | undefined> {
  const d = await db();
  if (!d) return undefined;
  return new Promise((resolve) => {
    try {
      const r = d.transaction("vec").objectStore("vec").get(key);
      r.onsuccess = () => resolve(r.result ? new Float32Array(r.result) : undefined);
      r.onerror = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
}
async function idbPut(key: string, v: Float32Array) {
  const d = await db();
  if (!d) return;
  try {
    d.transaction("vec", "readwrite").objectStore("vec").put(Array.from(v), key);
  } catch {
    /* nada */
  }
}

const loadImage = (url: string) =>
  new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image();
    const t = setTimeout(() => resolve(null), 8000);
    img.onload = () => {
      clearTimeout(t);
      resolve(img);
    };
    img.onerror = () => {
      clearTimeout(t);
      resolve(null);
    };
    img.src = readableUrl(url);
  });

const memo = new Map<string, Promise<Float32Array | undefined>>();

/** Vectores de una versión (carta completa y zona del sello), con caché. */
async function variantVectors(e: Embedder, v: { variantId: string; image: string }, zones: Zone[]): Promise<Partial<Record<Zone, Float32Array>>> {
  const out: Partial<Record<Zone, Float32Array>> = {};
  const missing = zones.filter((z) => !memo.has(`${e.version}|${v.variantId}|${z}|${v.image}`));
  let img: Promise<HTMLImageElement | null> | null = null;
  for (const z of missing) {
    const key = `${e.version}|${v.variantId}|${z}|${v.image}`;
    const p = (async () => {
      const hit = await idbGet(key);
      if (hit) return hit;
      const im = await (img ??= v.image ? loadImage(v.image) : Promise.resolve(null));
      if (!im) return undefined;
      try {
        const vec = Float32Array.from(await e.embed(pixels(im, zoneRect({ x: 0, y: 0, w: im.naturalWidth, h: im.naturalHeight }, z)), INPUT));
        idbPut(key, vec);
        return vec;
      } catch {
        return undefined; // imagen contaminada o error del modelo
      }
    })();
    memo.set(key, p);
    p.then((r) => r === undefined && memo.delete(key));
  }
  for (const z of zones) {
    const r = await memo.get(`${e.version}|${v.variantId}|${z}|${v.image}`);
    if (r) out[z] = r;
  }
  return out;
}


// Dos versiones "comparten arte" si sus imágenes de referencia casi coinciden.
export const SAME_ART = 0.95;

/**
 * Compara el recorte de la carta con las imágenes de las candidatas.
 * Devuelve null si el modelo no está (desactivado, fallo o tarda demasiado).
 */
export async function artMatch(
  src: CanvasImageSource,
  card: Rect,
  variants: { variantId: string; image: string }[],
  timeoutMs = 8000,
): Promise<ArtScores | null> {
  if (!artEnabled() || variants.length < 2) return null;
  const eP = getEmbedder();
  // Primera descarga del modelo: no se hace esperar al escaneo (sigue en segundo plano).
  const s = modelState();
  const wait = s.phase === "loading" && s.firstTime ? 300 : timeoutMs;
  const work = (async (): Promise<ArtScores | null> => {
    const e = await eP;
    if (!e) return null;
    // El recorte se toma ya, antes de que cambie el fotograma.
    const query = Float32Array.from(await e.embed(pixels(src, card), INPUT));
    // Con el índice precalculado: similitud instantánea, sin bajar imágenes.
    const ix = await indexFor(e, query.length);
    const ids = variants.map((v) => v.variantId);
    let refs: Partial<Record<Zone, Float32Array>>[];
    let art: Record<string, number> = {};
    if (ix && ids.every((id) => ix.rowOf.has(id))) {
      art = scoreIds(ix, query, ids);
      refs = ids.map((id) => ({ card: rowVector(ix, ix.rowOf.get(id)!) }));
      setSource("index");
    } else {
      refs = await Promise.all(variants.map((v) => variantVectors(e, v, ["card"])));
      variants.forEach((v, i) => {
        if (refs[i].card) art[v.variantId] = cosine(query, refs[i].card!);
      });
      setSource("lazy");
    }
    const sorted = Object.keys(art).sort((a, b) => art[b] - art[a]);
    if (!sorted.length) return null;
    // Mismo arte que la mejor: decide la zona del sello.
    const top = refs[variants.findIndex((v) => v.variantId === sorted[0])].card!;
    const twins = variants.filter((v, i) => refs[i].card && cosine(top, refs[i].card!) >= SAME_ART);
    let stamp: Record<string, number> | undefined;
    if (twins.length > 1) {
      const q = Float32Array.from(await e.embed(pixels(src, zoneRect(card, "stamp")), INPUT));
      const zs = await Promise.all(twins.map((v) => variantVectors(e, v, ["stamp"])));
      stamp = {};
      twins.forEach((v, i) => {
        if (zs[i].stamp) stamp![v.variantId] = cosine(q, zs[i].stamp!);
      });
    }
    return { art, stamp, margin: artMargin() };
  })().catch(() => null);
  const timeout = new Promise<null>((r) => setTimeout(() => r(null), wait));
  return Promise.race([work, timeout]);
}

// ---------- Índice de todo el catálogo ----------

/** De dónde salió la última comparación de arte (para depurar y las pruebas). */
let lastSource: "index" | "lazy" | "" = "";
export const artSource = () => lastSource;
function setSource(s: "index" | "lazy") {
  lastSource = s;
  try {
    document.documentElement.dataset.artSource = s;
  } catch {
    /* nada */
  }
}

async function indexFor(e: Embedder, dims: number): Promise<ArtIndex | null> {
  const ix = await Promise.race([loadArtIndex(), new Promise<null>((r) => setTimeout(() => r(null), 3000))]);
  return ix && compatible(ix, e.version, dims) ? ix : null;
}

/**
 * Arte como señal principal: vecinos más cercanos en todo el catálogo
 * (restringido a los sets bloqueados). null si no hay índice o modelo.
 */
export async function artNearest(src: CanvasImageSource, card: Rect, k = 8, sets: string[] = [], timeoutMs = 4000): Promise<Hit[] | null> {
  if (!artEnabled()) return null;
  const ix = await Promise.race([loadArtIndex(), new Promise<null>((r) => setTimeout(() => r(null), 1500))]);
  if (!ix) return null;
  const work = (async () => {
    const e = await getEmbedder();
    if (!e) return null;
    const q = Float32Array.from(await e.embed(pixels(src, card), INPUT));
    if (!compatible(ix, e.version, q.length)) return null;
    const hits = nearest(ix, q, k, sets);
    return hits.length ? hits : null;
  })().catch(() => null);
  return Promise.race([work, new Promise<null>((r) => setTimeout(() => r(null), timeoutMs))]);
}
