// Corrección de perspectiva sin OpenCV: busca las 4 esquinas de la carta
// dentro de su rectángulo detectado y la "endereza" a un rectángulo canónico
// con una homografía (8 incógnitas, eliminación de Gauss). Así el embedding y
// los recortes fijos del OCR (código abajo a la derecha, nombre) ven siempre
// la carta igual aunque esté inclinada.
import { rectifyPixels, type Quad, type Rect } from "./warp-core";
export * from "./warp-core";

// ---------- Navegador ----------

const CARD_RATIO = 63 / 88;

/** Geometría de la corrección: zona de búsqueda, tamaños reducido, fuente y salida. */
function plan(SW: number, SH: number, det: Rect) {
  const m = 0.06;
  const ax = Math.max(0, det.x - det.w * m), ay = Math.max(0, det.y - det.h * m);
  const aw = Math.min(SW - ax, det.w * (1 + 2 * m)), ah = Math.min(SH - ay, det.h * (1 + 2 * m));
  // mapa de bordes reducido (~240 px)
  const S = 240 / Math.max(aw, ah);
  const W = Math.max(16, Math.round(aw * S)), H = Math.max(16, Math.round(ah * S));
  // salida a resolución útil para OCR
  const outH = Math.round(Math.min(1400, Math.max(700, det.h)));
  const outW = Math.round(outH * CARD_RATIO);
  // fuente a resolución limitada (lado largo ≤ 1600) para no copiar fotos 4K enteras
  const k = Math.min(1, 1600 / Math.max(aw, ah));
  const fw = Math.max(2, Math.round(aw * k)), fh = Math.max(2, Math.round(ah * k));
  return { ax, ay, aw, ah, S, W, H, outW, outH, fw, fh };
}

const sizeOf = (src: CanvasImageSource) => ({
  SW: (src as HTMLVideoElement).videoWidth || (src as HTMLCanvasElement).width || (src as HTMLImageElement).naturalWidth,
  SH: (src as HTMLVideoElement).videoHeight || (src as HTMLCanvasElement).height || (src as HTMLImageElement).naturalHeight,
});

type Rectified = { src: HTMLCanvasElement; card: Rect; quad: Quad };

function finish(p: ReturnType<typeof plan>, q: Quad, draw: (c: HTMLCanvasElement) => void): Rectified {
  const out = document.createElement("canvas");
  out.width = p.outW;
  out.height = p.outH;
  draw(out);
  document.documentElement.dataset.warped = String(Number(document.documentElement.dataset.warped || 0) + 1);
  const quad = q.map((pt) => ({ x: p.ax + pt.x / p.S, y: p.ay + pt.y / p.S })) as Quad;
  return { src: out, card: { x: 0, y: 0, w: p.outW, h: p.outH }, quad };
}

/**
 * Si la carta detectada en `det` está inclinada, devuelve un canvas con la
 * carta enderezada (y su rect, que es el canvas entero). Si no está inclinada
 * o no se encuentran 4 esquinas fiables, null: se sigue con el recorte normal.
 * Síncrono (hilo principal): solo de respaldo si no hay Worker/OffscreenCanvas.
 */
export function rectify(src: CanvasImageSource, det: Rect): Rectified | null {
  try {
    const { SW, SH } = sizeOf(src);
    const p = plan(SW, SH, det);
    const read = (w: number, h: number) => {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(src, p.ax, p.ay, p.aw, p.ah, 0, 0, w, h);
      return ctx.getImageData(0, 0, w, h).data;
    };
    const small = read(p.W, p.H);
    const r = rectifyPixels(small, p.W, p.H, read(p.fw, p.fh), p.fw, p.fh, p.outW, p.outH);
    if (!r) return null;
    return finish(p, r.quad, (c) => c.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(r.px), p.outW, p.outH), 0, 0));
  } catch {
    return null;
  }
}

