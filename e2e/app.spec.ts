import { test, expect, type Page } from "@playwright/test";

const IMG = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='63' height='88'/>";
const svg = (bg: string, word: string) =>
  "data:image/svg+xml;utf8," + encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='63' height='88'><rect width='63' height='88' fill='${bg}'/><text x='4' y='44' font-size='10' fill='#fff'>${word}</text></svg>`);
const v = (code: string, name: string, extra: Record<string, unknown> = {}) => ({
  variantId: code, code, name, label: "Normal", image: IMG, rarity: "SR", setName: "Set", color: "Red",
  type: "Character", price: 1.5, fullName: name, cost: "4", power: "6000", counter: "1000",
  attribute: "Strike", subTypes: "Straw Hat Crew", life: "", text: "[On Play] Robar 1 carta.", ...extra,
});
const CARDS: Record<string, unknown[]> = {
  "OP01-001": [v("OP01-001", "Roronoa Zoro"), v("OP01-001", "Roronoa Zoro", { variantId: "OP01-001_p1", label: "Parallel 1", fullName: "Roronoa Zoro (Alternate Art)", price: 20 })],
  "OP01-002": [v("OP01-002", "Trafalgar Law")],
  "OP02-013": [
    v("OP02-013", "Portgas.D.Ace", { setName: "Paramount War [OP-02]", image: svg("#c22", "ACE") }),
    v("OP02-013", "Portgas.D.Ace", { variantId: "OP02-013_r1", label: "Reprint", fullName: "Portgas.D.Ace (Reprint)", setName: "Premium Booster [PRB-01]", image: svg("#2a7", "ACE") }),
    v("OP02-013", "Portgas.D.Ace", { variantId: "OP02-013_p1", label: "Winner", fullName: "Portgas.D.Ace (Winner)", rarity: "P", setName: "Tournament Pack Vol. 3", image: svg("#6b2d8f", "WINNER") }),
    v("OP02-013", "Portgas.D.Ace", { variantId: "OP02-013_p2", label: "Judge", fullName: "Portgas.D.Ace (Judge)", rarity: "P", setName: "Judge Pack Vol. 1", image: svg("#147", "JUDGE") }),
  ],
  "P-001": [v("P-001", "Monkey.D.Luffy", { fullName: "Monkey.D.Luffy (Winner)" })],
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
        cards: Object.entries(CARDS).map(([code, vs]) => {
          const f = vs[0] as ReturnType<typeof v>;
          return { code, name: f.name, setName: "Set", rarity: "SR", color: "Red", image: IMG, variants: vs.length, names: vs.map((x) => (x as ReturnType<typeof v>).fullName) };
        }),
      },
    }),
  );
}

test.beforeEach(async ({ page }) => mockApi(page));

test("bulk: encola, deduplica, revisa y agrega a la colección", async ({ page }) => {
  await page.goto("/escanear");
  await page.getByRole("tab", { name: "Bulk" }).click();
  const input = page.getByPlaceholder("Escribe el código (OP05-119)");
  for (const c of ["OP01-001", "OP01-002", "OP01-001"]) {
    await input.fill(c);
    await page.getByRole("button", { name: "Añadir" }).click();
    // OP01-001 tiene 2 versiones: se pregunta cuál antes de encolar
    if (c === "OP01-001") await page.getByRole("dialog", { name: "Elige la versión de OP01-001" }).getByRole("button", { name: "Elegir Normal" }).click();
    await expect(input).toHaveValue("");
  }
  await expect(page.getByTestId("queue-count")).toHaveText("En cola: 3 / 30");

  // La cola sobrevive a una recarga
  await page.reload();
  await expect(page.getByTestId("queue-count")).toHaveText("En cola: 3 / 30");

  await page.getByRole("button", { name: "Revisar" }).click();
  const dialog = page.getByRole("dialog", { name: "Revisar lote" });
  await expect(dialog.getByTestId("queue-item")).toHaveCount(2);
  await dialog.getByLabel("Versión de OP01-001").selectOption("OP01-001_p1");
  await dialog.getByLabel("Incluir Trafalgar Law").uncheck();
  await dialog.getByRole("button", { name: /Agregar 2 a la colección/ }).click();
  await expect(page.getByTestId("queue-count")).toHaveText("En cola: 0 / 30");

  await page.goto("/");
  await expect(page.getByText("Parallel 1")).toBeVisible();
  await expect(page.locator(".pill", { hasText: "Bulk" })).toBeVisible();
  await expect(page.getByText("Trafalgar Law")).toHaveCount(0);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("opmc.collection.v1") || "{}"));
  expect(stored["OP01-001_p1|bulk"]).toMatchObject({ qty: 2, bulk: true });

  // Ventana de detalle desde la colección
  await page.getByRole("button", { name: /Ver detalle de Roronoa Zoro/ }).click();
  const modal = page.getByRole("dialog", { name: "Roronoa Zoro" });
  await expect(modal.getByText("[On Play] Robar 1 carta.")).toBeVisible();
  await expect(modal.getByText("$20.00", { exact: true })).toBeVisible();
});

test("buscar: nombre completo sin acentos y ventana de detalle", async ({ page }) => {
  await page.goto("/buscar");
  await page.getByPlaceholder("Nombre o código").fill("wínner");
  await page.getByText("Monkey.D.Luffy").click();
  const modal = page.getByRole("dialog");
  await expect(modal.getByText("Monkey.D.Luffy (Winner)")).toBeVisible();
  await expect(modal.getByText("6000")).toBeVisible();
  await page.getByRole("button", { name: "Cerrar" }).click();
  await expect(modal).toHaveCount(0);
  await page.getByPlaceholder("Nombre o código").fill("alternate art");
  await expect(page.getByText("Roronoa Zoro")).toBeVisible();
});

test("1 a 1: detalle desde la página de la carta", async ({ page }) => {
  await page.goto("/carta/OP01-001");
  await page.getByRole("button", { name: "Ver detalle", exact: true }).nth(1).click();
  await expect(page.getByRole("dialog").getByText("Roronoa Zoro (Alternate Art)")).toBeVisible();
});

// Foto sintética "desde el slinger": carta chica y centrada sobre fondo claro,
// con el código diminuto abajo a la derecha de la carta (no del encuadre).
async function cardPhoto(page: Page, code: string, stamp = ""): Promise<Buffer> {
  const p = await page.context().newPage();
  await p.setViewportSize({ width: 1000, height: 1300 });
  await p.setContent(`<body style="margin:0;background:#e8e8e4">
    <div id="c" style="position:absolute;left:250px;top:300px;width:500px;height:698px;border-radius:14px;
      background:linear-gradient(135deg,#c9b21a,#6b2d8f 60%,#2a1440);border:6px solid #222;box-sizing:border-box">
      <div style="position:absolute;left:30px;top:30px;width:60px;height:60px;border-radius:50%;background:#fff;font:bold 40px Arial;text-align:center">6</div>
      ${stamp ? `<div style="position:absolute;left:90px;right:90px;top:250px;height:110px;background:#f4f1d0;font:900 72px Arial;text-align:center;line-height:110px">${stamp}</div>` : ""}
      <div style="position:absolute;left:30px;right:30px;top:420px;height:120px;background:#f4f1d0;font:16px Arial;padding:8px">Activate Main Once Per Turn You may reveal 3 cards from your hand</div>
      <div style="position:absolute;left:60px;right:60px;top:580px;height:40px;background:#f4f1d0;font:bold 28px Georgia;text-align:center">Gorgon Sisters</div>
      <div style="position:absolute;right:18px;bottom:12px;padding:2px 6px;background:#fff;font:bold 22px Arial;letter-spacing:1px">${code}</div>
    </div></body>`);
  const buf = await p.screenshot();
  await p.close();
  return buf;
}
const upload = async (page: Page, code: string, stamp = "") =>
  page.locator('input[type="file"]').setInputFiles({ name: "carta.png", mimeType: "image/png", buffer: await cardPhoto(page, code, stamp) });

test("bulk: foto lejana, elige versión y el banner acepta al terminar la cuenta", async ({ page }) => {
  await page.goto("/escanear");
  await page.getByRole("tab", { name: "Bulk" }).click();
  await upload(page, "OP01-001");
  const picker = page.getByRole("dialog", { name: "Elige la versión de OP01-001" });
  await expect(picker.getByTestId("variant-option")).toHaveCount(2, { timeout: 30_000 });
  await expect(page.getByTestId("queue-count")).toHaveText("En cola: 0 / 30");
  await picker.getByRole("button", { name: "Elegir Parallel 1" }).click();
  const banner = page.getByTestId("read-banner");
  await expect(banner).toContainText("Roronoa Zoro (Alternate Art)");
  await expect(banner.getByRole("button", { name: "Cancelar" })).toBeVisible();
  await expect(page.getByTestId("queue-count")).toHaveText("En cola: 0 / 30");
  await expect(banner).toHaveCount(0, { timeout: 5000 });
  await expect(page.getByTestId("queue-count")).toHaveText("En cola: 1 / 30");
  const q = await page.evaluate(() => JSON.parse(localStorage.getItem("opmc.bulkQueue.v1") || "[]"));
  expect(q[0]).toMatchObject({ code: "OP01-001", variantId: "OP01-001_p1", qty: 1 });
});

test("bulk: una sola versión va directo al banner y Cancelar la descarta", async ({ page }) => {
  await page.goto("/escanear");
  await page.getByRole("tab", { name: "Bulk" }).click();
  await upload(page, "OP01-002");
  const banner = page.getByTestId("read-banner");
  await expect(banner).toContainText("Trafalgar Law", { timeout: 30_000 });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await banner.getByRole("button", { name: "Cancelar" }).click();
  await expect(banner).toHaveCount(0);
  await page.waitForTimeout(3500);
  await expect(page.getByTestId("queue-count")).toHaveText("En cola: 0 / 30");
});

test("1 a 1: banner con Cancelar se queda; sin tocar abre la carta", async ({ page }) => {
  await page.goto("/escanear");
  await upload(page, "OP01-002");
  const banner = page.getByTestId("read-banner");
  await expect(banner).toContainText("Trafalgar Law", { timeout: 30_000 });
  await banner.getByRole("button", { name: "Cancelar" }).click();
  await page.waitForTimeout(3500);
  await expect(page).toHaveURL(/\/escanear$/);

  await upload(page, "OP01-001");
  await expect(banner).toContainText("Roronoa Zoro", { timeout: 30_000 });
  await expect(page).toHaveURL(/\/escanear$/);
  await page.waitForURL(/\/carta\/OP01-001$/, { timeout: 6000 });
});

test("modo slinger: achica el marco y se recuerda", async ({ page }) => {
  await page.goto("/escanear");
  const frame = page.locator(".frame");
  await expect(frame).toBeVisible();
  const before = (await frame.boundingBox())!.height;
  await page.getByRole("button", { name: /Modo slinger/ }).click();
  await expect(page.getByRole("button", { name: /Modo slinger/ })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => (await frame.boundingBox())!.height).toBeLessThan(before * 0.8);
  await page.reload();
  await expect(page.getByRole("button", { name: /Modo slinger/ })).toHaveAttribute("aria-pressed", "true");
});

test("filtros: chips por set, rareza y sello acotan las versiones del mismo código", async ({ page }) => {
  await page.goto("/carta/OP02-013");
  const cards = page.getByTestId("variant-card");
  await expect(cards).toHaveCount(4);
  const filters = page.getByTestId("variant-filters");
  await expect(filters.getByRole("group", { name: "Set" })).toBeVisible();
  await expect(filters.getByRole("group", { name: "Rareza" }).getByRole("button", { name: "P 2" })).toBeVisible();
  await filters.getByRole("group", { name: "Rareza" }).getByRole("button", { name: /^P/ }).click();
  await expect(cards).toHaveCount(2);
  await filters.getByRole("group", { name: "Versión/Sello" }).getByRole("button", { name: /^Judge/ }).click();
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Solo agregar" }).click();
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("opmc.collection.v1") || "{}"));
  expect(stored["OP02-013_p2"]).toMatchObject({ qty: 1 });

  // La última elección desempata: el selector de bulk la sugiere
  await page.goto("/escanear");
  await page.getByRole("tab", { name: "Bulk" }).click();
  await page.getByPlaceholder("Escribe el código (OP05-119)").fill("OP02-013");
  await page.getByRole("button", { name: "Añadir" }).click();
  const picker = page.getByRole("dialog", { name: "Elige la versión de OP02-013" });
  await expect(picker.getByTestId("confirm-suggested")).toHaveText("Confirmar sugerida: Judge");
  await picker.getByRole("group", { name: "Set" }).getByRole("button", { name: /^PRB01/ }).click();
  await expect(picker.getByTestId("variant-option")).toHaveCount(1);
  await picker.getByRole("button", { name: "Usar Reprint" }).click();
  await expect(page.getByTestId("queue-count")).toHaveText("En cola: 1 / 30");
});

test("buscar: los chips también filtran el selector de la ventana de detalle", async ({ page }) => {
  await page.goto("/buscar");
  await page.getByPlaceholder("Nombre o código").fill("OP02-013");
  await page.getByText("Portgas.D.Ace").click();
  const modal = page.getByRole("dialog");
  await modal.getByRole("group", { name: "Versión/Sello" }).getByRole("button", { name: /^Winner/ }).click();
  await expect(modal.getByText("Portgas.D.Ace (Winner)")).toBeVisible();
  await expect(modal.getByLabel("Versión", { exact: true })).toHaveCount(0);
});

test("bulk: el sello WINNER leído en la foto preselecciona esa versión", async ({ page }) => {
  await page.goto("/escanear");
  await page.getByRole("tab", { name: "Bulk" }).click();
  await upload(page, "OP02-013", "WINNER");
  const banner = page.getByTestId("read-banner");
  await expect(banner).toContainText("Portgas.D.Ace (Winner)", { timeout: 40_000 });
  await expect(banner).toContainText("Detectado: WINNER");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(banner).toHaveCount(0, { timeout: 5000 });
  const q = await page.evaluate(() => JSON.parse(localStorage.getItem("opmc.bulkQueue.v1") || "[]"));
  expect(q[0]).toMatchObject({ code: "OP02-013", variantId: "OP02-013_p1" });
});
