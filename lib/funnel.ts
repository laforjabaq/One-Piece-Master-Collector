// Embudo de candidatas: Nombre → Código → Arte. Sin dependencias del navegador.
import type { NameMatch } from "./names";

export type Funnel = {
  /** paso 1: nombre leído y emparejado (si falló, undefined) */
  name?: { text: string; match: string; score: number; count: number };
  /** paso 2: código leído (si no se pudo leer, undefined) */
  code?: { code: string; count: number };
  /** paso 3: coincidencia de arte de la elegida (0..1) */
  art?: number;
  /** cómo se llegó a las candidatas */
  source: "name+code" | "name" | "code" | "art";
  /** paso 0 (con índice): códigos de los k vecinos de arte más cercanos */
  artTop?: { codes: string[]; k: number };
  /** nombre y código no coinciden: qué se hizo */
  conflict?: string;
};

export type Decision = { codes: string[]; funnel: Funnel };

/**
 * Combina el nombre (fuzzy, 0..1) con los códigos leídos (confianza OCR 0..1).
 * - código dentro de las del nombre → esas variantes
 * - sin código → todas las del nombre
 * - se contradicen → gana el paso con más confianza (y se registra)
 * - sin nombre → solo código (comportamiento de siempre)
 */
export function decide(nameText: string, names: NameMatch[], codes: string[], codeConf: number, nameCounts?: (codes: string[]) => number): Decision {
  const top = names[0];
  const nameCodes = [...new Set(names.flatMap((n) => n.codes))];
  const nameStep = top
    ? { text: nameText.trim(), match: names.map((n) => n.name).join(" / "), score: top.score, count: nameCounts ? nameCounts(nameCodes) : names.reduce((s, n) => s + n.variants, 0) }
    : undefined;
  if (!top) return { codes, funnel: { source: "code" } };
  if (!codes.length) return { codes: nameCodes, funnel: { name: nameStep, source: "name" } };
  const both = codes.filter((c) => nameCodes.includes(c));
  if (both.length) return { codes: both, funnel: { name: nameStep, source: "name+code" } };
  // Contradicción
  if (top.score > codeConf) {
    const conflict = `El código ${codes.join(", ")} no es de ${top.name}: uso el nombre (${pct(top.score)} > ${pct(codeConf)})`;
    return { codes: nameCodes, funnel: { name: nameStep, source: "name", conflict } };
  }
  const conflict = `${top.name} no tiene el código ${codes.join(", ")}: uso el código (${pct(codeConf)} ≥ ${pct(top.score)})`;
  return { codes, funnel: { source: "code", conflict } };
}

/**
 * Arte como señal principal (con el índice de todo el catálogo): los k
 * vecinos más cercanos acotan las candidatas y el OCR decide entre ellas.
 * - sin nombre ni código → los códigos del arte
 * - con OCR → se quedan las candidatas que el arte también ve (si hay)
 */
export function withArt(d: Decision, hits: { code: string; score: number }[] | null, k = 8): Decision {
  if (!hits?.length) return d;
  const codes: string[] = [];
  for (const h of hits) {
    if (h.score < hits[0].score - 0.08) break;
    if (!codes.includes(h.code)) codes.push(h.code);
    if (codes.length >= 3) break;
  }
  const artTop = { codes, k };
  if (!d.codes.length) return { codes, funnel: { ...d.funnel, source: d.funnel.name ? d.funnel.source : "art", artTop } };
  const all = [...new Set(hits.map((h) => h.code))];
  const both = d.codes.filter((c) => all.includes(c));
  if (both.length) return { codes: both, funnel: { ...d.funnel, artTop } };
  return { codes: d.codes, funnel: { ...d.funnel, artTop, conflict: d.funnel.conflict ?? `El arte apunta a ${codes.join(", ")}; uso el OCR` } };
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** "Nombre: Boa Hancock (24) → Código: OP14-105 (3) → Arte: 94%" */
export function funnelLabel(f?: Funnel | null): string {
  if (!f) return "";
  const parts: string[] = [];
  if (f.artTop) parts.push(`Arte top-${f.artTop.k}: ${f.artTop.codes.join(", ")}`);
  if (f.name) parts.push(`Nombre: ${f.name.match} (${f.name.count})`);
  parts.push(f.code ? `Código: ${f.code.code} (${f.code.count})` : "Código: —");
  if (f.art !== undefined) parts.push(`Arte: ${pct(Math.max(0, Math.min(1, f.art)))}`);
  return parts.join(" → ");
}
