"use client";
import { useArtEnabled, useModelState } from "@/lib/embed";

// Aviso de una sola vez mientras se descarga el modelo de reconocimiento por
// arte; si no carga, se avisa de que se sigue con el método anterior.
export function ArtModelNotice() {
  const on = useArtEnabled();
  const s = useModelState();
  if (!on) return null;
  if (s.phase === "loading" && s.firstTime) {
    const pct = s.total ? Math.round((s.loaded / s.total) * 100) : 0;
    return (
      <p className="hint-line" role="status" data-testid="art-notice">
        Descargando el modelo de reconocimiento por arte (~{s.mb} MB, solo la primera vez; luego funciona sin conexión)
        {s.total ? ` · ${pct}%` : "…"} Mientras tanto se usa el código y los sellos.
      </p>
    );
  }
  if (s.phase === "failed") {
    return (
      <p className="sub" role="status" data-testid="art-notice">
        No se pudo cargar el reconocimiento por arte; se usa el código y los sellos.
      </p>
    );
  }
  return null;
}
