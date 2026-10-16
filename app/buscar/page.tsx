"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { CardSummary } from "@/lib/optcg";
import { normalizeCode } from "@/lib/code";
import { matches } from "@/lib/search";
import { Thumb } from "@/components/Thumb";
import { CardModal } from "@/components/CardModal";

export default function SearchPage() {
  const [cards, setCards] = useState<CardSummary[] | null>(null);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/cards")
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error);
        setCards(data.cards);
      })
      .catch((e) => setError(e.message || "No se pudo cargar la lista de cartas"));
  }, []);

  const results = useMemo(() => {
    if (!cards) return [];
    const term = q.trim().toLowerCase();
    if (term.length < 2) return [];
    const code = normalizeCode(q);
    return cards
      .filter((c) => (code && c.code === code) || matches(`${c.name} ${(c.names ?? []).join(" ")} ${c.code} ${c.setName} ${c.color}`, term))
      .slice(0, 60);
  }, [cards, q]);

  return (
    <>
      <h1>Buscar</h1>
      <p className="sub">Por nombre (ej. Luffy, Nami, “Winner”, “Manga”) o por código (ej. OP05-119). Toca una carta para ver su detalle.</p>
      <input
        className="input"
        placeholder="Nombre o código"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        autoFocus
        autoCorrect="off"
        spellCheck={false}
      />
      <div className="spacer" />
      {error && <p className="error">{error}</p>}
      {!cards && !error && <p className="empty">Cargando la lista de cartas…</p>}
      {cards && q.trim().length >= 2 && results.length === 0 && <p className="empty">Sin resultados.</p>}
      <div className="list">
        {results.map((c) => (
          <button type="button" className="item" key={c.code} onClick={() => setOpen(c.code)} style={{ textAlign: "left", width: "100%", color: "inherit", font: "inherit", cursor: "pointer" }}>
            <Thumb src={c.image} alt={c.name} />
            <div className="item-body">
              <div className="item-title">{c.name}</div>
              <div className="item-meta">
                {c.code}{c.rarity ? ` · ${c.rarity}` : ""}{c.color ? ` · ${c.color}` : ""}
              </div>
              <div className="item-meta">
                {c.setName}{c.variants > 1 ? ` · ${c.variants} versiones` : ""}
              </div>
            </div>
          </button>
        ))}
      </div>
      {open && (
        <CardModal
          code={open}
          onClose={() => setOpen(null)}
          actions={<Link className="btn primary block" href={`/carta/${open}`}>Agregar a mi colección</Link>}
        />
      )}
    </>
  );
}
