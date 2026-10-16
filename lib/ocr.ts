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

// Recorta, escala y binariza una zona de la imagen para ayudar al OCR.
function prepare(src: CanvasImageSource, r: Rect, invert: boolean): HTMLCanvasElement {
  const scale = Math.min(4, Math.max(1, 900 / r.w));
  const c = document.createElement("canvas");
  c.width = Math.round(r.w * scale);
  c.height = Math.round(r.h * scale);
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, r.x, r.y, r.w, r.h, 0, 0, c.width, c.height);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  let min = 255, max = 0;
  const gray = new Uint8ClampedArray(d.length / 4);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    gray[j] = g;
    if (g < min) min = g;
    if (g > max) max = g;
  }
  const range = Math.max(1, max - min);
  // Umbral de Otsu sobre la imagen con contraste estirado.
  const hist = new Array(256).fill(0);
  for (let j = 0; j < gray.length; j++) {
    gray[j] = ((gray[j] - min) * 255) / range;
    hist[gray[j]]++;
  }
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0, wB = 0, best = 0, thr = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = gray.length - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) { best = between; thr = t; }
  }
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    let v = gray[j] > thr ? 255 : 0;
    if (invert) v = 255 - v;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

export type ScanResult = { codes: string[]; text: string };

// `card` es el rectángulo de la carta dentro de la imagen fuente.
export async function readCardCode(src: CanvasImageSource, card: Rect): Promise<ScanResult> {
  const worker = await getWorker();
  // El código está abajo a la derecha. Probamos de la zona más precisa a la más amplia,
  // con texto oscuro sobre claro y al revés (algunas alternas lo traen en blanco).
  const zones: Rect[] = [
    { x: card.x + card.w * 0.45, y: card.y + card.h * 0.86, w: card.w * 0.55, h: card.h * 0.14 },
    { x: card.x, y: card.y + card.h * 0.78, w: card.w, h: card.h * 0.22 },
    // por si la carta quedó un poco más grande o corrida respecto al marco
    { x: card.x - card.w * 0.1, y: card.y + card.h * 0.7, w: card.w * 1.2, h: card.h * 0.45 },
  ];
  let text = "";
  for (const zone of zones) {
    for (const invert of [false, true]) {
      const canvas = prepare(src, clamp(zone, src), invert);
      const { data } = await worker.recognize(canvas);
      text += data.text + "\n";
      const codes = extractCodes(data.text);
      if (codes.length) return { codes, text };
    }
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