// Worker de corrección: el remuestreo (hasta ~1400x1000 px bilineal en JS)
// tarda cientos de ms en un teléfono y congelaba la cámara en el hilo principal.
let warpWorker: Worker | null | undefined;
let warpSeq = 0;
const warpPending = new Map<number, (r: { quad?: Quad; bitmap?: ImageBitmap } | null) => void>();

function getWarpWorker(): Worker | null {
  if (warpWorker !== undefined) return warpWorker;
  try {
    if (typeof Worker === "undefined" || typeof OffscreenCanvas === "undefined" || typeof createImageBitmap === "undefined") return (warpWorker = null);
    const w = new Worker(new URL("./warp.worker.ts", import.meta.url), { type: "module" });
    w.onmessage = (e) => {
      const d = e.data as { id: number; quad?: Quad; bitmap?: ImageBitmap; error?: string };
      const res = warpPending.get(d.id);
      warpPending.delete(d.id);
      res?.(d.error ? null : d);
    };
    w.onerror = () => {
      warpPending.forEach((r) => r(null));
      warpPending.clear();
      w.terminate();
      warpWorker = null; // respaldo síncrono desde ahora
    };
    return (warpWorker = w);
  } catch {
    return (warpWorker = null);
  }
}

/**
 * Igual que `rectify`, pero los bordes, la homografía y el remuestreo corren
 * en un Web Worker: el hilo principal solo recorta la zona a un ImageBitmap.
 */
export async function rectifyAsync(src: CanvasImageSource, det: Rect, timeoutMs = 3000): Promise<Rectified | null> {
  const w = getWarpWorker();
  if (!w) return rectify(src, det);
  try {
    const { SW, SH } = sizeOf(src);
    const p = plan(SW, SH, det);
    const bmp = await createImageBitmap(src as ImageBitmapSource, Math.round(p.ax), Math.round(p.ay), Math.max(1, Math.round(p.aw)), Math.max(1, Math.round(p.ah)), {
      resizeWidth: p.fw,
      resizeHeight: p.fh,
      resizeQuality: "medium",
    });
    const id = ++warpSeq;
    const r = await new Promise<{ quad?: Quad; bitmap?: ImageBitmap } | null>((resolve) => {
      const t = setTimeout(() => {
        warpPending.delete(id);
        resolve(null);
      }, timeoutMs);
      warpPending.set(id, (v) => {
        clearTimeout(t);
        resolve(v);
      });
      w.postMessage({ id, bitmap: bmp, W: p.W, H: p.H, outW: p.outW, outH: p.outH }, [bmp]);
    });
    if (!r?.quad || !r.bitmap) return null;
    const bitmap = r.bitmap;
    return finish(p, r.quad, (c) => {
      c.getContext("2d")!.drawImage(bitmap, 0, 0);
      bitmap.close();
    });
  } catch {
    return null;
  }
}

// ---------- Estabilidad y reflejos ----------

/** Miniatura en gris (16x22) de la carta y fracción de píxeles quemados (reflejos). */
export function frameStats(src: CanvasImageSource, r: Rect): { thumb: Float32Array; glare: number } | null {
  try {
    const W = 16, H = 22;
    const c = document.createElement("canvas");
    c.width = W * 4;
    c.height = H * 4;
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(src, r.x, r.y, r.w, r.h, 0, 0, c.width, c.height);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    const thumb = new Float32Array(W * H);
    let burnt = 0;
    for (let y = 0; y < c.height; y++)
      for (let x = 0; x < c.width; x++) {
        const k = (y * c.width + x) * 4;
        const g = 0.299 * d[k] + 0.587 * d[k + 1] + 0.114 * d[k + 2];
        if (d[k] > 245 && d[k + 1] > 245 && d[k + 2] > 245) burnt++;
        thumb[((y >> 2) * W) + (x >> 2)] += g / 16;
      }
    return { thumb, glare: burnt / (c.width * c.height) };
  } catch {
    return null;
  }
}

/** Diferencia media (0..255) entre dos miniaturas. */
export function thumbDiff(a: Float32Array | null, b: Float32Array | null): number {
  if (!a || !b || a.length !== b.length) return Infinity;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / a.length;
}
