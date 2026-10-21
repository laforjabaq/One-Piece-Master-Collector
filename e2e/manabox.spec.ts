import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Lecciones de ManaBox: índice de arte precalculado, arte como señal
// principal, modo Rápido, ajustes fijos de sesión y edición masiva al final.
test.use({ serviceWorkers: "block" });

const ref = (bg: string) =>
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='500' height='698'><rect width='500' height='698' fill='${bg}'/>` +
      `<rect x='30' y='420' width='440' height='120' fill='#f4f1d0'/><rect x='60' y='580' width='380' height='40' fill='#f4f1d0'/></svg>`,
  );
const v = (code: string, variantId: string, label: string, image: string, extra: Record<string, unknown> = {}) => ({
  variantId, code, name: "Nami", label, image, rarity: "SR", setName: "Pillars of Strength [OP-03]", color: "Blue", type: "Character",
  price: 1, fullName: label === "Normal" ? "Nami" : `Nami (${label})`, cost: "1", power: "1000", counter: "", attribute: "", subTypes: "", life: "", text: "", ...extra,
});
const NAMI = (img: (bg: string) => string) => [
  v("OP03-001", "OP03-001", "Normal", img("#c22")),
  v("OP03-001", "OP03-001_p1", "Alternate Art", img("#1a9a3a"), { price: 2.5 }),
  v("OP03-001", "OP03-001_p2", "Manga", img("#1f3fbf")),
  v("OP03-001", "OP03-001_p3", "SP", img("#e0a020")),
];
const ACE = [
  v("OP02-013", "OP02-013", "Normal", ref("#c22"), { name: "Portgas.D.Ace", fullName: "Portgas.D.Ace", setName: "Paramount War [OP-02]", price: 3 }),
  v("OP02-013", "OP02-013_r1", "Reprint", ref("#2a7"), { name: "Portgas.D.Ace", fullName: "Portgas.D.Ace (Reprint)", setName: "Premium Booster [PRB-01]", price: 4 }),
];

async function mockApi(page: Page, cards: Record<string, unknown[]>) {
  await page.route("**/api/card/*", (r) => {
    const code = decodeURIComponent(r.request().url().split("/").pop()!);
    const variants = cards[code];
    return r.fulfill({ status: variants ? 200 : 404, json: variants ? { code, variants } : { error: "No encontrada" } });
  });
}

async function fakeEmbedder(page: Page) {
  await page.addInitScript(() => {
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
  });
}

async function cardPhoto(page: Page, bg: string, code: string, name = "Nami", rotate = 0): Promise<Buffer> {
  const p = await page.context().newPage();
  await p.setViewportSize({ width: 1000, height: 1300 });
  await p.setContent(`<body style="margin:0;background:#e8e8e4">
    <div style="position:absolute;left:250px;top:300px;width:500px;height:698px;border-radius:14px;background:${bg};border:6px solid #222;box-sizing:border-box;transform:rotate(${rotate}deg)">
      <div style="position:absolute;left:30px;right:30px;top:420px;height:120px;background:#f4f1d0"></div>
      <div style="position:absolute;left:60px;right:60px;top:580px;height:40px;background:#f4f1d0;font:bold 28px Georgia;text-align:center">${name}</div>
      ${code ? `<div style="position:absolute;right:18px;bottom:12px;padding:2px 6px;background:#fff;font:bold 22px Arial;letter-spacing:1px">${code}</div>` : ""}
    </div></body>`);
  const buf = await p.screenshot();
  await p.close();
  return buf;
}
const upload = async (page: Page, bg: string, code: string, name?: string, rotate = 0) =>
  page.locator('input[type="file"]').setInputFiles({ name: "carta.png", mimeType: "image/png", buffer: await cardPhoto(page, bg, code, name, rotate) });
const queue = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("opmc.bulkQueue.v1") || "[]"));

// Índice generado con scripts/build-embeddings.mjs y el modelo diminuto de
// e2e/fixtures (mismo preprocesado que el worker), servido como /embeddings/*.
async function realWorkerWithIndex(page: Page) {
  const model = readFileSync(join(__dirname, "fixtures", "tiny-embed.onnx"));
  await page.addInitScript(() => localStorage.setItem("opmc.artModelNotice.v1", "1"));
  await page.context().route("https://huggingface.co/**", (r) =>
    r.fulfill({ body: model, headers: { "content-type": "application/octet-stream", "content-length": String(model.length), "access-control-allow-origin": "*" } }),
  );
  await page.route("**/embeddings/index.json", (r) => r.fulfill({ body: readFileSync(join(__dirname, "fixtures", "index", "index.json")), contentType: "application/json" }));
  await page.route("**/embeddings/index.bin", (r) => r.fulfill({ body: readFileSync(join(__dirname, "fixtures", "index", "index.bin")), contentType: "application/octet-stream" }));
  // Las imágenes de referencia no cargan: si acierta, es por el índice.
  await page.route("https://optcgapi.com/**", (r) => r.fulfill({ status: 404, body: "" }));
}
const broken = (bg: string) => `https://optcgapi.com/img/${bg.slice(1)}.png`;

