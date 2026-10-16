import { test, expect, type Page } from "@playwright/test";

const IMG = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='63' height='88'/>";
const v = (code: string, name: string, extra: Record<string, unknown> = {}) => ({
  variantId: code, code, name, label: "Normal", image: IMG, rarity: "SR", setName: "Set", color: "Red",
  type: "Character", price: 1.5, fullName: name, cost: "4", power: "6000", counter: "1000",
  attribute: "Strike", subTypes: "Straw Hat Crew", life: "", text: "[On Play] Robar 1 carta.", ...extra,
});
const CARDS: Record<string, unknown[]> = {
  "OP01-001": [v("OP01-001", "Roronoa Zoro"), v("OP01-001", "Roronoa Zoro", { variantId: "OP01-001_p1", label: "Parallel 1", fullName: "Roronoa Zoro (Alternate Art)", price: 20 })],
  "OP01-002": [v("OP01-002", "Trafalgar Law")],
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
