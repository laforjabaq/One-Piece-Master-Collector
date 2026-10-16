"use client";
/* eslint-disable @next/next/no-img-element */
import { useEffect, useState } from "react";
import type { Variant } from "@/lib/optcg";
import { usd } from "@/lib/collection";

type Props = { code: string; variantId?: string; onClose: () => void; actions?: React.ReactNode };

const cache = new Map<string, Variant[]>();

export function CardModal({ code, variantId, onClose, actions }: Props) {
  const [variants, setVariants] = useState<Variant[] | null>(cache.get(code) ?? null);
  const [error, setError] = useState("");
  const [sel, setSel] = useState(variantId ?? "");

  useEffect(() => {
    if (cache.has(code)) return;
    let alive = true;
    fetch(`/api/card/${encodeURIComponent(code)}`)
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "No encontrada");
        cache.set(code, d.variants);
        if (alive) setVariants(d.variants);
      })
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [code]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", k);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const v = variants?.find((x) => x.variantId === sel) ?? variants?.[0];
  const rows: [string, string][] = v
    ? [
        ["Código", v.code],
        ["Versión", v.label],
        ["Rareza", v.rarity],
        ["Tipo", v.type],
        ["Color", v.color],
        ["Coste", v.cost],
        ["Poder", v.power],
        ["Counter", v.counter],
        ["Atributo", v.attribute],
        ["Vida", v.life],
        ["Subtipos", v.subTypes],
        ["Set", v.setName],
        ["Precio TCGplayer", usd(v.price)],
      ]
    : [];

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div className="modal" role="dialog" aria-modal="true" aria-label={v ? v.name : code} onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Cerrar">×</button>
        {error && <p className="error">{error}</p>}
        {!v && !error && <p className="empty">Cargando {code}…</p>}
        {v && (
          <>
            <img className="modal-img" src={v.image} alt={v.fullName} decoding="async" />
            <h2 style={{ margin: "12px 0 2px" }}>{v.name}</h2>
            {v.fullName !== v.name && <p className="sub" style={{ marginBottom: 8 }}>{v.fullName}</p>}
            {variants!.length > 1 && (
              <select className="input" value={v.variantId} onChange={(e) => setSel(e.target.value)} aria-label="Versión">
                {variants!.map((x) => (
                  <option key={x.variantId} value={x.variantId}>{x.label} · {usd(x.price)}</option>
                ))}
              </select>
            )}
            <dl className="details">
              {rows.filter(([, val]) => val && val !== "—").map(([k, val]) => (
                <div key={k}><dt>{k}</dt><dd>{val}</dd></div>
              ))}
              {v.price == null && <div><dt>Precio TCGplayer</dt><dd>Sin precio</dd></div>}
            </dl>
            {v.text && <p className="effect">{v.text}</p>}
            {actions}
          </>
        )}
      </div>
    </div>
  );
}
