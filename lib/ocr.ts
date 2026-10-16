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
];
// Orden de intentos en vivo: un intento por fotograma para responder rápido.
const ATTEMPTS: [number, boolean][] = [[0, false], [1, false], [0, true], [2, false], [1, true], [2, true]];

async function attempt(src: CanvasImageSource, card: Rect, zone: number, invert: boolean) {
  const worker = await getWorker();
  const z = ZONES[zone];
  const r = clamp({ x: card.x + card.w * z.x, y: card.y + card.h * z.y, w: card.w * z.w, h: card.h * z.h }, src);
  const canvas = prepare(src, r, invert, card.h);
  const { data } = await worker.recognize(canvas);
  return { codes: extractCodes(data.text), text: data.text, preview: canvas.toDataURL("image/png") };
}

// Cámara en vivo: un solo intento, rotando zona/inversión según `n`.
export async function readCardCodeOnce(src: CanvasImageSource, card: Rect, n: number): Promise<ScanResult> {
  const [zone, invert] = ATTEMPTS[n % ATTEMPTS.length];
  return attempt(src, card, zone, invert);
}

// Foto: prueba todas las combinaciones hasta encontrar un código.
export async function readCardCode(src: CanvasImageSource, card: Rect): Promise<ScanResult> {
  let text = "";
  for (const [zone, invert] of ATTEMPTS) {
    const r = await attempt(src, card, zone, invert);
    text += r.text + "\n";
    if (r.codes.length) return { codes: r.codes, text };
  }
  return { codes: [], text };
}

function clamp(r: Rect, src: CanvasImageSource): Rect {
  const W = (src as HTMLVideoElement).videoWidth || (src as HTMLCanvasElement).width || (src as HTMLImageElement).naturalWidth;
  const H = (src as HTMLVideoElement).videoHeight || (src as HTMLCanvasElement).height || (src as HTMLImageElement).naturalHeight;
  const x = Math.max(0, Math.min(W - 1, r.x));
  const y = Math.max(0, Math.min(H - 1, r.y));
  return { x, y, w: Math.max(1, Math.min(W - x, r.w)), h: Math.max(1, Math.min(H - y, r.h)) };
}
