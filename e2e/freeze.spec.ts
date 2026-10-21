import { test, expect } from "@playwright/test";
import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Regresión "la cámara se congela": con el índice de arte completo del
// catálogo (public/embeddings, miles de filas x 384) y una cámara 1080p que
// enfoca una carta inclinada, el escaneo continuo (corrección de perspectiva,
// reflejos, arte primero, OCR) no debe bloquear el hilo principal ni el video.

// Cámara falsa: un fotograma Y4M 1920x1080 con una carta girada 4° sobre fondo oscuro.
function cardY4m(): string {
  const file = join(tmpdir(), "opmc-card-1080p-v1.y4m");
  if (existsSync(file)) return file;
  const W = 1920, H = 1080, cx = 960, cy = 540, cw = 460, ch = 642, a = (4 * Math.PI) / 180;
  const Y = Buffer.alloc(W * H), U = Buffer.alloc((W / 2) * (H / 2)), V = Buffer.alloc((W / 2) * (H / 2));
  const yuv = (r: number, g: number, b: number) => [0.257 * r + 0.504 * g + 0.098 * b + 16, -0.148 * r - 0.291 * g + 0.439 * b + 128, 0.439 * r - 0.368 * g - 0.071 * b + 128];
  const color = (x: number, y: number): [number, number, number] => {
    // coordenadas de la carta (sin girar), origen arriba-izquierda
    const dx = x - cx, dy = y - cy;
    const u = dx * Math.cos(a) + dy * Math.sin(a) + cw / 2, v = -dx * Math.sin(a) + dy * Math.cos(a) + ch / 2;
    if (u < 0 || v < 0 || u >= cw || v >= ch) return [27, 27, 27];
    if (u < 6 || v < 6 || u >= cw - 6 || v >= ch - 6) return [34, 34, 34];
    if ((v > 390 && v < 500 && u > 30 && u < cw - 30) || (v > 530 && v < 570 && u > 60 && u < cw - 60)) return [244, 241, 208];
    if (v > 600 && v < 630 && u > 330 && u < 440) return (Math.floor(u / 8) + Math.floor(v / 6)) % 2 ? [255, 255, 255] : [10, 10, 10];
    // "ilustración": bandas para que haya bordes
    return Math.floor(v / 40) % 2 ? [26, 154, 58] : [20, 90, 160];
  };
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const [yy, uu, vv] = yuv(...color(x, y));
      Y[y * W + x] = yy;
      if (!(x & 1) && !(y & 1)) {
        U[(y >> 1) * (W / 2) + (x >> 1)] = uu;
        V[(y >> 1) * (W / 2) + (x >> 1)] = vv;
      }
    }
  writeFileSync(file, Buffer.concat([Buffer.from(`YUV4MPEG2 W${W} H${H} F10:1 Ip A1:1 C420jpeg\nFRAME\n`), Y, U, V]));
  return file;
}

test.use({
  serviceWorkers: "block",
  launchOptions: {
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-video-capture=${cardY4m()}`],
  },
});

// FREEZE_CPU=4 simula un teléfono (CDP CPU throttling) para medir a mano.
const CPU_SLOWDOWN = Number(process.env.FREEZE_CPU ?? 1);

test("escaneo continuo con el índice completo: sin tareas largas > 200 ms y el video sigue", async ({ page }) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => {
    localStorage.setItem("opmc.scanMode.v1", "fast");
    // Embeddings falsos con la versión y dimensión del índice real (384), para
    // que se use la búsqueda en todo el catálogo.
    window.__opmcEmbedder = {
      version: "dinov2s-1-test",
      embed: async (rgba: Uint8ClampedArray) => {
        const out = new Float32Array(384);
        for (let i = 0; i < rgba.length; i += 4) out[(i >> 2) % 384] += rgba[i] - rgba[i + 2];
        const n = Math.hypot(...out) || 1;
        return Array.from(out, (x) => x / n);
      },
    };
    const w = window as unknown as { __long: number[] };
    w.__long = [];
    new PerformanceObserver((l) => l.getEntries().forEach((e) => w.__long.push(Math.round(e.duration)))).observe({ type: "longtask", buffered: true });
  });
  await page.route("**/api/card/*", (r) => r.fulfill({ status: 404, json: { error: "No encontrada" } }));
  if (CPU_SLOWDOWN > 1) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU_SLOWDOWN });
  }
  await page.goto("/escanear");
  // índice real del repo (todo el catálogo)
  await expect.poll(() => page.evaluate(() => Number(document.documentElement.dataset.artIndex || 0)), { timeout: 30_000 }).toBeGreaterThan(1000);
  await expect.poll(() => page.evaluate(() => Number(document.documentElement.dataset.scanFrames || 0)), { timeout: 40_000 }).toBeGreaterThan(0);
  // la carga (OCR, índice) ya pasó: desde aquí se mide el escaneo en sí
  const t0 = await page.evaluate(() => {
    (window as unknown as { __long: number[] }).__long = [];
    document.documentElement.dataset.warped = "0";
    return document.querySelector("video")!.currentTime;
  });
  const samples: number[] = [];
  for (let i = 0; i < 10; i++) {
    await page.waitForTimeout(1000);
    samples.push(await page.evaluate(() => document.querySelector("video")!.currentTime));
  }
  const stats = await page.evaluate(() => ({
    long: (window as unknown as { __long: number[] }).__long,
    warped: Number(document.documentElement.dataset.warped || 0),
    frames: Number(document.documentElement.dataset.scanFrames || 0),
    status: document.querySelector("[data-testid=scanner-status]")?.textContent,
  }));
  console.log(JSON.stringify({ cpu: CPU_SLOWDOWN, t0, samples, ...stats, maxLong: Math.max(0, ...stats.long) }));
  // el bucle trabajó de verdad: detectó y enderezó la carta inclinada
  expect(stats.warped).toBeGreaterThan(0);
  expect(Math.max(0, ...stats.long)).toBeLessThanOrEqual(200);
  // el video avanza todo el tiempo (ningún segundo congelado)
  let prev = t0;
  for (const s of samples) {
    expect(s).toBeGreaterThan(prev);
    prev = s;
  }
});
