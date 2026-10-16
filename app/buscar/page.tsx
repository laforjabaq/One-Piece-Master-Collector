"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { CardSummary } from "@/lib/optcg";
import { normalizeCode } from "@/lib/code";

export default function SearchPage() {
  const [cards, setCards] = useState<CardSummary[] | null>(null);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");

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
    const words = term.split(/\s+/);
    return cards
      .filter((c) => (code && c.code === code) || words.every((w) => `${c.name} ${c.code} ${c.setName} ${c.color}`.toLowerCase().includes(w)))
      .slice(0, 60);
  }, [cards, q]);

  return (
    <>
      <h1>Buscar</h1>
      <p className="sub">Por nombre (ej. Luffy, Nami) o por código (ej. OP05-119).</p>
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
          <Link className="item" key={c.code} href={`/carta/${c.code}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={c.image} alt={c.name} loading="lazy" />
            <div className="item-body">
              <div className="item-title">{c.name}</div>
              <div className="item-meta">
                {c.code}{c.rarity ? ` · ${c.rarity}` : ""}{c.color ? ` · ${c.color}` : ""}
              </div>
              <div className="item-meta">
                {c.setName}{c.variants > 1 ? ` · ${c.variants} versiones` : ""}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}
