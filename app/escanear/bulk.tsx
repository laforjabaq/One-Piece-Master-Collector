"use client";
import { useState } from "react";
import { clearQueue, itemVariant, queueCount, queueValue, removeChecked, updateChecked, updateItem, useQueue, type QueueItem } from "@/lib/bulk";
import { LANGS, normSet } from "@/lib/session";
import { setOf } from "@/lib/variants";
import { addManyToCollection, usd } from "@/lib/collection";
import { Thumb } from "@/components/Thumb";
import { CardModal } from "@/components/CardModal";

// Lista de revisión del lote: el usuario marca qué cartas entran y con qué versión.
export function BulkPanel({ onDone }: { onDone: () => void }) {
  const queue = useQueue();
  const [detail, setDetail] = useState<{ code: string; variantId: string } | null>(null);
  const chosen = queue.filter((i) => i.checked);

  const confirm = () => {
    addManyToCollection(
      chosen.map((i) => {
        const v = i.variants.find((x) => x.variantId === i.variantId) ?? i.variants[0];
        return {
          qty: i.qty,
          card: {
            variantId: v.variantId,
            code: v.code,
            name: v.name,
            fullName: v.fullName,
            label: v.label,
            image: v.image,
            rarity: v.rarity,
            setName: v.setName,
            price: v.price,
            bulk: true,
            ...(i.foil ? { foil: true } : {}),
            ...(i.lang && i.lang !== "EN" ? { lang: i.lang } : {}),
          },
        };
      }),
    );
    clearQueue();
    onDone();
  };

  const discard = () => {
    if (window.confirm("¿Vaciar la cola sin agregar nada?")) {
      clearQueue();
      onDone();
    }
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal" role="dialog" aria-modal="true" aria-label="Revisar lote">
        <h2 style={{ marginTop: 0 }}>Revisar lote</h2>
        <p className="sub">
          {queueCount(queue)} cartas leídas. Marca las que quieres agregar a tu colección (sección Bulk) y elige la versión si no es la base.
        </p>
        {queue.length > 0 && (
          <p className="hint-line" data-testid="review-total">
            {queueCount(queue)} cartas · Valor: {usd(queueValue(queue))} (marcadas: {usd(queueValue(chosen))})
          </p>
        )}
        {queue.length === 0 && <p className="empty">La cola está vacía.</p>}
        {queue.length > 0 && <BulkEdit queue={queue} chosen={chosen} />}
        <div className="list">
          {queue.map((i) => {
            const v = itemVariant(i);
            return (
              <div className="item check-item" key={`${i.code}|${i.variantId}|${i.foil ? "f" : ""}|${i.lang ?? ""}`} data-testid="queue-item">
                <input
                  type="checkbox"
                  checked={i.checked}
                  onChange={(e) => updateItem(i, { checked: e.target.checked })}
                  aria-label={`Incluir ${v?.name ?? i.code}`}
                />
                <Thumb src={v?.image ?? ""} alt={v?.name ?? i.code} width={48} onClick={() => setDetail({ code: i.code, variantId: i.variantId })} />
                <div className="item-body">
                  <div className="item-title">{v?.name ?? i.code}</div>
                  <div className="item-meta">
                    {i.code} · {usd(v?.price)}
                    {i.foil && <span className="pill" style={{ marginLeft: 4 }}>Foil</span>}
                    {i.lang && i.lang !== "EN" && <span className="pill">{i.lang}</span>}
                  </div>
                  {i.variants.length > 1 && (
                    <select
                      className="input"
                      style={{ minHeight: 32, padding: "2px 6px", fontSize: "0.8rem" }}
                      value={i.variantId}
                      aria-label={`Versión de ${i.code}`}
                      onChange={(e) => updateItem(i, { variantId: e.target.value })}
                    >
                      {i.variants.map((x) => (
                        <option key={x.variantId} value={x.variantId}>{x.label}</option>
                      ))}
                    </select>
                  )}
                </div>
                <div className="stepper">
                  <button onClick={() => updateItem(i, { qty: Math.max(1, i.qty - 1) })} aria-label="Menos">−</button>
                  <output>{i.qty}</output>
                  <button onClick={() => updateItem(i, { qty: i.qty + 1 })} aria-label="Más">+</button>
                </div>
              </div>
            );
          })}
        </div>
        <div className="spacer" />
        <button className="btn primary block" onClick={confirm} disabled={!chosen.length}>
          Agregar {queueCount(chosen)} a la colección y seguir
        </button>
        <div className="spacer" />
        <div className="row">
          <button className="btn small" style={{ flex: 1 }} onClick={onDone}>Seguir escaneando</button>
          <button className="btn small" style={{ flex: 1 }} onClick={discard} disabled={!queue.length}>Vaciar cola</button>
        </div>
      </div>
      {detail && <CardModal code={detail.code} variantId={detail.variantId} onClose={() => setDetail(null)} />}
    </div>
  );
}

// Edición masiva de las cartas marcadas: set, foil, idioma, cantidad y borrar.
function BulkEdit({ queue, chosen }: { queue: QueueItem[]; chosen: QueueItem[] }) {
  const [qty, setQty] = useState(1);
  const all = queue.every((i) => i.checked);
  const sets = [...new Set(chosen.flatMap((i) => i.variants.map((v) => normSet(setOf(v)))))].sort();
  const n = chosen.length;
  return (
    <div className="bulk-edit" role="group" aria-label="Editar marcadas" data-testid="bulk-edit">
      <label className="row" style={{ gap: 6 }}>
        <input type="checkbox" checked={all} onChange={(e) => updateChecked(() => ({}), e.target.checked)} aria-label="Marcar todas" />
        <span className="item-meta">Marcar todas · {n} marcadas</span>
      </label>
      <div className="row wrap">
        <select className="input small-input" aria-label="Set de las marcadas" value="" disabled={!n || sets.length < 2} onChange={(e) => {
          const set = e.target.value;
          if (set) updateChecked((i) => ({ variantId: i.variants.find((v) => normSet(setOf(v)) === set)?.variantId ?? i.variantId }));
        }}>
          <option value="">Set…</option>
          {sets.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <button className="btn small" disabled={!n} onClick={() => updateChecked(() => ({ foil: true }))}>Foil</button>
        <button className="btn small" disabled={!n} onClick={() => updateChecked(() => ({ foil: false }))}>Sin foil</button>
        <select className="input small-input" aria-label="Idioma de las marcadas" value="" disabled={!n} onChange={(e) => e.target.value && updateChecked(() => ({ lang: e.target.value }))}>
          <option value="">Idioma…</option>
          {LANGS.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
      </div>
      <div className="row wrap">
        <input className="input small-input" type="number" min={1} max={99} value={qty} aria-label="Cantidad de las marcadas" onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))} />
        <button className="btn small" disabled={!n} onClick={() => updateChecked(() => ({ qty }))}>Poner cantidad</button>
        <button className="btn small" disabled={!n} onClick={() => removeChecked()}>Borrar marcadas</button>
      </div>
    </div>
  );
}
