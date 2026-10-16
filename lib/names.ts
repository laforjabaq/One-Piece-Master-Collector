"use client";
// Índice de nombres de carta para el embudo Nombre → Código → Arte.
// Se arma en el cliente a partir de /api/cards y se guarda en IndexedDB (TTL 24 h).
// Coincidencia difusa sin dependencias: Levenshtein normalizado + trigramas.
import type { CardSummary } from "./optcg";

export type NameEntry = { name: string; key: string; codes: string[]; variants: number; grams: Set<string> };
export type NameMatch = { name: string; score: number; codes: string[]; variants: number };

/** minúsculas, sin acentos ni puntuación: "Monkey.D.Luffy" → "monkey d luffy" */
export function normalizeName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

const trigrams = (s: string) => {
  const t = `  ${s.replace(/ /g, "")} `;
  const g = new Set<string>();
  for (let i = 0; i < t.length - 2; i++) g.add(t.slice(i, i + 3));
  return g;
};

/** Similitud 0..1: lo mejor entre Levenshtein normalizado y Dice de trigramas. */
export function similarity(a: string, b: string, gb = trigrams(b)): number {
  if (!a || !b) return 0;
  const lev = 1 - levenshtein(a, b) / Math.max(a.length, b.length);
  const ga = trigrams(a);
  let common = 0;
  for (const g of ga) if (gb.has(g)) common++;
  const dice = (2 * common) / (ga.size + gb.size);
  return Math.max(lev, dice);
}

export function buildIndex(cards: Pick<CardSummary, "code" | "name" | "variants">[]): NameEntry[] {
  const m = new Map<string, NameEntry>();
  for (const c of cards) {
    const key = normalizeName(c.name);
    if (!key) continue;
    const e = m.get(key);
    if (e) {
      if (!e.codes.includes(c.code)) e.codes.push(c.code);
      e.variants += c.variants || 1;
    } else m.set(key, { name: c.name, key, codes: [c.code], variants: c.variants || 1, grams: trigrams(key) });
  }
  return [...m.values()];
}

export const MIN_NAME_SCORE = 0.72;

/**
 * Nombres del índice que encajan con el texto del OCR, mejor primero.
 * Devuelve el mejor y los que quedan a menos de 0.05 de él (ambiguos), máx. 3.
 */
export function matchName(index: NameEntry[], ocr: string, min = MIN_NAME_SCORE): NameMatch[] {
  // El OCR puede traer basura alrededor: se prueba la línea completa y cada
  // ventana de palabras consecutivas.
  const words = normalizeName(ocr).split(" ").filter((w) => w.length > 0);
  if (!words.join("").length || words.join("").length < 3) return [];
  const probes = new Set<string>();
  for (let i = 0; i < words.length; i++) for (let j = i + 1; j <= words.length; j++) probes.add(words.slice(i, j).join(" "));
  const scored: NameMatch[] = [];
  for (const e of index) {
    let best = 0;
    for (const p of probes) {
      if (Math.abs(p.length - e.key.length) > Math.max(4, e.key.length * 0.5)) continue;
      best = Math.max(best, similarity(p, e.key, e.grams));
      if (best === 1) break;
    }
    if (best >= min) scored.push({ name: e.name, score: best, codes: e.codes, variants: e.variants });
  }
  scored.sort((a, b) => b.score - a.score || b.variants - a.variants);
  return scored.filter((s) => s.score >= scored[0].score - 0.05).slice(0, 3);
}

// ---------- Carga y caché ----------

const DB = "opmc-names";
const TTL = 24 * 3600_000;
type Stored = { at: number; cards: Pick<CardSummary, "code" | "name" | "variants">[] };

function idb<T>(fn: (s: IDBObjectStore) => IDBRequest, mode: IDBTransactionMode = "readonly"): Promise<T | undefined> {
  return new Promise((res) => {
    try {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore("kv");
      r.onerror = () => res(undefined);
      r.onsuccess = () => {
        try {
          const q = fn(r.result.transaction("kv", mode).objectStore("kv"));
          q.onsuccess = () => res(q.result as T);
          q.onerror = () => res(undefined);
        } catch {
          res(undefined);
        }
      };
    } catch {
      res(undefined);
    }
  });
}

let indexP: Promise<NameEntry[] | null> | null = null;
let ready: NameEntry[] | null = null;

/** Índice de nombres (caché en memoria → IndexedDB → /api/cards). null si no hay catálogo. */
export function loadNameIndex(timeoutMs = 8000): Promise<NameEntry[] | null> {
  indexP ??= (async () => {
    const cached = await idb<Stored>((s) => s.get("index"));
    if (cached && Date.now() - cached.at < TTL && cached.cards?.length) return (ready = buildIndex(cached.cards));
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch("/api/cards", { signal: ctl.signal });
      const data = res.ok ? await res.json() : null;
      const cards = ((data?.cards ?? []) as CardSummary[]).map((c) => ({ code: c.code, name: c.name, variants: c.variants }));
      if (!cards.length) throw new Error("vacío");
      await idb((s) => s.put({ at: Date.now(), cards } satisfies Stored, "index"), "readwrite");
      return (ready = buildIndex(cards));
    } catch {
      // Catálogo caducado pero mejor que nada
      if (cached?.cards?.length) return (ready = buildIndex(cached.cards));
      indexP = null; // reintenta más adelante
      return null;
    } finally {
      clearTimeout(t);
    }
  })();
  return indexP;
}

/** El índice si ya está cargado (no espera). */
export const nameIndexNow = () => ready;
