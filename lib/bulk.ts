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
};

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

/** Devuelve true si se añadió (o sumó) a la cola; false si fue una lectura repetida. */
export function enqueue(code: string, variants: Variant[], opts: { force?: boolean; now?: number } = {}): boolean {
  const now = opts.now ?? Date.now();
  const prev = lastSeen.get(code);
  lastSeen.set(code, now);
  if (!opts.force && prev !== undefined && now - prev < DEDUPE_MS) return false;
  const q = [...read()];
  const i = q.findIndex((x) => x.code === code);
  if (i >= 0) q[i] = { ...q[i], qty: q[i].qty + 1, at: now };
  else q.push({ code, qty: 1, variants, variantId: baseVariant(variants)?.variantId ?? code, checked: true, at: now });
  write(q);
  return true;
}

export function updateItem(code: string, patch: Partial<QueueItem>) {
  write(read().map((x) => (x.code === code ? { ...x, ...patch } : x)));
}

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
