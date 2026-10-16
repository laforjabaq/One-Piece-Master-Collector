// Metadatos derivados de cada versión (set, rareza, versión/sello) y el
// ranking de versiones a partir de las pistas del escaneo. Sin dependencias
// del navegador: se usa en cliente y servidor.
import type { Variant } from "./optcg";

export type Facet = "set" | "rarity" | "version";
export type VariantMeta = { set: string; rarity: string; version: string };

// Orden importa: la primera etiqueta que encaja gana.
const VERSIONS: [string, RegExp][] = [
  ["Winner", /\bwinner\b/i],
  ["Judge", /\bjudge\b/i],
  ["Pre-release", /\bpre-?release\b/i],
  ["Championship", /\bchampionship|\bregionals?\b|\btreasure cup\b/i],
  ["Tournament", /\btournament|\bstore (event|championship)|\boffline\b/i],
  ["Anniversary", /\banniversary\b/i],
  ["Manga", /\bmanga\b/i],
  ["SP", /\bSP\b|\bspecial\b/],
  ["Parallel", /\bparallel|\balt(ernate)?\.? art\b|\b(AA)\b/i],
  ["Reprint", /\breprint\b/i],
  ["Promo", /\bpromo|\bevent\b|\bpack\b/i],
];

/** Etiqueta de versión normalizada a partir del nombre, la etiqueta y el set. */
export function versionOf(v: Pick<Variant, "variantId" | "label" | "fullName" | "setName" | "rarity">): string {
  const hay = `${v.label ?? ""} ${v.fullName ?? ""}`;
  for (const [name, re] of VERSIONS) if (re.test(hay)) return name;
  if (/^SP$/i.test(v.rarity ?? "")) return "SP";
  if (/_p\d+$/i.test(v.variantId)) return "Parallel";
  if (/_r\d+$/i.test(v.variantId)) return "Reprint";
  // Set de promos sin etiqueta propia
  for (const [name, re] of VERSIONS.slice(0, 6)) if (re.test(v.setName ?? "")) return name;
  if (/\bpromo/i.test(v.setName ?? "")) return "Promo";
  return "Base";
}

/** Set de origen: id corto (OP05, ST10, EB01, PRB01...) si se puede, si no el nombre. */
export function setOf(v: Pick<Variant, "setName"> & { setId?: string }): string {
  if (v.setId) return v.setId.replace(/-(?=\d)/, "").toUpperCase();
  const m = (v.setName ?? "").match(/\b(OP|ST|EB|PRB)-?(\d{2})\b/i);
  if (m) return `${m[1].toUpperCase()}${m[2]}`;
  return (v.setName ?? "").trim() || "—";
}

export const metaOf = (v: Variant & { setId?: string }): VariantMeta => ({
  set: setOf(v),
  rarity: (v.rarity ?? "").trim().toUpperCase() || "—",
  version: versionOf(v),
});

export const metaLine = (v: Variant) => {
  const m = metaOf(v);
  return [m.set, m.rarity, m.version].filter((x) => x && x !== "—").join(" · ");
};

export const FACETS: { key: Facet; label: string }[] = [
  { key: "set", label: "Set" },
  { key: "rarity", label: "Rareza" },
  { key: "version", label: "Versión/Sello" },
];

/** Valores y cantidades por faceta; solo las que de verdad separan las versiones. */
export function facetsOf(vs: Variant[]): { key: Facet; label: string; values: [string, number][] }[] {
  return FACETS.map((f) => {
    const counts = new Map<string, number>();
    for (const v of vs) {
      const k = metaOf(v)[f.key];
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    return { ...f, values: [...counts.entries()] };
  }).filter((f) => f.values.length > 1);
}

export type Filters = Partial<Record<Facet, string>>;
export const applyFilters = (vs: Variant[], f: Filters) =>
  vs.filter((v) => {
    const m = metaOf(v);
    return (Object.keys(f) as Facet[]).every((k) => !f[k] || m[k] === f[k]);
  });

// ---------- Pistas del escaneo ----------

export type ScanHints = {
  rarity?: string; // C, UC, R, SR, SEC, L, SP, P
  stamps: string[]; // WINNER, JUDGE, PRE-RELEASE, CHAMPIONSHIP, ANNIVERSARY...
  hash?: string; // dHash de 64 bits en hex
  art?: ArtScores; // similitud de arte con cada candidata (embeddings en el dispositivo)
};

export type ArtScores = {
  /** variantId -> similitud coseno del arte (carta completa) */
  art: Record<string, number>;
  /** variantId -> similitud de la zona del sello, solo entre versiones con el mismo arte */
  stamp?: Record<string, number>;
  /** ventaja mínima (coseno) de la 1.ª sobre la 2.ª para no preguntar */
  margin: number;
};

// Puntos del ranking que vale exactamente el margen de arte: así una ventaja
// igual al margen equivale al hueco que hace falta para aceptar sola.
const GAP = 1.5;

const STAMPS: [string, RegExp][] = [
  ["WINNER", /W[I1l]NN[E3]R/],
  ["JUDGE", /JUDG[E3]/],
  ["PRE-RELEASE", /PRE-?R[E3]L[E3]AS[E3]/],
  ["CHAMPIONSHIP", /CHAMP[I1]ONSH[I1]P/],
  ["ANNIVERSARY", /ANN[I1]V[E3]RSARY/],
  ["TOURNAMENT", /TOURNAM[E3]NT/],
  ["MANGA", /MANGA/],
];
const RARITIES = ["SEC", "UC", "SR", "SP", "L", "R", "C", "P"];

/** Extrae rareza y sellos del texto OCR (la franja inferior y la ilustración). */
export function parseHints(text: string, code = ""): Omit<ScanHints, "hash"> {
  const up = text.toUpperCase().replace(code.toUpperCase(), " ");
  const stamps = STAMPS.filter(([, re]) => re.test(up)).map(([s]) => s);
  const tokens = up.split(/[^A-Z]+/).filter(Boolean);
  // Las de varias letras son fiables en cualquier lado; las de una letra solo
  // si aparecen sueltas en la franja de abajo (que es lo que se pasa aquí).
  const rarity = RARITIES.find((r) => tokens.includes(r) && (r.length > 1 || tokens.length <= 6));
  return { rarity, stamps };
}

const STAMP_VERSION: Record<string, string> = {
  WINNER: "Winner",
  JUDGE: "Judge",
  "PRE-RELEASE": "Pre-release",
  CHAMPIONSHIP: "Championship",
  ANNIVERSARY: "Anniversary",
  TOURNAMENT: "Tournament",
  MANGA: "Manga",
};

export function hamming(a: string, b: string): number {
  let d = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) {
      d += x & 1;
      x >>= 1;
    }
  }
  return d;
}

