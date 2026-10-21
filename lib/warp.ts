// Corrección de perspectiva sin OpenCV: busca las 4 esquinas de la carta
// dentro de su rectángulo detectado y la "endereza" a un rectángulo canónico
// con una homografía (8 incógnitas, eliminación de Gauss). Así el embedding y
// los recortes fijos del OCR (código abajo a la derecha, nombre) ven siempre
// la carta igual aunque esté inclinada.
type Rect = { x: number; y: number; w: number; h: number };
export type Pt = { x: number; y: number };
/** Esquinas en orden: arriba-izq, arriba-der, abajo-der, abajo-izq. */
export type Quad = [Pt, Pt, Pt, Pt];

/** Homografía 3x3 (h33 = 1) que lleva `from[i]` a `to[i]`. null si es degenerada. */
export function homography(from: Quad, to: Quad): number[] | null {
  const A: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = from[i], { x: u, y: v } = to[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  // Gauss con pivoteo parcial sobre la matriz aumentada 8x9
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-10) return null;
    [A[c], A[p]] = [A[p], A[c]];
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k < 9; k++) A[r][k] -= f * A[c][k];
    }
  }
  return [...A.map((row, i) => row[8] / row[i]), 1];
}

export function apply(H: number[], p: Pt): Pt {
  const w = H[6] * p.x + H[7] * p.y + H[8];
  return { x: (H[0] * p.x + H[1] * p.y + H[2]) / w, y: (H[3] * p.x + H[4] * p.y + H[5]) / w };
}

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Esquinas a partir de un mapa de bordes (W x H, 1 = borde fuerte): los puntos
 * de borde extremos en las 4 diagonales. Devuelve null si el cuadrilátero no
 * tiene forma de carta (proporción 63:88 aprox., convexo, tamaño razonable).
 */
export function cornersFromEdges(edges: Uint8Array, W: number, H: number): Quad | null {
  let tl: Pt | null = null, tr: Pt | null = null, br: Pt | null = null, bl: Pt | null = null;
  let s0 = Infinity, s1 = -Infinity, s2 = -Infinity, s3 = Infinity;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (!edges[y * W + x]) continue;
      const a = x + y, d = x - y;
      if (a < s0) { s0 = a; tl = { x, y }; }
      if (a > s2) { s2 = a; br = { x, y }; }
      if (d > s1) { s1 = d; tr = { x, y }; }
      if (d < s3) { s3 = d; bl = { x, y }; }
    }
  if (!tl || !tr || !br || !bl) return null;
  const q: Quad = [tl, tr, br, bl];
  return validQuad(q, W, H) ? q : null;
}

export function validQuad(q: Quad, W: number, H: number): boolean {
  const top = dist(q[0], q[1]), bottom = dist(q[3], q[2]), left = dist(q[0], q[3]), right = dist(q[1], q[2]);
  const w = (top + bottom) / 2, h = (left + right) / 2;
  if (w < W * 0.3 || h < H * 0.3) return false;
  const ratio = w / h;
  if (ratio < 0.58 || ratio > 0.86) return false;
  // lados opuestos parecidos (perspectiva moderada)
  if (Math.min(top, bottom) / Math.max(top, bottom) < 0.7 || Math.min(left, right) / Math.max(left, right) < 0.7) return false;
  // convexo: todos los productos cruzados con el mismo signo
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4], c = q[(i + 2) % 4];
    const cr = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    const s = Math.sign(cr);
    if (!s || (sign && s !== sign)) return false;
    sign = s;
  }
  return true;
}

/** ¿Está la carta inclinada lo bastante para que valga la pena enderezarla? */
export function isSkewed(q: Quad, tol = 0.025): boolean {
  const xs = q.map((p) => p.x), ys = q.map((p) => p.y);
  const W = Math.max(...xs) - Math.min(...xs), H = Math.max(...ys) - Math.min(...ys);
  const t = tol * Math.max(W, H);
  return Math.abs(q[0].y - q[1].y) > t || Math.abs(q[3].y - q[2].y) > t || Math.abs(q[0].x - q[3].x) > t || Math.abs(q[1].x - q[2].x) > t;
}

