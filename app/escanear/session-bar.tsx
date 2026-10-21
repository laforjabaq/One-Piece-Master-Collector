"use client";
import { useState } from "react";
import { LANGS, normSet, updateSession, useSession } from "@/lib/session";

// Barra de ajustes fijos de la sesión: sets bloqueados, foil e idioma.
// Se aplican a cada lectura hasta que se cambian (y sobreviven a recargar).
export function SessionBar() {
  const s = useSession();
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  const add = (e: React.FormEvent) => {
    e.preventDefault();
    const set = normSet(text);
    if (set && !s.sets.includes(set)) updateSession({ sets: [...s.sets, set] });
    setText("");
    setAdding(false);
  };
  return (
    <div className="session-bar" role="group" aria-label="Ajustes de la sesión" data-testid="session-bar">
      {s.sets.map((set) => (
        <button key={set} className="chip on" onClick={() => updateSession({ sets: s.sets.filter((x) => x !== set) })} aria-label={`Quitar set ${set}`}>
          Set {set} ✕
        </button>
      ))}
      {adding ? (
        <form onSubmit={add} className="row" style={{ gap: 4 }}>
          <input
            className="input small-input"
            style={{ width: 90 }}
            autoFocus
            placeholder="OP05"
            aria-label="Set a bloquear"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => !text && setAdding(false)}
            autoCapitalize="characters"
          />
          <button className="chip" type="submit">Bloquear</button>
        </form>
      ) : (
        <button className="chip" onClick={() => setAdding(true)}>{s.sets.length ? "+ Set" : "Bloquear set"}</button>
      )}
      <button className={"chip" + (s.foil ? " on" : "")} aria-pressed={s.foil} onClick={() => updateSession({ foil: !s.foil })}>
        {s.foil ? "Foil ✓" : "Foil"}
      </button>
      <select className="chip" aria-label="Idioma de la sesión" value={s.lang} onChange={(e) => updateSession({ lang: e.target.value })}>
        {LANGS.map((l) => (
          <option key={l} value={l}>{l}</option>
        ))}
      </select>
    </div>
  );
}