export type Ranked = { variant: Variant; score: number; why: string[]; art?: number };
export type Ranking = { ranked: Ranked[]; best: Variant | null; ambiguous: boolean; matched: string[]; art?: number };

/**
 * Ordena las versiones por las pistas del escaneo, el hash de imagen
 * (hashes: variantId -> dHash) y la última elección del usuario (desempate).
 */
export function rankVariants(vs: Variant[], hints: ScanHints | null, hashes: Record<string, string> = {}, last?: string): Ranking {
  const matched = new Set<string>();
  const art = hints?.art;
  const artVals = art ? Object.values(art.art) : [];
  const artMax = artVals.length ? Math.max(...artVals) : 0;
  const stampVals = art?.stamp ? Object.values(art.stamp) : [];
  const stampMax = stampVals.length ? Math.max(...stampVals) : 0;
  const k = GAP / (art?.margin || 0.04);
  const ranked: Ranked[] = vs.map((variant) => {
    const m = metaOf(variant);
    const why: string[] = [];
    let score = 0;
    if (hints) {
      for (const s of hints.stamps) {
        const want = STAMP_VERSION[s];
        const hit = want && (m.version === want || new RegExp(want, "i").test(`${variant.fullName} ${variant.setName}`));
        if (hit) {
          score += 3;
          why.push(s);
          matched.add(s);
        } else score -= 1;
      }
      if (hints.rarity) {
        if (m.rarity === hints.rarity || (hints.rarity === "SP" && m.version === "SP")) {
          score += 1.5;
          why.push(hints.rarity);
          matched.add(hints.rarity);
        }
      }
      const h = hashes[variant.variantId];
      if (hints.hash && h) {
        const d = hamming(hints.hash, h);
        // 0 bits = idéntica (+3); 32 o más = no se parece (≤0)
        // Con arte, el hash es un desempate débil (es sensible a reflejos y recorte)
        score += (art ? 0.3 : 1) * Math.max(-1, 3 * (1 - d / 24));
      }
      const a = art?.art[variant.variantId];
      if (a !== undefined) {
        // 0 para la que más se parece; negativo según lo que se aleja (tope -6)
        score += Math.max(-6, k * (a - artMax));
        const st = art?.stamp?.[variant.variantId];
        if (st !== undefined && stampVals.length > 1) score += Math.max(-3, k * (st - stampMax));
      }
    }
    if (last && variant.variantId === last) {
      score += 0.75;
      why.push("última elegida");
    }
    const a = art?.art[variant.variantId];
    return a === undefined ? { variant, score, why } : { variant, score, why, art: a };
  });
  ranked.sort((a, b) => b.score - a.score);
  const gap = ranked.length > 1 ? ranked[0].score - ranked[1].score : Infinity;
  return {
    ranked,
    best: ranked[0]?.variant ?? null,
    ambiguous: ranked.length > 1 && gap < GAP,
    matched: [...matched],
    art: ranked[0]?.art,
  };
}

/** "Coincidencia de arte: 92%" */
export const artLabel = (sim?: number) => (sim === undefined ? "" : `Coincidencia de arte: ${Math.round(Math.max(0, Math.min(1, sim)) * 100)}%`);

// ---------- Recordar la última elección por código ----------

const LAST_KEY = "opmc.lastVariant.v1";
export function lastChoice(code: string): string | undefined {
  try {
    return JSON.parse(localStorage.getItem(LAST_KEY) || "{}")[code];
  } catch {
    return undefined;
  }
}
export function rememberChoice(code: string, variantId: string) {
  try {
    const m = JSON.parse(localStorage.getItem(LAST_KEY) || "{}");
    m[code] = variantId;
    localStorage.setItem(LAST_KEY, JSON.stringify(m));
  } catch {
    /* nada */
  }
}

// Pistas del último escaneo, para la página de la carta (1 a 1).
const HINT_KEY = "opmc.scanHints.v1";
export function saveHints(code: string, hints: ScanHints) {
  try {
    sessionStorage.setItem(HINT_KEY, JSON.stringify({ code, hints, at: Date.now() }));
  } catch {
    /* nada */
  }
}
export function takeHints(code: string): ScanHints | null {
  try {
    const d = JSON.parse(sessionStorage.getItem(HINT_KEY) || "null");
    if (d && d.code === code && Date.now() - d.at < 5 * 60_000) return d.hints;
  } catch {
    /* nada */
  }
  return null;
}

export const hintSummary = (r: Ranking | null) =>
  [r?.matched.length ? `Detectado: ${r.matched.join(" · ")}` : "", artLabel(r?.art)].filter(Boolean).join(" · ");