/** Remuestreo bilineal: devuelve RGBA de outW x outH con la carta enderezada. */
export function warpPixels(src: Uint8ClampedArray, sw: number, sh: number, q: Quad, outW: number, outH: number): Uint8ClampedArray {
  const dst: Quad = [{ x: 0, y: 0 }, { x: outW - 1, y: 0 }, { x: outW - 1, y: outH - 1 }, { x: 0, y: outH - 1 }];
  const H = homography(dst, q);
  const out = new Uint8ClampedArray(outW * outH * 4);
  if (!H) return out;
  for (let v = 0; v < outH; v++)
    for (let u = 0; u < outW; u++) {
      const w = H[6] * u + H[7] * v + H[8];
      const x = (H[0] * u + H[1] * v + H[2]) / w, y = (H[3] * u + H[4] * v + H[5]) / w;
      const x0 = Math.max(0, Math.min(sw - 2, Math.floor(x))), y0 = Math.max(0, Math.min(sh - 2, Math.floor(y)));
      const fx = Math.max(0, Math.min(1, x - x0)), fy = Math.max(0, Math.min(1, y - y0));
      const o = (v * outW + u) * 4;
      const i00 = (y0 * sw + x0) * 4, i10 = i00 + 4, i01 = i00 + sw * 4, i11 = i01 + 4;
      for (let c = 0; c < 4; c++) {
        const top = src[i00 + c] * (1 - fx) + src[i10 + c] * fx;
        const bot = src[i01 + c] * (1 - fx) + src[i11 + c] * fx;
        out[o + c] = top * (1 - fy) + bot * fy;
      }
    }
  return out;
}

// ---------- Navegador ----------

const CARD_RATIO = 63 / 88;

/**
 * Si la carta detectada en `det` está inclinada, devuelve un canvas con la
 * carta enderezada (y su rect, que es el canvas entero). Si no está inclinada
 * o no se encuentran 4 esquinas fiables, null: se sigue con el recorte normal.
 */
export function rectify(src: CanvasImageSource, det: Rect): { src: HTMLCanvasElement; card: Rect; quad: Quad } | null {
  try {
    const SW = (src as HTMLVideoElement).videoWidth || (src as HTMLCanvasElement).width || (src as HTMLImageElement).naturalWidth;
    const SH = (src as HTMLVideoElement).videoHeight || (src as HTMLCanvasElement).height || (src as HTMLImageElement).naturalHeight;
    // zona de búsqueda: el rect detectado con margen
    const m = 0.06;
    const ax = Math.max(0, det.x - det.w * m), ay = Math.max(0, det.y - det.h * m);
    const aw = Math.min(SW - ax, det.w * (1 + 2 * m)), ah = Math.min(SH - ay, det.h * (1 + 2 * m));
    // 1) mapa de bordes reducido (~240 px)
    const S = 240 / Math.max(aw, ah);
    const W = Math.max(16, Math.round(aw * S)), H = Math.max(16, Math.round(ah * S));
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(src, ax, ay, aw, ah, 0, 0, W, H);
    const d = ctx.getImageData(0, 0, W, H).data;
    const g = new Float32Array(W * H);
    for (let i = 0, j = 0; i < d.length; i += 4, j++) g[j] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const edges = new Uint8Array(W * H);
    for (let y = 1; y < H - 1; y++)
      for (let x = 1; x < W - 1; x++) {
        const k = y * W + x;
        if (Math.abs(g[k + 1] - g[k - 1]) + Math.abs(g[k + W] - g[k - W]) > 60) edges[k] = 1;
      }
    const q = cornersFromEdges(edges, W, H);
    if (!q || !isSkewed(q)) return null;
    // 2) esquinas en coordenadas de la fuente y remuestreo a resolución útil para OCR
    const quadSrc = q.map((p) => ({ x: ax + p.x / S, y: ay + p.y / S })) as Quad;
    const outH = Math.round(Math.min(1400, Math.max(700, det.h)));
    const outW = Math.round(outH * CARD_RATIO);
    // fuente a resolución limitada (lado largo ≤ 1600) para no copiar fotos 4K enteras
    const k = Math.min(1, 1600 / Math.max(aw, ah));
    const fw = Math.round(aw * k), fh = Math.round(ah * k);
    const fc = document.createElement("canvas");
    fc.width = fw;
    fc.height = fh;
    const fctx = fc.getContext("2d", { willReadFrequently: true })!;
    fctx.drawImage(src, ax, ay, aw, ah, 0, 0, fw, fh);
    const local = quadSrc.map((p) => ({ x: (p.x - ax) * k, y: (p.y - ay) * k })) as Quad;
    const px = warpPixels(fctx.getImageData(0, 0, fw, fh).data, fw, fh, local, outW, outH);
    const out = document.createElement("canvas");
    out.width = outW;
    out.height = outH;
    out.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(px), outW, outH), 0, 0);
    document.documentElement.dataset.warped = String(Number(document.documentElement.dataset.warped || 0) + 1);
    return { src: out, card: { x: 0, y: 0, w: outW, h: outH }, quad: quadSrc };
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
