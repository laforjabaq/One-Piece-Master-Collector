import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Reconocimiento por arte: tres versiones del mismo código con ilustración
// distinta (color de fondo). La foto tiene la de fondo verde.
const ref = (bg: string) =>
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='500' height='698'><rect width='500' height='698' fill='${bg}'/>` +
      `<rect x='30' y='420' width='440' height='120' fill='#f4f1d0'/><rect x='60' y='580' width='380' height='40' fill='#f4f1d0'/></svg>`,
  );
const v = (variantId: string, label: string, bg: string, extra: Record<string, unknown> = {}) => ({
  variantId, code: "OP03-001", name: "Nami", label, image: ref(bg), rarity: "SR", setName: "Pillars of Strength [OP-03]",
  color: "Blue", type: "Character", price: 1, fullName: `Nami (${label})`, cost: "1", power: "1000", counter: "",
  attribute: "", subTypes: "", life: "", text: "", ...extra,
});
const VARIANTS = [
  v("OP03-001", "Normal", "#c22"),
  v("OP03-001_p1", "Parallel 1", "#1a9a3a", { fullName: "Nami (Alternate Art)" }),
  v("OP03-001_p2", "Manga", "#1f3fbf", { fullName: "Nami (Manga)" }),
];

async function mockApi(page: Page) {
  await page.route("**/api/card/*", (r) => r.fulfill({ json: { code: "OP03-001", variants: VARIANTS } }));
}

// Embeddings falsos y deterministas: color medio en una rejilla 4x4, centrado.
async function fakeEmbedder(page: Page, opts: { fail?: boolean } = {}) {
  await page.addInitScript((fail) => {
    if (fail) {
      window.__opmcEmbedder = { fail: true };
      return;
    }
    window.__opmcEmbedder = {
      version: "fake-1",
      embed: async (rgba: Uint8ClampedArray, size: number) => {
        const out = new Array(48).fill(0);
        const cell = size / 4;
        for (let y = 0; y < size; y++)
          for (let x = 0; x < size; x++) {
            const k = (y * size + x) * 4;
            const c = (Math.floor(y / cell) * 4 + Math.floor(x / cell)) * 3;
            for (let i = 0; i < 3; i++) out[c + i] += rgba[k + i] / 255 - 0.5;
          }
        const n = Math.hypot(...out) || 1;
        return out.map((x) => x / n);
      },
    };
  }, !!opts.fail);
}

async function cardPhoto(page: Page, bg: string): Promise<Buffer> {
  const p = await page.context().newPage();
  await p.setViewportSize({ width: 1000, height: 1300 });
  await p.setContent(`<body style="margin:0;background:#e8e8e4">
    <div style="position:absolute;left:250px;top:300px;width:500px;height:698px;border-radius:14px;background:${bg};border:6px solid #222;box-sizing:border-box">
      <div style="position:absolute;left:30px;right:30px;top:420px;height:120px;background:#f4f1d0;font:16px Arial;padding:8px">Activate Main Once Per Turn</div>
      <div style="position:absolute;left:60px;right:60px;top:580px;height:40px;background:#f4f1d0;font:bold 28px Georgia;text-align:center">Nami</div>
      <div style="position:absolute;right:18px;bottom:12px;padding:2px 6px;background:#fff;font:bold 22px Arial;letter-spacing:1px">OP03-001</div>
    </div></body>`);
  const buf = await p.screenshot();
  await p.close();
  return buf;
}
const upload = async (page: Page, bg = "#1a9a3a") =>
  page.locator('input[type="file"]').setInputFiles({ name: "carta.png", mimeType: "image/png", buffer: await cardPhoto(page, bg) });

async function bulk(page: Page) {
  await page.goto("/escanear");
  await page.getByRole("tab", { name: "Bulk" }).click();
}

test.beforeEach(async ({ page }) => mockApi(page));

test("arte: la ilustración clara se acepta sola y muestra la coincidencia", async ({ page }) => {
  await fakeEmbedder(page);
  await bulk(page);
  await expect(page.getByRole("button", { name: /Reconocimiento por arte/ })).toHaveAttribute("aria-pressed", "true");
  await upload(page);
  const banner = page.getByTestId("read-banner");
  await expect(banner).toContainText("Nami (Alternate Art)", { timeout: 40_000 });
  await expect(banner).toContainText(/Coincidencia de arte: \d+%/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(banner).toHaveCount(0, { timeout: 5000 });
  const q = await page.evaluate(() => JSON.parse(localStorage.getItem("opmc.bulkQueue.v1") || "[]"));
  expect(q[0]).toMatchObject({ code: "OP03-001", variantId: "OP03-001_p1" });
});

test("arte: con margen exigente pregunta y marca la sugerida", async ({ page }) => {
  await fakeEmbedder(page);
  await page.addInitScript(() => localStorage.setItem("opmc.artMargin.v1", "0.95"));
  await bulk(page);
  await upload(page);
  const picker = page.getByRole("dialog", { name: "Elige la versión de OP03-001" });
  await expect(picker.getByTestId("confirm-suggested")).toHaveText("Confirmar sugerida: Parallel 1", { timeout: 40_000 });
  await expect(picker.getByTestId("art-score")).toHaveCount(3);
  await expect(picker.getByTestId("hint-summary")).toContainText(/Coincidencia de arte: \d+%/);
  // la sugerida va primero
  await expect(picker.getByTestId("variant-option").first()).toContainText("Sugerida");
  await expect(picker.getByTestId("variant-option").first()).toContainText("Parallel 1");
});

test("arte: si el modelo no carga, sigue como antes y lo avisa", async ({ page }) => {
  await fakeEmbedder(page, { fail: true });
  await bulk(page);
  await upload(page, "#1f3fbf");
  // sin arte: o pregunta, o acepta por las pistas de siempre; nunca muestra coincidencia
  const picker = page.getByRole("dialog", { name: "Elige la versión de OP03-001" });
  const banner = page.getByTestId("read-banner");
  await expect(picker.or(banner)).toBeVisible({ timeout: 40_000 });
  await expect(page.getByText(/Coincidencia de arte/)).toHaveCount(0);
  await expect(page.getByTestId("art-notice")).toContainText("No se pudo cargar");
});

test("arte: el ajuste se desactiva y se recuerda", async ({ page }) => {
  await fakeEmbedder(page);
  await bulk(page);
  const toggle = page.getByRole("button", { name: /Reconocimiento por arte/ });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await page.reload();
  await expect(page.getByRole("button", { name: /Reconocimiento por arte/ })).toHaveAttribute("aria-pressed", "false");
  await upload(page);
  const picker = page.getByRole("dialog", { name: "Elige la versión de OP03-001" });
  const banner = page.getByTestId("read-banner");
  await expect(picker.or(banner)).toBeVisible({ timeout: 40_000 });
  await expect(page.getByText(/Coincidencia de arte/)).toHaveCount(0);
});

// De punta a punta con el worker real y ONNX Runtime Web (WASM), sirviendo un
// modelo diminuto en lugar de DINOv2 (Hugging Face no es accesible aquí).
test("arte: worker real con ONNX Runtime Web elige el arte correcto", async ({ page }) => {
  const model = readFileSync(join(__dirname, "fixtures", "tiny-embed.onnx"));
  await page.addInitScript(() => localStorage.setItem("opmc.artModelNotice.v1", "1"));
  await page.context().route("https://huggingface.co/**", (r) =>
    r.fulfill({ body: model, headers: { "content-type": "application/octet-stream", "content-length": String(model.length), "access-control-allow-origin": "*" } }),
  );
  await bulk(page);
  await upload(page);
  const banner = page.getByTestId("read-banner");
  await expect(banner).toContainText("Nami (Alternate Art)", { timeout: 50_000 });
  await expect(banner).toContainText(/Coincidencia de arte: \d+%/);
  // los vectores de referencia quedaron en IndexedDB
  const keys = await page.evaluate(
    () =>
      new Promise<number>((res) => {
        const r = indexedDB.open("opmc-embeddings");
        r.onsuccess = () => {
          const c = r.result.transaction("vec").objectStore("vec").count();
          c.onsuccess = () => res(c.result);
        };
      }),
  );
  expect(keys).toBeGreaterThanOrEqual(3);
});
