"use client";
// Hash perceptual (dHash 9x8 en gris) del recorte de la carta y de las
// imágenes de cada versión, para ordenar versiones con el mismo código.

type Rect = { x: number; y: number; w: number; h: number };

export function dHash(src: CanvasImageSource, r?: Rect): string | undefined {
  try {
    const c = document.createElement("canvas");
    c.width = 9;
    c.height = 8;
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    ctx.imageSmoothingQuality = "high";
    if (r) ctx.drawImage(src, r.x, r.y, r.w, r.h, 0, 0, 9, 8);
    else ctx.drawImage(src, 0, 0, 9, 8);
    const d = ctx.getImageData(0, 0, 9, 8).data;
    const g = (x: number, y: number) => {
      const k = (y * 9 + x) * 4;
      return 0.299 * d[k] + 0.587 * d[k + 1] + 0.114 * d[k + 2];
    };
    let hex = "";
    for (let y = 0; y < 8; y++) {
      let byte = 0;
      for (let x = 0; x < 8; x++) byte = (byte << 1) | (g(x, y) > g(x + 1, y) ? 1 : 0);
      hex += byte.toString(16).padStart(2, "0");
    }
    return hex;
  } catch {
    return undefined; // canvas contaminado u otro error
  }
}

/** URL que se puede leer en canvas: data:/blob:/mismo origen tal cual, el resto por /api/img. */
export function readableUrl(url: string): string {
  if (!url || /^(data|blob):/.test(url) || url.startsWith("/")) return url;
  try {
    if (new URL(url).origin === location.origin) return url;
  } catch {
    return url;
  }
  return `/api/img?u=${encodeURIComponent(url)}`;
}

const cache = new Map<string, Promise<string | undefined>>();

function hashUrl(url: string): Promise<string | undefined> {
  let p = cache.get(url);
  if (!p) {
    p = new Promise<string | undefined>((resolve) => {
      const img = new Image();
      const t = setTimeout(() => resolve(undefined), 4000);
      img.onload = () => {
        clearTimeout(t);
        resolve(dHash(img));
      };
      img.onerror = () => {
        clearTimeout(t);
        resolve(undefined);
      };
      img.src = readableUrl(url);
    });
    cache.set(url, p);
    p.then((h) => h === undefined && cache.delete(url));
  }
  return p;
}

/** variantId -> hash de su imagen (las que no cargan se omiten). */
export async function variantHashes(vs: { variantId: string; image: string }[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  await Promise.all(
    vs.map(async (v) => {
      const h = v.image ? await hashUrl(v.image) : undefined;
      if (h) out[v.variantId] = h;
    }),
  );
  return out;
}
