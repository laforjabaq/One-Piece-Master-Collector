"use client";
// Cola del escaneo en lote. Se guarda en localStorage para sobrevivir a una recarga.
import { useSyncExternalStore } from "react";
import type { Variant } from "./optcg";

export type QueueItem = {
  code: string;
  qty: number;
  variants: Variant[];
  variantId: string; // versión elegida (por defecto la base)
  checked: boolean;
  at: number;
  foil?: boolean;
  lang?: string; // EN por defecto
};

const same = (a: Pick<QueueItem, "code" | "variantId" | "foil" | "lang">, b: Pick<QueueItem, "code" | "variantId" | "foil" | "lang">) =>
  a.code === b.code && a.variantId === b.variantId && !!a.foil === !!b.foil && (a.lang || "EN") === (b.lang || "EN");

const KEY = "opmc.bulkQueue.v1";
const SIZE_KEY = "opmc.bulkSize.v1";
const listeners = new Set<() => void>();
let cache: QueueItem[] | null = null;
const EMPTY: QueueItem[] = [];

function read(): QueueItem[] {
  if (cache) return cache;
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "[]");
    cache = Array.isArray(v) ? v : [];
  } catch {
    cache = [];
  }
  return cache!;
}

function write(next: QueueItem[]) {
  cache = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* lleno o bloqueado */
  }
  listeners.forEach((l) => l());
}

export function useQueue(): QueueItem[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    read,
    () => EMPTY,
  );
}

export const readQueue = () => read();

export const queueCount = (q: QueueItem[]) => q.reduce((s, i) => s + i.qty, 0);

// La versión base: la que no tiene sufijo _p1/_r1 o, si no hay, la primera.
export const baseVariant = (vs: Variant[]) => vs.find((v) => !v.variantId.includes("_")) ?? vs[0];

// Ventana para no contar varias veces la misma carta mientras se sostiene frente a la cámara.
export const DEDUPE_MS = 4000;
const lastSeen = new Map<string, number>();

/** true si el código se leyó hace menos de DEDUPE_MS (sigue frente a la cámara). */
export function recentlySeen(code: string, now = Date.now()): boolean {
  const prev = lastSeen.get(code);
  return prev !== undefined && now - prev < DEDUPE_MS;
}
export function markSeen(code: string, now = Date.now()) {
  lastSeen.set(code, now);
}

/** Devuelve true si se añadió (o sumó) a la cola; false si fue una lectura repetida. */
export function enqueue(
  code: string,
  variants: Variant[],
  opts: { force?: boolean; now?: number; variantId?: string; foil?: boolean; lang?: string } = {},
): boolean {
  const now = opts.now ?? Date.now();
  const seen = recentlySeen(code, now);
  lastSeen.set(code, now);
  if (!opts.force && seen) return false;
  const variantId = opts.variantId ?? baseVariant(variants)?.variantId ?? code;
  const q = [...read()];
  const extra = { ...(opts.foil ? { foil: true } : {}), ...(opts.lang && opts.lang !== "EN" ? { lang: opts.lang } : {}) };
  const i = q.findIndex((x) => same(x, { code, variantId, ...extra }));
  if (i >= 0) q[i] = { ...q[i], qty: q[i].qty + 1, at: now };
  else q.push({ code, qty: 1, variants, variantId, checked: true, at: now, ...extra });
  write(q);
  return true;
}

export function updateItem(item: Pick<QueueItem, "code" | "variantId" | "foil" | "lang">, patch: Partial<QueueItem>) {
  write(read().map((x) => (same(x, item) ? { ...x, ...patch } : x)));
}

/** Edición masiva: aplica `patch(item)` a cada elemento marcado y junta los que queden iguales. */
export function updateChecked(patch: (i: QueueItem) => Partial<QueueItem>, setAll?: boolean) {
  const out: QueueItem[] = [];
  for (const x0 of read()) {
    const x = setAll === undefined ? x0 : { ...x0, checked: setAll };
    const y = x.checked && setAll === undefined ? { ...x, ...patch(x) } : x;
    if (y.lang === "EN") delete y.lang;
    if (!y.foil) delete y.foil;
    const j = out.findIndex((o) => same(o, y));
    if (j >= 0) out[j] = { ...out[j], qty: out[j].qty + y.qty };
    else out.push(y);
  }
  write(out);
}

export function removeChecked() {
  write(read().filter((x) => !x.checked));
}

export const itemVariant = (i: QueueItem) => i.variants.find((x) => x.variantId === i.variantId) ?? i.variants[0];
/** Valor de mercado (TCGplayer) de la cola, en USD. */
export const queueValue = (q: QueueItem[]) => q.reduce((s, i) => s + (itemVariant(i)?.price ?? 0) * i.qty, 0);

export function clearQueue() {
  lastSeen.clear();
  write([]);
}

export function getBatchSize(): number {
  try {
    return localStorage.getItem(SIZE_KEY) === "50" ? 50 : 30;
  } catch {
    return 30;
  }
}
export function setBatchSize(n: number) {
  try {
    localStorage.setItem(SIZE_KEY, String(n));
  } catch {
    /* nada */
  }
}