test("índice: con el índice precalculado el arte se compara sin bajar imágenes", async ({ page }) => {
  await realWorkerWithIndex(page);
  await mockApi(page, { "OP03-001": NAMI(broken).slice(0, 3) });
  await page.goto("/escanear");
  await page.getByRole("tab", { name: "Bulk" }).click();
  await upload(page, "#1a9a3a", "OP03-001");
  const banner = page.getByTestId("read-banner");
  await expect(banner).toContainText("Nami (Alternate Art)", { timeout: 50_000 });
  await expect(banner).toContainText(/Coincidencia de arte: \d+%/);
  await expect(page.locator("html")).toHaveAttribute("data-art-source", "index");
  // el embudo muestra los vecinos del índice
  await expect(banner.getByTestId("funnel")).toContainText(/^Arte top-8: OP03-001/);
});

test("índice: el arte es la señal principal aunque no se lean nombre ni código", async ({ page }) => {
  await realWorkerWithIndex(page);
  await mockApi(page, { "OP03-001": NAMI(broken).slice(0, 3) });
  await page.goto("/escanear");
  await page.getByRole("tab", { name: "Rápido" }).click();
  await upload(page, "#1a9a3a", "", "");
  await expect.poll(async () => (await queue(page))[0]?.variantId, { timeout: 60_000 }).toBe("OP03-001_p1");
  await expect(page.getByTestId("fast-count")).toHaveText("1 cartas · $2.50");
});

test("sin índice: sigue con el cálculo por candidata", async ({ page }) => {
  await fakeEmbedder(page);
  await mockApi(page, { "OP03-001": NAMI(ref).slice(0, 3) });
  await page.goto("/escanear");
  await page.getByRole("tab", { name: "Bulk" }).click();
  await upload(page, "#1a9a3a", "OP03-001");
  await expect(page.getByTestId("read-banner")).toContainText("Nami (Alternate Art)", { timeout: 40_000 });
  await expect(page.locator("html")).toHaveAttribute("data-art-source", "lazy");
});

