"use client";
import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { exportCollection, importCollection, setQty, useCollection, usd } from "@/lib/collection";

type Sort = "recent" | "code" | "price";

export default function CollectionPage() {
  const collection = useCollection();
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("recent");
  const fileRef = useRef<HTMLInputElement>(null);

  const entries = useMemo(() => Object.values(collection), [collection]);
  const totals = useMemo(
    () => ({
      cards: entries.reduce((s, e) => s + e.qty, 0),
      unique: entries.length,
      value: entries.reduce((s, e) => s + (e.price ?? 0) * e.qty, 0),
    }),
    [entries],
  );

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = term
      ? entries.filter((e) => `${e.name} ${e.code} ${e.setName} ${e.label}`.toLowerCase().includes(term))
      : [...entries];
    if (sort === "recent") list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    if (sort === "code") list.sort((a, b) => a.variantId.localeCompare(b.variantId, "en", { numeric: true }));
    if (sort === "price") list.sort((a, b) => (b.price ?? 0) - (a.price ?? 0));
    return list;
  }, [entries, q, sort]);

  const doExport = () => {
    const blob = new Blob([exportCollection()], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `coleccion-op-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const doImport = async (file?: File) => {
    if (!file) return;
    try {
      const n = importCollection(await file.text());
      alert(`Se importaron ${n} cartas.`);
    } catch (e) {
      alert("No se pudo importar: " + (e as Error).message);
    }
  };

  return (
    <>
      <h1>Mi colección</h1>
      <p className="sub">One Piece Master Collector</p>

      <div className="stats">
        <div className="stat"><b>{totals.cards}</b><span>cartas</span></div>
        <div className="stat"><b>{totals.unique}</b><span>distintas</span></div>
        <div className="stat"><b>{usd(totals.value)}</b><span>valor TCGplayer</span></div>
      </div>

      {entries.length === 0 ? (
        <div className="empty">
          <p>Todavía no tienes cartas registradas.</p>
          <Link className="btn primary" href="/escanear">Escanear mi primera carta</Link>
        </div>
      ) : (
        <>
          <div className="row">
            <input className="input" placeholder="Filtrar por nombre o código" value={q} onChange={(e) => setQ(e.target.value)} />
            <select className="input" style={{ flex: "none", width: "auto" }} value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
              <option value="recent">Recientes</option>
              <option value="code">Código</option>
              <option value="price">Precio</option>
            </select>
          </div>
          <div className="spacer" />
          <div className="list">
            {shown.map((e) => (
              <div className="item" key={e.variantId}>
                <Link href={`/carta/${e.code}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={e.image} alt={e.name} loading="lazy" />
                </Link>
                <div className="item-body">
                  <div className="item-title">{e.name}</div>
                  <div className="item-meta">
                    {e.code} · {e.label}{e.rarity ? ` · ${e.rarity}` : ""}
                  </div>
                  <div className="item-meta">{usd(e.price)} c/u</div>
                </div>
                <div className="stepper">
                  <button
                    onClick={() => {
                      if (e.qty > 1 || confirm(`¿Quitar ${e.name} (${e.label}) de la colección?`)) setQty(e.variantId, e.qty - 1);
                    }}
                    aria-label="Menos"
                  >
                    −
                  </button>
                  <output>{e.qty}</output>
                  <button onClick={() => setQty(e.variantId, e.qty + 1)} aria-label="Más">+</button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="spacer" />
      <div className="spacer" />
      <p className="sub" style={{ fontSize: "0.8rem" }}>
        La colección se guarda en este teléfono. Haz un respaldo de vez en cuando.
      </p>
      <div className="row">
        <button className="btn small" onClick={doExport} disabled={!entries.length}>Exportar respaldo</button>
        <button className="btn small" onClick={() => fileRef.current?.click()}>Importar respaldo</button>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => doImport(e.target.files?.[0])} />
      </div>
    </>
  );
}
