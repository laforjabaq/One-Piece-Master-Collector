"use client";
// OCR en el teléfono con Tesseract.js. Todo se sirve desde /public/tesseract.
import type { Worker } from "tesseract.js";
import { extractCodes } from "./code";

let workerPromise: Promise<Worker> | null = null;

export function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker, PSM } = await import("tesseract.js");
      const worker = await createWorker("eng", 1, {
        workerPath: "/tesseract/worker.min.js",
        corePath: "/tesseract/core",
        langPath: "/tesseract/lang",
        gzip: true,
      });
      await worker.setParameters({
        tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-",
        tessedit_pageseg_mode: PSM.SPARSE_TEXT,
      });
      return worker;
    })().catch((e) => {
      workerPromise = null;
      throw e;
    });
  }
  return workerPromise;
}

type Rect = { x: number; y: number; w: number; h: number };

// Umbral adaptativo (Bradley): compara cada píxel con el promedio de su
// vecindad, así aguanta sombras, brillos y fondos de color mejor que un umbral global.
function prepare(src: CanvasImageSource, r: Rect, invert: boolean, cardH: number): HTMLCanvasElement {
  // el código mide ~1.5% del alto de la carta: escalamos para que quede de ~30px
  // (con la carta lejos esto es un aumento de 2-4x del recorte)
  const scale = Math.min(4, Math.max(0.5, 2000 / cardH));
  const c = document.createElement("canvas");
  const W = (c.width = Math.round(r.w * scale));
  const H = (c.height = Math.round(r.h * scale));
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, r.x, r.y, r.w, r.h, 0, 0, W, H);
  const img = ctx.getImageData(0, 0, W, H);
  const d = img.data;
  const gray = new Float32Array(W * H);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) gray[j] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  const integral = new Float64Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) {
    let row = 0;
    for (let x = 0; x < W; x++) {
      row += gray[y * W + x];
      integral[(y + 1) * (W + 1) + x + 1] = integral[y * (W + 1) + x + 1] + row;
    }
  }
  const half = Math.max(8, Math.round(Math.min(W, H) / 6));
  const T = 0.15;
  for (let y = 0; y < H; y++) {
    const y0 = Math.max(0, y - half), y1 = Math.min(H, y + half + 1);
    for (let x = 0; x < W; x++) {
      const x0 = Math.max(0, x - half), x1 = Math.min(W, x + half + 1);
      const sum = integral[y1 * (W + 1) + x1] - integral[y0 * (W + 1) + x1] - integral[y1 * (W + 1) + x0] + integral[y0 * (W + 1) + x0];
      const mean = sum / ((x1 - x0) * (y1 - y0));
      const g = gray[y * W + x];
      // texto oscuro sobre claro, o (invert) texto claro sobre oscuro
      const ink = invert ? g > mean * (1 + T) : g < mean * (1 - T);
      const v = ink ? 0 : 255;
      const k = (y * W + x) * 4;
      d[k] = d[k + 1] = d[k + 2] = v;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

export type ScanResult = { codes: string[]; text: string; preview?: string };

// Zonas relativas a la carta, de la más precisa a la más amplia. Las amplias
// cubren cartas más chicas o corridas respecto al marco.
const ZONES = [
  { x: 0.5, y: 0.86, w: 0.52, h: 0.15 },
  { x: 0.3, y: 0.8, w: 0.75, h: 0.24 },
  { x: -0.05, y: 0.7, w: 1.1, h: 0.38 },
  // 3: franja del código respecto a una carta detectada (abajo ~8%, derecha ~35%, con margen)
  { x: 0.6, y: 0.89, w: 0.42, h: 0.12 },
];
const DETECTED_ATTEMPTS: [number, boolean][] = [[3, false], [0, false], [3, true], [1, false]];
// Orden de intentos en vivo: un intento por fotograma para responder rápido.
const ATTEMPTS: [number, boolean][] = [[0, false], [1, false], [0, true], [2, false], [1, true], [2, true]];

let currentPsm = "11"; // PSM.SPARSE_TEXT, el que fija getWorker

async function attempt(src: CanvasImageSource, card: Rect, zone: number, invert: boolean) {
  const worker = await getWorker();
  const z = ZONES[zone];
  const r = clamp({ x: card.x + card.w * z.x, y: card.y + card.h * z.y, w: card.w * z.w, h: card.h * z.h }, src);
  const canvas = prepare(src, r, invert, card.h);
  // La franja ajustada (zona 3) es casi una sola línea: ahí PSM "línea" lee
  // mucho mejor que "texto disperso", que se confunde con el borde de la carta.
  const psm = zone === 3 ? "7" : "11";
  if (psm !== currentPsm) {
    await worker.setParameters({ tessedit_pageseg_mode: psm as never });
    currentPsm = psm;
  }
  const { data } = await worker.recognize(canvas);
  return { codes: extractCodes(data.text), text: data.text, preview: canvas.toDataURL("image/png") };
}

// Detecta el rectángulo de la carta dentro de `area` (coordenadas de `src`).
// Trabaja sobre una copia reducida (~200 px): cuenta bordes (gradiente) por fila
// y columna; la carta, con ilustración y texto, concentra muchos más bordes que
// el fondo (caja del slinger, mesa). Devuelve null si no hay algo con forma de carta.
export function detectCard(src: CanvasImageSource, area: Rect): Rect | null {
  const a = clamp(area, src);
  const S = 200 / Math.max(a.w, a.h);
  const W = Math.max(8, Math.round(a.w * S)), H = Math.max(8, Math.round(a.h * S));
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(src, a.x, a.y, a.w, a.h, 0, 0, W, H);
  const d = ctx.getImageData(0, 0, W, H).data;
  const g = new Float32Array(W * H);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) g[j] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  const col = new Float32Array(W), row = new Float32Array(H);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const k = y * W + x;
      const m = Math.abs(g[k + 1] - g[k - 1]) + Math.abs(g[k + W] - g[k - W]);
      if (m > 36) {
        col[x]++;
        row[y]++;
      }
    }
  }
  // Primero el tramo entre la primera y la última línea fuerte (bordes de la
  // carta); si no da forma de carta, el tramo contiguo más denso.
  const ok = (cx: [number, number] | null, cy: [number, number] | null) => {
    if (!cx || !cy) return null;
    const w = cx[1] - cx[0] + 1, h = cy[1] - cy[0] + 1;
    const ratio = w / h;
    if (w < W * 0.2 || h < H * 0.2 || ratio < 0.6 || ratio > 0.84) return null;
    return { x: a.x + cx[0] / S, y: a.y + cy[0] / S, w: w / S, h: h / S };
  };
  return ok(span(col), span(row)) ?? ok(longestRun(col), longestRun(row));
}

