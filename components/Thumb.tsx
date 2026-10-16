/* eslint-disable @next/next/no-img-element */
// Miniatura liviana: carga diferida, decodificación asíncrona y tamaño fijo
// para que la lista no salte mientras llegan las imágenes.
export function Thumb({ src, alt, width = 56, onClick }: { src: string; alt: string; width?: number; onClick?: () => void }) {
  const height = Math.round((width * 88) / 63);
  const img = <img className="thumb" src={src} alt={alt} width={width} height={height} loading="lazy" decoding="async" style={{ width }} />;
  if (!onClick) return img;
  return (
    <button type="button" className="thumb-btn" onClick={onClick} aria-label={`Ver detalle de ${alt}`}>
      {img}
    </button>
  );
}
