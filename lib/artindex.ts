"use client";
// Índice precalculado de embeddings de todo el catálogo (lo genera
// scripts/build-embeddings.mjs en GitHub Actions). Son vectores int8 con una
// escala por fila: buscar es un producto escalar en el navegador, en ms.
// Si el archivo no existe (aún no se generó) se devuelve null y el escaneo
// sigue con el cálculo diferido por candidata (lib/embed.ts).
export type IndexMeta = {
  version: 1;
  /** versión del modelo/preprocesado; debe ser prefijo de Embedder.version */
  model: string;
  dims: number;
  count: number;
  quant: "int8";
  builtAt?: string;
  /** [variantId, code, set] por fila, en el mismo orden que index.bin */
  items: [string, string, string, ...unknown[]][];
  /** escala por fila: valor = int8 * scale */
  scales: number[];
};

export type ArtIndex = {
  meta: IndexMeta;
  data: Int8Array;
  rowOf: Map<string, number>;
};

export type Hit = { variantId: string; code: string; set: string; score: number };

let indexP: Promise<ArtIndex | null> | null = null;
let current: ArtIndex | null = null;

async function load(): Promise<ArtIndex | null> {
  try {
    const res = await fetch("/embeddings/index.json");
    if (!res.ok) return null;
    const meta = (await res.json()) as IndexMeta;
    if (meta.version !== 1 || meta.quant !== "int8" || !meta.items?.length) return null;
    const bin = await fetch("/embeddings/index.bin");
    if (!bin.ok) return null;
    const data = new Int8Array(await bin.arrayBuffer());
    if (data.length < meta.count * meta.dims || meta.scales.length !== meta.count || meta.items.length !== meta.count) return null;
    const rowOf = new Map(meta.items.map((it, i) => [it[0], i]));
    return (current = { meta, data, rowOf });
  } catch {
    return null;
  }
}

/** Carga el índice una vez por sesión. null si no hay. */
export function loadArtIndex(): Promise<ArtIndex | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  return (indexP ??= load());
}
export const artIndexNow = () => current;

/** ¿Sirve el índice para este modelo? (vectores comparables) */
export const compatible = (ix: ArtIndex, embedderVersion: string, dims: number) =>
  embedderVersion.startsWith(ix.meta.model) && dims === ix.meta.dims;

export function dot(ix: ArtIndex, row: number, q: ArrayLike<number>): number {
  const D = ix.meta.dims, o = row * D;
  let s = 0;
  for (let j = 0; j < D; j++) s += ix.data[o + j] * q[j];
  return s * ix.meta.scales[row];
}

/** Vector (float) de una fila. */
export function rowVector(ix: ArtIndex, row: number): Float32Array {
  const D = ix.meta.dims, v = new Float32Array(D), s = ix.meta.scales[row];
  for (let j = 0; j < D; j++) v[j] = ix.data[row * D + j] * s;
  return v;
}

/** Similitud de la consulta con cada variantId pedido (solo los que están en el índice). */
export function scoreIds(ix: ArtIndex, q: ArrayLike<number>, ids: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of ids) {
    const r = ix.rowOf.get(id);
    if (r !== undefined) out[id] = dot(ix, r, q);
  }
  return out;
}

/** Los k vecinos más cercanos en todo el catálogo (opcionalmente solo de ciertos sets). */
export function nearest(ix: ArtIndex, q: ArrayLike<number>, k = 8, sets: string[] = []): Hit[] {
  const best: Hit[] = [];
  const items = ix.meta.items;
  for (let r = 0; r < items.length; r++) {
    if (sets.length && !sets.includes(items[r][2])) continue;
    const score = dot(ix, r, q);
    if (best.length < k || score > best[best.length - 1].score) {
      const hit = { variantId: items[r][0], code: items[r][1], set: items[r][2], score };
      let i = best.length;
      while (i > 0 && best[i - 1].score < score) i--;
      best.splice(i, 0, hit);
      if (best.length > k) best.pop();
    }
  }
  return best;
}

/** Códigos distintos de los mejores, en orden, dentro de `window` de la 1.ª. */
export function topCodes(hits: Hit[], max = 3, window = 0.08): string[] {
  const out: string[] = [];
  for (const h of hits) {
    if (h.score < hits[0].score - window) break;
    if (!out.includes(h.code)) out.push(h.code);
    if (out.length >= max) break;
  }
  return out;
}
