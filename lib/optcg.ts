// Acceso a optcgapi.com (edición en inglés). Solo se usa en el servidor
// (rutas /api), así el teléfono no depende de CORS y podemos cachear.

const BASE = "https://optcgapi.com/api";

export type Variant = {
  variantId: string; // ej. OP05-119 o OP05-119_p1
  code: string; // ej. OP05-119
  name: string;
  label: string; // "Normal", "Parallel 1", ...
  image: string;
  rarity: string;
  setName: string;
  setId?: string; // id corto del set de origen si la API lo da (OP05, ST10...)
  color: string;
  type: string;
  price: number | null; // precio de mercado TCGplayer (USD)
  fullName: string; // nombre completo como en TCGplayer, ej. "Monkey.D.Luffy (Winner)"
  cost: string;
  power: string;
  counter: string;
  attribute: string;
  subTypes: string;
  life: string;
  text: string;
};

export type CardSummary = {
  code: string;
  name: string;
  setName: string;
  rarity: string;
  color: string;
  image: string;
  variants: number;
  // Todos los nombres completos de sus versiones (para buscar "Winner", "Manga"...)
  names: string[];
};

type Raw = Record<string, unknown>;

const str = (r: Raw, ...keys: string[]) => {
  for (const k of keys) {
    const v = r[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
};

const num = (r: Raw, ...keys: string[]) => {
  for (const k of keys) {
    const v = r[k];
    if (v === undefined || v === null || v === "") continue;
    const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[^0-9.]/g, ""));
    if (Number.isFinite(n)) return n;
  }
  return null;
};

// optcgapi pone la versión entre paréntesis en el nombre, p. ej.
// "Monkey.D.Luffy (119) (SP) (Gold)" o "Monkey.D.Luffy (OP05-119) (Reprint)".
function splitName(raw: string, code: string): { name: string; tags: string[] } {
  const tags: string[] = [];
  let name = raw.trim();
  for (let m = name.match(/\s*\(([^()]*)\)\s*$/); m; m = name.match(/\s*\(([^()]*)\)\s*$/)) {
    const tag = m[1].trim();
    // "(119)" o "(OP05-119)" solo repiten el número de la carta
    if (tag && !/^\d+$/.test(tag) && tag.toUpperCase() !== code) tags.unshift(tag);
    name = name.slice(0, m.index).trim();
  }
  return { name: name || raw.trim(), tags };
}

function variantLabel(variantId: string, tags: string[]): string {
  if (tags.length) return tags.join(" · ");
  const m = variantId.match(/_(p|r)(\d+)$/i);
  if (m) return m[1].toLowerCase() === "p" ? `Parallel ${m[2]}` : `Reprint ${m[2]}`;
  return "Normal";
}

export function normalize(r: Raw): Variant | null {
  const code = str(r, "card_set_id", "card_id", "id").toUpperCase();
  if (!code) return null;
  const variantId = str(r, "card_image_id") || code;
  const fullName = str(r, "card_name", "name", "product_name", "full_name");
  const { name, tags } = splitName(fullName, code);
  return {
    variantId,
    code,
    name: name || code,
    label: variantLabel(variantId, tags),
    image: str(r, "card_image", "image", "image_url"),
    rarity: str(r, "rarity"),
    setName: str(r, "set_name"),
    setId: str(r, "set_id", "set_code") || undefined,
    color: str(r, "card_color", "color"),
    type: str(r, "card_type", "type"),
    price: num(r, "market_price", "inventory_price"),
    fullName: fullName || code,
    cost: str(r, "card_cost", "cost"),
    power: str(r, "card_power", "power"),
    counter: str(r, "counter_amount", "counter"),
    attribute: str(r, "attribute", "card_attribute"),
    subTypes: str(r, "sub_types", "subtypes"),
    life: str(r, "life"),
    text: str(r, "card_text", "effect", "text"),
  };
}

async function getJson(url: string): Promise<Raw[]> {
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "OnePieceMasterCollector/0.1" },
    cache: "no-store",
  });
  if (!res.ok) return [];
  const data = await res.json().catch(() => null);
  if (Array.isArray(data)) return data as Raw[];
  if (data && typeof data === "object") {
    const d = data as Raw;
    if (Array.isArray(d.results)) return d.results as Raw[];
    if (Array.isArray(d.data)) return d.data as Raw[];
    if (d.card_set_id) return [d];
  }
  return [];
}

// Qué endpoint corresponde a cada tipo de código.
function endpointsFor(code: string): string[] {
  const id = encodeURIComponent(code);
  const sets = `${BASE}/sets/card/${id}/`;
  const decks = `${BASE}/decks/card/${id}/`;
  const promos = `${BASE}/promos/card/${id}/`;
  if (code.startsWith("ST")) return [decks, sets, promos];
  if (code.startsWith("P-")) return [promos, sets, decks];
  return [sets, decks, promos];
}

const byCode = new Map<string, { at: number; variants: Variant[] }>();
const DAY = 24 * 60 * 60 * 1000;

export async function getCard(code: string): Promise<Variant[]> {
  const hit = byCode.get(code);
  if (hit && Date.now() - hit.at < DAY) return hit.variants;
  for (const url of endpointsFor(code)) {
    const rows = await getJson(url);
    const variants = dedupe(rows.map(normalize).filter((v): v is Variant => !!v && v.code === code));
    if (variants.length) {
      byCode.set(code, { at: Date.now(), variants });
      return variants;
    }
  }
  return [];
}

function dedupe(vs: Variant[]): Variant[] {
  const seen = new Map<string, Variant>();
  for (const v of vs) if (!seen.has(v.variantId)) seen.set(v.variantId, v);
  return [...seen.values()].sort((a, b) => a.variantId.localeCompare(b.variantId, "en", { numeric: true }));
}

let all: { at: number; cards: CardSummary[] } | null = null;

export async function getAllCards(): Promise<CardSummary[]> {
  if (all && Date.now() - all.at < DAY) return all.cards;
  const lists = await Promise.all(
    ["allSetCards", "allSTCards", "allPromoCards"].map((p) => getJson(`${BASE}/${p}/`)),
  );
  const groups = new Map<string, CardSummary>();
  for (const v of lists.flat().map(normalize)) {
    if (!v) continue;
    const g = groups.get(v.code);
    if (g) {
      g.variants++;
      if (!g.names.includes(v.fullName)) g.names.push(v.fullName);
      if (!v.variantId.includes("_") && v.image) {
        g.image = v.image;
        g.setName = v.setName;
      }
    } else {
      groups.set(v.code, {
        code: v.code,
        name: v.name,
        setName: v.setName,
        rarity: v.rarity,
        color: v.color,
        image: v.image,
        variants: 1,
        names: [v.fullName],
      });
    }
  }
  const cards = [...groups.values()].sort((a, b) => a.code.localeCompare(b.code, "en", { numeric: true }));
  if (cards.length) all = { at: Date.now(), cards };
  return cards;
}
