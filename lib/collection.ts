"use client";
// Colección guardada en el teléfono (localStorage). En una fase siguiente
// se sincroniza con Supabase para tenerla en la nube y en varios dispositivos.
import { useSyncExternalStore } from "react";

export type Entry = {
  variantId: string;
  code: string;
  name: string;
  label: string;
  image: string;
  rarity: string;
  setName: string;
  price: number | null;
  qty: number;
  addedAt: string;
  updatedAt: string;
};

type Collection = Record<string, Entry>;

const KEY = "opmc.collection.v1";
const listeners = new Set<() => void>();
let cache: Collection | null = null;
const EMPTY: Collection = {};

function read(): Collection {
  if (cache) return cache;
  try {
    cache = JSON.parse(localStorage.getItem(KEY) || "{}") as Collection;
  } catch {
    cache = {};
  }
  return cache;
}

function write(next: Collection) {
  cache = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* almacenamiento lleno o bloqueado: se mantiene en memoria */
  }
  listeners.forEach((l) => l());
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === KEY) {
      cache = null;
      listeners.forEach((l) => l());
    }
  });
}

export function useCollection(): Collection {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    read,
    () => EMPTY,
  );
}

export function addToCollection(card: Omit<Entry, "qty" | "addedAt" | "updatedAt">, qty: number) {
  const col = { ...read() };
  const now = new Date().toISOString();
  const prev = col[card.variantId];
  col[card.variantId] = {
    ...card,
    qty: (prev?.qty ?? 0) + qty,
    addedAt: prev?.addedAt ?? now,
    updatedAt: now,
  };
  write(col);
}

export function setQty(variantId: string, qty: number) {
  const col = { ...read() };
  if (!col[variantId]) return;
  if (qty <= 0) delete col[variantId];
  else col[variantId] = { ...col[variantId], qty, updatedAt: new Date().toISOString() };
  write(col);
}

export function exportCollection(): string {
  return JSON.stringify({ app: "one-piece-master-collector", version: 1, cards: Object.values(read()) }, null, 2);
}

export function importCollection(json: string): number {
  const data = JSON.parse(json);
  const cards: Entry[] = Array.isArray(data) ? data : data.cards;
  if (!Array.isArray(cards)) throw new Error("Archivo no válido");
  const col = { ...read() };
  for (const c of cards) if (c && c.variantId && c.qty > 0) col[c.variantId] = c;
  write(col);
  return cards.length;
}

export const usd = (n: number | null | undefined) =>
  n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD" });