test("rápido: la lectura segura se añade sola con contador y valor acumulado", async ({ page }) => {
  await fakeEmbedder(page);
  await mockApi(page, { "OP03-001": NAMI(ref) });
  await page.goto("/escanear");
  await page.getByRole("tab", { name: "Rápido" }).click();
  await expect(page.getByTestId("fast-count")).toHaveText("0 cartas · $0.00");
  await upload(page, "#1a9a3a", "OP03-001");
  await expect(page.getByTestId("fast-count")).toHaveText("1 cartas · $2.50", { timeout: 40_000 });
  // sin banner de 3 s ni selector
  await expect(page.getByTestId("read-banner")).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect((await queue(page))[0]).toMatchObject({ code: "OP03-001", variantId: "OP03-001_p1" });
  await expect(page.getByTestId("scanner-status")).toContainText("1 cartas · $2.50");
  // el modo se recuerda
  await page.reload();
  await expect(page.getByRole("tab", { name: "Rápido" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("fast-count")).toHaveText("1 cartas · $2.50");
});

test("rápido: si duda, muestra solo las 3 mejores para tocar", async ({ page }) => {
  await fakeEmbedder(page);
  await page.addInitScript(() => localStorage.setItem("opmc.artMargin.v1", "0.95"));
  await mockApi(page, { "OP03-001": NAMI(ref) });
  await page.goto("/escanear");
  await page.getByRole("tab", { name: "Rápido" }).click();
  await upload(page, "#1a9a3a", "OP03-001");
  const picker = page.getByRole("dialog", { name: "Elige la versión de OP03-001" });
  await expect(picker.getByTestId("variant-option")).toHaveCount(3, { timeout: 40_000 });
  await expect(picker.getByTestId("variant-option").first()).toContainText("Alternate Art");
  await picker.getByTestId("variant-option").first().click();
  await expect(page.getByTestId("fast-count")).toHaveText("1 cartas · $2.50");
});

test("sesión: set bloqueado, foil e idioma se aplican a cada lectura y se recuerdan", async ({ page }) => {
  await mockApi(page, { "OP02-013": ACE });
  await page.goto("/escanear");
  await page.getByRole("tab", { name: "Bulk" }).click();
  const bar = page.getByTestId("session-bar");
  await bar.getByRole("button", { name: "Bloquear set" }).click();
  await bar.getByLabel("Set a bloquear").fill("prb-01");
  await bar.getByRole("button", { name: "Bloquear" }).click();
  await bar.getByRole("button", { name: "Foil" }).click();
  await bar.getByLabel("Idioma de la sesión").selectOption("JP");
  await page.reload();
  await expect(bar.getByRole("button", { name: "Quitar set PRB01" })).toBeVisible();
  await expect(bar.getByRole("button", { name: "Foil ✓" })).toHaveAttribute("aria-pressed", "true");
  await expect(bar.getByLabel("Idioma de la sesión")).toHaveValue("JP");
  // OP02-013 tiene 2 versiones, pero solo una es de PRB01: no pregunta
  await page.getByPlaceholder("Escribe el código (OP05-119)").fill("OP02-013");
  await page.getByRole("button", { name: "Añadir" }).click();
  await expect(page.getByTestId("queue-count")).toHaveText("En cola: 1 / 30");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect((await queue(page))[0]).toMatchObject({ code: "OP02-013", variantId: "OP02-013_r1", foil: true, lang: "JP" });
  // quitar el set vuelve a preguntar entre todas
  await bar.getByRole("button", { name: "Quitar set PRB01" }).click();
  await page.getByPlaceholder("Escribe el código (OP05-119)").fill("OP02-013");
  await page.getByRole("button", { name: "Añadir" }).click();
  await expect(page.getByRole("dialog", { name: "Elige la versión de OP02-013" }).getByTestId("variant-option")).toHaveCount(2);
});

test("revisión: edición masiva de set, foil, idioma, cantidad y borrar", async ({ page }) => {
  await page.addInitScript((items) => {
    if (!localStorage.getItem("opmc.bulkQueue.v1")) localStorage.setItem("opmc.bulkQueue.v1", JSON.stringify(items));
  }, [
    { code: "OP02-013", qty: 1, variants: ACE, variantId: "OP02-013", checked: true, at: 1 },
    { code: "OP03-001", qty: 2, variants: NAMI(ref), variantId: "OP03-001", checked: true, at: 2 },
  ]);
  await page.goto("/escanear");
  await page.getByRole("tab", { name: "Bulk" }).click();
  await page.getByRole("button", { name: "Revisar" }).click();
  const dialog = page.getByRole("dialog", { name: "Revisar lote" });
  await expect(dialog.getByTestId("review-total")).toContainText("3 cartas · Valor: $5.00");
  const edit = dialog.getByTestId("bulk-edit");
  await edit.getByRole("button", { name: "Foil", exact: true }).click();
  await edit.getByLabel("Idioma de las marcadas").selectOption("JP");
  await edit.getByLabel("Cantidad de las marcadas").fill("3");
  await edit.getByRole("button", { name: "Poner cantidad" }).click();
  await edit.getByLabel("Set de las marcadas").selectOption("PRB01");
  await expect(dialog.getByLabel("Versión de OP02-013")).toHaveValue("OP02-013_r1");
  await expect(dialog.getByTestId("review-total")).toContainText("6 cartas · Valor: $15.00");
  // borrar solo Nami
  await dialog.getByLabel("Incluir Portgas.D.Ace").uncheck();
  await edit.getByRole("button", { name: "Borrar marcadas" }).click();
  await expect(dialog.getByTestId("queue-item")).toHaveCount(1);
  await edit.getByLabel("Marcar todas").check();
  await dialog.getByRole("button", { name: /Agregar 3 a la colección/ }).click();
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("opmc.collection.v1") || "{}"));
  expect(stored["OP02-013_r1|bulk|foil|JP"]).toMatchObject({ qty: 3, foil: true, lang: "JP", bulk: true });
  await page.goto("/");
  await expect(page.locator(".pill", { hasText: "Foil" })).toBeVisible();
});

test("perspectiva: una carta girada se endereza antes de leer el código y comparar el arte", async ({ page }) => {
  await fakeEmbedder(page);
  await mockApi(page, { "OP03-001": NAMI(ref).slice(0, 3) });
  await page.goto("/escanear");
  await page.getByRole("tab", { name: "Bulk" }).click();
  await upload(page, "#1a9a3a", "OP03-001", "Nami", 7);
  await expect(page.getByTestId("read-banner")).toContainText("Nami (Alternate Art)", { timeout: 40_000 });
  await expect(page.locator("html")).toHaveAttribute("data-warped", /[1-9]/);
});
