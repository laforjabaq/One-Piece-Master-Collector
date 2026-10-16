import { test, expect, type Page } from "@playwright/test";

// Embudo Nombre → Código → Arte: "Boa Hancock" existe en tres códigos (5
// versiones en total), cada versión con un fondo distinto. La foto es la verde.
const ref = (bg: string) =>
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='500' height='698'><rect width='500' height='698' fill='${bg}'/>` +
      `<rect x='30' y='420' width='440' height='120' fill='#f4f1d0'/><rect x='60' y='580' width='380' height='40' fill='#f4f1d0'/></svg>`,
  );
const v = (code: string, variantId: string, name: string, label: string, bg: string) => ({
  variantId, code, name, label, image: ref(bg), rarity: "SR", setName: "Set", color: "Blue", type: "Character", price: 1,
  fullName: label === "Normal" ? name : `${name} (${label})`, cost: "1", power: "1000", counter: "", attribute: "", subTypes: "", life: "", text: "",
});
const CARDS: Record<string, ReturnType<typeof v>[]> = {
  "OP01-078": [v("OP01-078", "OP01-078", "Boa Hancock", "Normal", "#c22"), v("OP01-078", "OP01-078_p1", "Boa Hancock", "Alternate Art", "#e0a020")],
  "OP07-051": [v("OP07-051", "OP07-051", "Boa Hancock", "Normal", "#1f3fbf"), v("OP07-051", "OP07-051_p1", "Boa Hancock", "Alternate Art", "#1a9a3a")],
  "ST03-013": [v("ST03-013", "ST03-013", "Boa Hancock", "Normal", "#7a2a9a")],
  "OP01-016": [v("OP01-016", "OP01-016", "Nami", "Normal", "#888")],
};

async function mockApi(page: Page) {
  await page.route("**/api/card/*", (r) => {
    const code = decodeURIComponent(r.request().url().split("/").pop()!);
    const variants = CARDS[code];
    return r.fulfill({ status: variants ? 200 : 404, json: variants ? { code, variants } : { error: "No encontrada" } });
  });
  await page.route("**/api/cards", (r) =>
    r.fulfill({
      json: {
        cards: Object.entries(CARDS).map(([code, vs]) => ({
          code, name: vs[0].name, setName: "Set", rarity: "SR", color: "Blue", image: vs[0].image, variants: vs.length, names: vs.map((x) => x.fullName),
        })),
      },
    }),
  );
}

// Embeddings falsos: color medio en una rejilla 4x4.
async function fakeEmbedder(page: Page) {
  await page.addInitScript(() => {
    window.__opmcEmbedder = {
      version: "fake-funnel",
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
  });
}

async function cardPhoto(page: Page, name: string, code: string): Promise<Buffer> {
  const p = await page.context().newPage();
  await p.setViewportSize({ width: 1000, height: 1300 });
  await p.setContent(`<body style="margin:0;background:#e8e8e4">
    <div style="position:absolute;left:250px;top:300px;width:500px;height:698px;border-radius:14px;background:#1a9a3a;border:6px solid #222;box-sizing:border-box">
      <div style="position:absolute;left:30px;right:30px;top:420px;height:120px;background:#f4f1d0;font:16px Arial;padding:8px">Activate Main Once Per Turn</div>
      <div style="position:absolute;left:60px;right:60px;top:580px;height:40px;background:#f4f1d0;font:bold 30px Arial;text-align:center;line-height:40px">${name}</div>
      ${code ? `<div style="position:absolute;right:18px;bottom:12px;padding:2px 6px;background:#fff;font:bold 22px Arial;letter-spacing:1px">${code}</div>` : ""}
    </div></body>`);
  const buf = await p.screenshot();
  await p.close();
  return buf;
}

async function scan(page: Page, name: string, code: string) {
  await page.goto("/escanear");
  await page.getByRole("tab", { name: "Bulk" }).click();
  await page.locator('input[type="file"]').setInputFiles({ name: "carta.png", mimeType: "image/png", buffer: await cardPhoto(page, name, code) });
}
const queue = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("opmc.bulkQueue.v1") || "[]"));

test.beforeEach(async ({ page }) => {
  await mockApi(page);
  await fakeEmbedder(page);
});

test("embudo: nombre + código + arte acotan y aceptan la versión", async ({ page }) => {
  await scan(page, "Boa Hancock", "OP07-051");
  const banner = page.getByTestId("read-banner");
  await expect(banner.getByTestId("funnel")).toHaveText(/^Nombre: Boa Hancock \(5\) → Código: OP07-051 \(2\) → Arte: \d+%$/, { timeout: 45_000 });
  await expect(banner).toContainText("Boa Hancock (Alternate Art)");
  await expect(banner).toHaveCount(0, { timeout: 5000 });
  expect((await queue(page))[0]).toMatchObject({ code: "OP07-051", variantId: "OP07-051_p1" });
  // el panel de depuración muestra el recorte del nombre
  await expect(page.locator("#ocr-name-preview")).toHaveCount(1);
  await expect(page.getByTestId("ocr-name")).toContainText(/Boa Hancock/i);
});

test("embudo: código ilegible, el nombre y el arte eligen entre todos los códigos", async ({ page }) => {
  await scan(page, "Boa Hancock", "");
  const banner = page.getByTestId("read-banner");
  await expect(banner.getByTestId("funnel")).toHaveText(/^Nombre: Boa Hancock \(5\) → Código: — → Arte: \d+%$/, { timeout: 45_000 });
  await expect(banner).toHaveCount(0, { timeout: 5000 });
  expect((await queue(page))[0]).toMatchObject({ code: "OP07-051", variantId: "OP07-051_p1" });
});

test("embudo: nombre ilegible, sigue solo con el código", async ({ page }) => {
  await scan(page, "", "OP07-051");
  const banner = page.getByTestId("read-banner");
  await expect(banner.getByTestId("funnel")).toHaveText(/^Código: OP07-051 \(2\) → Arte: \d+%$/, { timeout: 45_000 });
  await expect(banner).toHaveCount(0, { timeout: 5000 });
  expect((await queue(page))[0]).toMatchObject({ code: "OP07-051", variantId: "OP07-051_p1" });
});
