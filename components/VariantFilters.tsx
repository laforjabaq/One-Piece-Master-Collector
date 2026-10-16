"use client";
import { useEffect, useMemo, useState } from "react";
import type { Variant } from "@/lib/optcg";
import { applyFilters, facetsOf, lastChoice, rankVariants, type Filters, type Ranking, type ScanHints } from "@/lib/variants";
import { variantHashes } from "@/lib/phash";

/** Chips de filtro (Set, Rareza, Versión/Sello) con cantidades. Solo las facetas que separan versiones. */
export function VariantFilters({ variants, filters, onChange }: { variants: Variant[]; filters: Filters; onChange: (f: Filters) => void }) {
  const facets = useMemo(() => facetsOf(variants), [variants]);
  if (!facets.length) return null;
  return (
    <div className="filters" data-testid="variant-filters">
      {facets.map((f) => {
        // cantidades dentro de lo que dejan los demás filtros
        const others = applyFilters(variants, { ...filters, [f.key]: undefined });
        return (
          <div className="filter-row" key={f.key} role="group" aria-label={f.label}>
            <span className="filter-name">{f.label}</span>
            {f.values.map(([val]) => {
              const n = others.filter((v) => applyFilters([v], { [f.key]: val }).length).length;
              const on = filters[f.key] === val;
              return (
                <button
                  key={val}
                  type="button"
                  className={"chip" + (on ? " on" : "")}
                  aria-pressed={on}
                  disabled={!n && !on}
                  onClick={() => onChange({ ...filters, [f.key]: on ? undefined : val })}
                >
                  {val} <span className="chip-count">{n}</span>
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

/** Estado de filtros + lista filtrada. */
export function useFiltered(variants: Variant[]) {
  const [filters, setFilters] = useState<Filters>({});
  const list = useMemo(() => applyFilters(variants, filters), [variants, filters]);
  return { filters, setFilters, list };
}

/** Ranking por pistas del escaneo (hash de imágenes cargado en segundo plano) y última elección. */
export function useRanking(code: string, variants: Variant[] | null, hints: ScanHints | null): Ranking | null {
  const [hashes, setHashes] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!variants || variants.length < 2 || !hints?.hash) return;
    let alive = true;
    variantHashes(variants).then((h) => alive && setHashes(h));
    return () => {
      alive = false;
    };
  }, [variants, hints]);
  return useMemo(() => {
    if (!variants || variants.length < 2) return null;
    return rankVariants(variants, hints, hashes, lastChoice(code));
  }, [code, variants, hints, hashes]);
}
