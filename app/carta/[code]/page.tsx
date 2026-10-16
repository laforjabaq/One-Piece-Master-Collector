"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import type { Variant } from "@/lib/optcg";
import { addToCollection, useCollection, usd } from "@/lib/collection";

export default function CardPage() {
  const { code } = useParams<{ code: string }>();
  const router = useRouter();
  const collection = useCollection();
  const [variants, setVariants] = useState<Variant[] | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string>("");
  const [qty, setQty] = useState(1);
  const [toast, setToast] = useState("");

  useEffect(() => {
    let alive = true;
    fetch(`/api/card/${encodeURIComponent(code)}`)
      .then(async (r) => {
        const data = await r.json();
        if (!alive) return;
        if (!r.ok) throw new Error(data.error || "No encontrada");
        setVariants(data.variants);
        setSelected(data.variants[0]?.variantId ?? "");
      })
      .catch((e) => alive && setError(e.message === "No encontrada" ? `No encontré la carta ${code}.` : e.message));
    return () => {
      alive = false;
    };
  }, [code]);

  const current = variants?.find((v) => v.variantId === selected);

  const add = (next: "scan" | "stay") => {
    if (!current) return;
    addToCollection(
      {
        variantId: current.variantId,
        code: current.code,
        name: current.name,
        label: current.label,
        image: current.image,
        rarity: current.rarity,
        setName: current.setName,
        price: current.price,
      },
      qty,
    );
    navigator.vibrate?.(40);
    if (next === "scan") router.push("/escanear");
    else {
      setToast(`+${qty} ${current.name} (${current.label})`);
      setQty(1);
      setTimeout(() => setToast(""), 1800);
    }
  };

  if (error)
    return (
      <div className="empty">
        <p className="error">{error}</p>
        <p>Revisa el código o búscala por nombre.</p>
        <div className="row" style={{ justifyContent: "center" }}>
          <Link className="btn" href="/escanear">Escanear de nuevo</Link>
          <Link className="btn" href="/buscar">Buscar</Link>
        </div>
      </div>
    );

  if (!variants) return <p className="empty">Buscando {code}…</p>;

  const first = variants[0];
  return (
    <>
      <h1>{first.name}</h1>
      <p className="sub">
        <span className="pill">{first.code}</span>
        {first.rarity && <span className="pill">{first.rarity}</span>}
        {first.color && <span className="pill">{first.color}</span>}
        {first.setName}
      </p>

      <p className="sub">
        {variants.length > 1 ? `Hay ${variants.length} versiones con este código. Elige la tuya:` : "Confirma la carta:"}
      </p>
      <div className="variants">
        {variants.map((v) => {
          const owned = collection[v.variantId]?.qty ?? 0;
          return (
            <button
              key={v.variantId}
              className={v.variantId === selected ? "variant selected" : "variant"}
              onClick={() => setSelected(v.variantId)}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={v.image} alt={`${v.name} ${v.label}`} loading="lazy" />
              {owned > 0 && <span className="variant-owned">×{owned}</span>}
              <div className="variant-label">{v.label}</div>
              {v.setName && v.setName !== first.setName && <div className="item-meta">{v.setName}</div>}
              <div className="item-meta">{v.price != null ? `${usd(v.price)} TCGplayer` : "Sin precio"}</div>
            </button>
          );
        })}
      </div>

      <div className="sticky-actions">
        <div className="stepper big">
          <button onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="Menos">−</button>
          <output>{qty}</output>
          <button onClick={() => setQty((q) => q + 1)} aria-label="Más">+</button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1 }}>
          <button className="btn primary" disabled={!current} onClick={() => add("scan")}>
            Agregar y escanear otra
          </button>
          <button className="btn small" disabled={!current} onClick={() => add("stay")}>
            Solo agregar
          </button>
        </div>
      </div>
      {toast && <div className="toast">{toast}</div>}
    </>
  );
}
