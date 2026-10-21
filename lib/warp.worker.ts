// Worker de corrección de perspectiva: recibe la zona de la carta como
// ImageBitmap y devuelve la carta enderezada como ImageBitmap (o sin quad si
// no hace falta). Así el hilo principal (y el video) no se bloquean.
import { rectifyPixels } from "./warp-core";

type Msg = { id: number; bitmap: ImageBitmap; W: number; H: number; outW: number; outH: number };

const read = (bmp: ImageBitmap, w: number, h: number) => {
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h).data;
};

self.onmessage = (e: MessageEvent<Msg>) => {
  const { id, bitmap, W, H, outW, outH } = e.data;
  try {
    const fw = bitmap.width, fh = bitmap.height;
    const r = rectifyPixels(read(bitmap, W, H), W, H, read(bitmap, fw, fh), fw, fh, outW, outH);
    bitmap.close();
    if (!r) return postMessage({ id });
    const out = new OffscreenCanvas(outW, outH);
    out.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(r.px), outW, outH), 0, 0);
    const result = out.transferToImageBitmap();
    (self as unknown as Worker).postMessage({ id, quad: r.quad, bitmap: result }, [result]);
  } catch (err) {
    postMessage({ id, error: String(err) });
  }
};
