// Núcleo puro de la corrección de perspectiva (sin DOM): lo usan lib/warp.ts
// en el hilo principal y lib/warp.worker.ts en el Worker.
// Corrección de perspectiva sin OpenCV: busca las 4 esquinas de la carta
// dentro de su rectángulo detectado y la "endereza" a un rectángulo canónico
// con una homografía (8 incógnitas, eliminación de Gauss). Así el embedding y
// los recortes fijos del OCR (código abajo a la derecha, nombre) ven siempre
// la carta igual aunque esté inclinada.
export type Rect = { x: number; y: number; w: number; h: number };
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

/**
 * Núcleo de la corrección (puro, vale en un Worker): `small` es la zona de
 * búsqueda reducida (W x H) para hallar bordes y esquinas; `full` es la misma
 * zona a resolución útil (fw x fh). Devuelve las esquinas en coordenadas de
 * `small` y los píxeles enderezados (outW x outH), o null si no hay que enderezar.
 */
export function rectifyPixels(
  small: Uint8ClampedArray, W: number, H: number,
  full: Uint8ClampedArray, fw: number, fh: number,
  outW: number, outH: number,
): { quad: Quad; px: Uint8ClampedArray } | null {
  const g = new Float32Array(W * H);
  for (let i = 0, j = 0; i < small.length; i += 4, j++) g[j] = 0.299 * small[i] + 0.587 * small[i + 1] + 0.114 * small[i + 2];
  const edges = new Uint8Array(W * H);
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++) {
      const k = y * W + x;
      if (Math.abs(g[k + 1] - g[k - 1]) + Math.abs(g[k + W] - g[k - W]) > 60) edges[k] = 1;
    }
  const q = cornersFromEdges(edges, W, H);
  if (!q || !isSkewed(q)) return null;
  const kx = fw / W, ky = fh / H;
  const local = q.map((p) => ({ x: p.x * kx, y: p.y * ky })) as Quad;
  return { quad: q, px: warpPixels(full, fw, fh, local, outW, outH) };
}

