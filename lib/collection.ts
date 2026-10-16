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
  fullName?: string;
  // true = carta registrada con el escaneo en lote (sección "Bulk").
  // Se guarda con la clave `${variantId}|bulk` para no mezclarla con la normal.
  bulk?: boolean;
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

export const entryKey = (e: { variantId: string; bulk?: boolean }) => (e.bulk ? `${e.variantId}|bulk` : e.variantId);

export function ownedQty(col: Collection, variantId: string): number {
  return (col[variantId]?.qty ?? 0) + (col[`${variantId}|bulk`]?.qty ?? 0);
}

export function addToCollection(card: Omit<Entry, "qty" | "addedAt" | "updatedAt">, qty: number) {
  addManyToCollection([{ card, qty }]);
}

export function addManyToCollection(items: { card: Omit<Entry, "qty" | "addedAt" | "updatedAt">; qty: number }[]) {
  const col = { ...read() };
  const now = new Date().toISOString();
  for (const { card, qty } of items) addInto(col, card, qty, now);
  write(col);
}

function addInto(col: Collection, card: Omit<Entry, "qty" | "addedAt" | "updatedAt">, qty: number, now: string) {
  const key = entryKey(card);
  const prev = col[key];
  col[key] = {
    ...card,
    qty: (prev?.qty ?? 0) + qty,
    addedAt: prev?.addedAt ?? now,
    updatedAt: now,
  };
}

export function setQty(variantId: string, qty: number) {
  // variantId aquí es la clave de la entrada (ver entryKey)
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
  for (const c of cards) if (c && c.variantId && c.qty > 0) col[entryKey(c)] = c;
  write(col);
  return cards.length;
}

export const usd = (n: number | null | undefined) =>
  n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD" });