function span(v: Float32Array): [number, number] | null {
  let max = 0;
  for (const x of v) max = Math.max(max, x);
  if (max < 4) return null;
  const thr = max * 0.4;
  let s = -1, e = -1;
  for (let i = 0; i < v.length; i++) if (v[i] >= thr) { if (s < 0) s = i; e = i; }
  return s >= 0 ? [s, e] : null;
}

// Tramo contiguo más largo con densidad de bordes alta (tolera huecos cortos).
function longestRun(v: Float32Array): [number, number] | null {
  let max = 0;
  for (const x of v) max = Math.max(max, x);
  if (max < 4) return null;
  const thr = max * 0.22;
  let best: [number, number] | null = null, s = -1, last = -1;
  for (let i = 0; i <= v.length; i++) {
    const on = i < v.length && v[i] >= thr;
    if (on) {
      if (s < 0 || i - last > 4) s = i;
      last = i;
    }
    if ((!on || i === v.length) && s >= 0 && (i === v.length || i - last > 4)) {
      if (!best || last - s > best[1] - best[0]) best = [s, last];
      s = -1;
    }
  }
  return best;
}

const shrink = (r: Rect, k: number): Rect => ({ x: r.x + (r.w * (1 - k)) / 2, y: r.y + (r.h * (1 - k)) / 2, w: r.w * k, h: r.h * k });

export type LiveResult = ScanResult & { card: Rect | null };

// Cámara en vivo: un solo intento por fotograma. Si se detecta la carta, el
// recorte del código se hace relativo a ella (vale aunque esté lejos o corrida);
// si no, alterna entre el marco guía y una carta más chica centrada.
export async function readCardCodeOnce(src: CanvasImageSource, guide: Rect, view: Rect, n: number): Promise<LiveResult> {
  const det = detectCard(src, view);
  if (det) {
    const [zone, invert] = DETECTED_ATTEMPTS[n % DETECTED_ATTEMPTS.length];
    return { ...(await attempt(src, det, zone, invert)), card: det };
  }
  const card = n % 2 === 0 ? guide : shrink(guide, 0.62);
  const [zone, invert] = ATTEMPTS[Math.floor(n / 2) % ATTEMPTS.length];
  return { ...(await attempt(src, card, zone, invert)), card: null };
}

// Foto: prueba la carta detectada y luego la imagen completa.
export async function readCardCode(src: CanvasImageSource, card: Rect): Promise<ScanResult> {
  let text = "";
  const det = detectCard(src, card);
  const tries: [Rect, number, boolean][] = [];
  if (det) for (const [z, i] of DETECTED_ATTEMPTS) tries.push([det, z, i]);
  for (const [z, i] of ATTEMPTS) tries.push([card, z, i]);
  let preview: string | undefined;
  for (const [c, zone, invert] of tries) {
    const r = await attempt(src, c, zone, invert);
    text += r.text + "\n";
    preview ??= r.preview;
    if (r.codes.length) return { codes: r.codes, text, preview: r.preview };
  }
  return { codes: [], text, preview };
}

function clamp(r: Rect, src: CanvasImageSource): Rect {
  const W = (src as HTMLVideoElement).videoWidth || (src as HTMLCanvasElement).width || (src as HTMLImageElement).naturalWidth;
  const H = (src as HTMLVideoElement).videoHeight || (src as HTMLCanvasElement).height || (src as HTMLImageElement).naturalHeight;
  const x = Math.max(0, Math.min(W - 1, r.x));
  const y = Math.max(0, Math.min(H - 1, r.y));
  return { x, y, w: Math.max(1, Math.min(W - x, r.w)), h: Math.max(1, Math.min(H - y, r.h)) };
}
