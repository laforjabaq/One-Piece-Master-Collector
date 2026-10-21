"use client";
// Ajustes fijos de la sesión de escaneo (como el menú inferior de ManaBox):
// sets bloqueados, foil e idioma. Se aplican a cada lectura hasta que se cambian.
import { useSyncExternalStore } from "react";
import type { Variant } from "./optcg";
import { setOf } from "./variants";

export type ScanSession = { sets: string[]; foil: boolean; lang: string };
export const LANGS = ["EN", "JP", "ES", "FR", "CN", "KR"] as const;
const DEFAULT: ScanSession = { sets: [], foil: false, lang: "EN" };
const KEY = "opmc.scanSession.v1";
const listeners = new Set<() => void>();
let cache: ScanSession | null = null;

export function readSession(): ScanSession {
  if (cache) return cache;
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "null");
    cache = v && Array.isArray(v.sets) ? { ...DEFAULT, ...v } : DEFAULT;
  } catch {
    cache = DEFAULT;
  }
  return cache!;
}

export function updateSession(patch: Partial<ScanSession>) {
  cache = { ...readSession(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    /* nada */
  }
  listeners.forEach((l) => l());
}

export function useSession(): ScanSession {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    readSession,
    () => DEFAULT,
  );
}

/** "op-05", "OP05 " → "OP05". */
export const normSet = (s: string) => s.trim().toUpperCase().replace(/[\s-]+/g, "");

/**
 * Restringe las candidatas a los sets bloqueados. Si ninguna es de esos sets
 * se devuelven todas (mejor preguntar que perder la carta).
 */
export function lockToSets(vs: Variant[], sets = readSession().sets): Variant[] {
  if (!sets.length) return vs;
  const f = vs.filter((v) => sets.includes(normSet(setOf(v))));
  return f.length ? f : vs;
}
