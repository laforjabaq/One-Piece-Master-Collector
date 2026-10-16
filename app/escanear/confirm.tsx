"use client";
import { useEffect, useRef } from "react";
import type { Variant } from "@/lib/optcg";
import { usd } from "@/lib/collection";

export const CANCEL_MS = 3000;

// Selector de versión: aparece en bulk cuando el código tiene varias variantes.
export function VariantPicker({
  code,
  variants,
  onPick,
}: {
  code: string;
  variants: Variant[];
  onPick: (v: Variant | null) => void;
}) {
  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal" role="dialog" aria-modal="true" aria-label={`Elige la versión de ${code}`}>
        <h2 style={{ marginTop: 0 }}>¿Qué versión es?</h2>
        <p className="sub">
          {variants[0]?.name} ({code}) tiene {variants.length} versiones. Toca la que tienes en la mano.
        </p>
        <div className="variant-grid">
          {variants.map((v) => (
            <button
              key={v.variantId}
              className="variant-option"
              onClick={() => onPick(v)}
              aria-label={`Elegir ${v.label}`}
              data-testid="variant-option"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={v.image} alt={v.fullName || v.name} loading="lazy" />
              <span className="variant-label">{v.label}</span>
              <span className="variant-meta">{v.rarity} · {usd(v.price)}</span>
            </button>
          ))}
        </div>
        <div className="spacer" />
        <button className="btn block" onClick={() => onPick(null)}>Descartar lectura</button>
      </div>
    </div>
  );
}

// Banner tras una lectura: 3 s para cancelar; si no se toca, se acepta.
export function ReadBanner({
  title,
  detail,
  image,
  onDone,
}: {
  title: string;
  detail: string;
  image?: string;
  onDone: (accepted: boolean) => void;
}) {
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    const t = setTimeout(() => done.current(true), CANCEL_MS);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="read-banner" role="status" aria-label="Lectura" data-testid="read-banner">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {image && <img src={image} alt="" />}
      <div className="read-banner-body">
        <div className="item-title">{title}</div>
        <div className="item-meta">{detail}</div>
      </div>
      <button className="btn small" onClick={() => done.current(false)}>Cancelar</button>
      <div className="read-banner-bar" style={{ animationDuration: `${CANCEL_MS}ms` }} />
    </div>
  );
}
