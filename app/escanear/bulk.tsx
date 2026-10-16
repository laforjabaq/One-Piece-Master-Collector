"use client";
import { useState } from "react";
import { clearQueue, queueCount, updateItem, useQueue } from "@/lib/bulk";
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
        {queue.length === 0 && <p className="empty">La cola está vacía.</p>}
        <div className="list">
          {queue.map((i) => {
            const v = i.variants.find((x) => x.variantId === i.variantId) ?? i.variants[0];
            return (
              <div className="item check-item" key={i.code} data-testid="queue-item">
                <input
                  type="checkbox"
                  checked={i.checked}
                  onChange={(e) => updateItem(i.code, { checked: e.target.checked })}
                  aria-label={`Incluir ${v?.name ?? i.code}`}
                />
                <Thumb src={v?.image ?? ""} alt={v?.name ?? i.code} width={48} onClick={() => setDetail({ code: i.code, variantId: i.variantId })} />
                <div className="item-body">
                  <div className="item-title">{v?.name ?? i.code}</div>
                  <div className="item-meta">{i.code} · {usd(v?.price)}</div>
                  {i.variants.length > 1 && (
                    <select
                      className="input"
                      style={{ minHeight: 32, padding: "2px 6px", fontSize: "0.8rem" }}
                      value={i.variantId}
                      aria-label={`Versión de ${i.code}`}
                      onChange={(e) => updateItem(i.code, { variantId: e.target.value })}
                    >
                      {i.variants.map((x) => (
                        <option key={x.variantId} value={x.variantId}>{x.label}</option>
                      ))}
                    </select>
                  )}
                </div>
                <div className="stepper">
                  <button onClick={() => updateItem(i.code, { qty: Math.max(1, i.qty - 1) })} aria-label="Menos">−</button>
                  <output>{i.qty}</output>
                  <button onClick={() => updateItem(i.code, { qty: i.qty + 1 })} aria-label="Más">+</button>
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
