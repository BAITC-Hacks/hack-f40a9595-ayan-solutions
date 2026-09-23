import { test, expect } from "@playwright/test";
import type { GraphData, Run } from "../../lib/types";
import { roles } from "../../lib/utils";
import type { Core, NodeSingular } from "cytoscape";

let run: Run;
let graph: GraphData;
test.beforeAll(async ({ request }) => {
  run = await (await request.get("/api/runs/current")).json();
  if (!run.run_id) {
    const job = await (await request.post("/api/runs")).json();
    await expect
      .poll(async () => {
        run = await (await request.get(`/api/runs/${job.run_id}`)).json();
        return run.status;
      })
      .toBe("completed");
  }
  graph = await (await request.get(`/api/runs/${run.run_id}/graph`)).json();
});
test("full graph, no preselected object, real top and nonblank canvas", async ({
  page,
}) => {
  await page.goto(`/network?run=${run.run_id}`);
  await expect(
    page.getByRole("heading", { name: "Транзакционная сеть", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Выберите узел", exact: true }),
  ).toBeVisible();
  await expect(page.locator("tbody tr")).toHaveCount(25);
  const canvas = page.locator(".graph-canvas canvas").last();
  await expect(canvas).toBeVisible();
  expect((await canvas.screenshot()).length).toBeGreaterThan(5000);
  await page.screenshot({ path: "test-results/network-1440.png" });
});
test("smaller nodes show GID only after selection, not hover or zoom", async ({ page }) => {
  await page.goto(`/network?run=${run.run_id}`);
  const host = page.locator(".graph-canvas");
  await expect(host.locator("canvas").last()).toBeVisible();
  const point = await host.evaluate((element) => {
    const cy = (element as HTMLElement & { _cyreg: { cy: Core } })._cyreg.cy;
    const node = cy.nodes().filter((n) => n.data("rank") === 1).first() as NodeSingular;
    const labels = cy.nodes().filter((n) => Boolean(n.style("label"))).length;
    const widths = cy.nodes().map((n) => n.width());
    cy.zoom(1.2);
    cy.center(node);
    return { ...node.renderedPosition(), gid: node.id(), labels, maxWidth: Math.max(...widths) };
  });
  expect(point.labels).toBe(0);
  expect(point.maxWidth).toBeLessThanOrEqual(21);
  await host.hover({ position: { x: point.x, y: point.y } });
  await expect(page.locator(".graph-tooltip")).toBeVisible();
  await expect(page.locator(".graph-tooltip")).not.toContainText(point.gid);
  // Wait beyond the former debounced zoom-label update.
  await page.waitForTimeout(200);
  const labels = () => host.evaluate((element) => {
    const cy = (element as HTMLElement & { _cyreg: { cy: Core } })._cyreg.cy;
    return cy.nodes().filter((n) => Boolean(n.style("label"))).map((n) => n.id());
  });
  expect(await labels()).toEqual([]);
  await host.click({ position: { x: point.x, y: point.y } });
  await expect(page.locator(".inspector-header")).toContainText(point.gid);
  await expect.poll(labels).toEqual([point.gid]);
  await page.screenshot({ path: "test-results/network-selected-label.png" });
});
test("global search selects exact int64 GID and card agrees with CSV DTO", async ({
  page,
}) => {
  const n = graph.nodes.find((n) => n.rank === 1)!;
  await page.goto(`/network?run=${run.run_id}`);
  await page
    .getByRole("combobox", { name: "Найти узел или кластер" })
    .fill(n.gid);
  await page.getByRole("option").filter({ hasText: n.gid }).click();
  await expect(page.locator(".inspector-header")).toContainText(n.gid);
  await expect(page.locator(".inspector-summary")).toContainText(
    roles[n.role].label,
  );
  await expect(page.locator(".inspector-content")).toContainText(n.evidence);
  await page.getByRole("tab", { name: "Связи", exact: true }).click();
  await expect(page.locator(".connection-row").first()).toBeVisible();
  await page.getByRole("tab", { name: "Переводы", exact: true }).click();
  await expect(
    page.locator(".transactions-table tbody tr").first(),
  ).toBeVisible();
});
test("hidden search result remains discoverable and neighborhood restores original filters", async ({
  page,
}) => {
  const n = graph.nodes.find((n) => n.rank === 1)!;
  const role = n.role === "transit" ? "terminal" : "transit";
  await page.goto(`/network?run=${run.run_id}&role=${role}`);
  await page
    .getByRole("combobox", { name: "Найти узел или кластер" })
    .fill(n.gid);
  await page.getByRole("option").filter({ hasText: n.gid }).click();
  await expect(
    page.getByText("Узел скрыт текущими фильтрами.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Показать узел и связи" }).click();
  await expect(page.getByLabel("Режим графа")).toHaveValue("neighborhood");
  await expect(page.locator(".mode-notice")).toContainText("Фильтры сохранены");
  await page
    .getByRole("button", { name: "Вернуться к исходным фильтрам" })
    .click();
  await expect(
    page.locator(".sidebar").getByLabel(roles[role].label, { exact: true }),
  ).toBeChecked();
});
test("all public routes and cluster membership", async ({ page }) => {
  for (const [path, title] of [
    ["overview", "Обзор анализа"],
    ["nodes", "Узлы сети"],
    ["clusters", "Кластеры сети"],
    ["reports", "Результаты анализа"],
    ["methodology", "Данные и методика"],
  ]) {
    await page.goto(`/${path}?run=${run.run_id}`);
    await expect(
      page.getByRole("heading", { level: 1, name: title, exact: true }),
    ).toBeVisible();
  }
  await page.goto(`/clusters/${graph.nodes[0].cluster_id}?run=${run.run_id}`);
  await expect(
    page.getByRole("button", { name: "Исследовать в сети" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Исследовать в сети" }).click();
  await expect(page.getByLabel("Режим графа")).toHaveValue("cluster");
});
test("three real exports and ZIP", async ({ page }) => {
  await page.goto(`/reports?run=${run.run_id}`);
  for (const name of ["nodes_roles.csv", "clusters.csv", "top_nodes.csv"]) {
    const wait = page.waitForEvent("download");
    await page.getByTitle(`Скачать ${name}`, { exact: true }).click();
    const file = await wait;
    expect(file.suggestedFilename()).toBe(name);
  }
  const wait = page.waitForEvent("download");
  await page.getByRole("button", { name: "Скачать пакет" }).click();
  expect((await wait).suggestedFilename()).toBe("results.zip");
});
test("AI outage preserves deterministic evidence and does not trigger calls on tab change", async ({
  page,
}) => {
  let calls = 0;
  await page.route("**/api/runs/*/ai", (route) => {
    calls++;
    return route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ message: "AI временно недоступен. Тест отказа." }),
    });
  });
  const n = graph.nodes.find((n) => n.rank === 1)!;
  await page.goto(`/network?run=${run.run_id}&gid=${n.gid}`);
  await page.getByRole("tab", { name: "AI", exact: true }).click();
  expect(calls).toBe(0);
  await page
    .getByRole("button", { name: "Объяснить роль", exact: true })
    .click();
  await expect(
    page.locator(".inspector-content").getByRole("alert"),
  ).toContainText("AI временно недоступен");
  expect(calls).toBe(1);
  await expect(
    page.getByRole("heading", { name: "Объяснение правил без LLM" }),
  ).toBeVisible();
  await expect(page.locator(".inspector-content")).toContainText(n.evidence);
});
test("isolated node and zero denominator", async ({ page, request }) => {
  const connected = new Set(graph.edges.flatMap((e) => [e.source, e.target]));
  const n = graph.nodes.find((n) => !connected.has(n.gid))!;
  await page.goto(`/network?run=${run.run_id}&gid=${n.gid}`);
  await expect(page.locator(".ratio")).toHaveText("Не определено");
  await page.getByRole("tab", { name: "Связи", exact: true }).click();
  await expect(
    page.getByText("Для этого узла в выгрузке нет связей."),
  ).toBeVisible();
});
test("settings keyboard focus and graph tab stability", async ({ page }) => {
  await page.goto(`/network?run=${run.run_id}`);
  await page.getByRole("button", { name: "Настройки графа" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Настройки графа" }),
  ).toBeFocused();
  await page.keyboard.press("ControlOrMeta+k");
  await expect(
    page.getByRole("combobox", { name: "Найти узел или кластер" }),
  ).toBeFocused();
});
test("impact compares surviving endpoints and restores original network", async ({
  page,
}) => {
  const n = graph.nodes.find((n) => n.rank === 3)!;
  await page.goto(`/network?run=${run.run_id}&gid=${n.gid}`);
  await page
    .getByRole("button", { name: "Влияние на сеть", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Реальные счета не блокируются");
  await dialog.getByRole("button", { name: "Запустить эксперимент" }).click();
  await expect(dialog.getByText("Достижимые пары до")).toBeVisible();
  await dialog.getByRole("button", { name: "После", exact: true }).click();
  await expect(dialog.locator(".section-heading")).toContainText(
    new Intl.NumberFormat("ru-RU").format(run.rows.nodes - 1),
  );
  await dialog
    .getByRole("button", { name: "Вернуться к исходной сети" })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".network-heading")).toContainText(
    new Intl.NumberFormat("ru-RU").format(run.rows.nodes),
  );
});
test("table page and sort survive profile navigation and browser back", async ({
  page,
}) => {
  await page.goto(`/nodes?run=${run.run_id}`);
  await page.getByLabel("Сортировка узлов").selectOption("gid");
  await page.getByRole("button", { name: "Следующая страница" }).click();
  await expect(page.locator(".pagination")).toContainText("26");
  const gid = await page.locator("tbody .gid.link").first().innerText();
  await page.locator("tbody .gid.link").first().click();
  await expect(
    page.getByRole("heading", { level: 1, name: gid, exact: true }),
  ).toBeVisible();
  await page.goBack();
  await expect(page.getByLabel("Сортировка узлов")).toHaveValue("gid");
  await expect(page.locator(".pagination")).toContainText("26");
});
test("late first-node response never replaces the selected second node", async ({
  page,
}) => {
  const first = graph.nodes.find((n) => n.rank === 1)!;
  const second = graph.nodes.find((n) => n.rank === 2)!;
  let release!: () => void;
  let requested!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const started = new Promise<void>((resolve) => (requested = resolve));
  await page.route(
    `**/api/runs/${run.run_id}/nodes/${first.gid}`,
    async (route) => {
      const response = await route.fetch();
      requested();
      await gate;
      await route.fulfill({ response });
    },
  );
  await page.goto(`/network?run=${run.run_id}&gid=${first.gid}`);
  await started;
  await page
    .getByRole("combobox", { name: "Найти узел или кластер" })
    .fill(second.gid);
  await page.getByRole("option").filter({ hasText: second.gid }).click();
  await expect(page.locator(".inspector-content")).toContainText(
    second.evidence,
  );
  release();
  await expect(page.locator(".inspector-header")).toContainText(second.gid);
  await expect(page.locator(".inspector-content")).not.toContainText(
    first.evidence,
  );
});
test("backend offline is explicit and does not display fabricated zero metrics", async ({
  page,
}) => {
  await page.route("**/api/**", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        code: "offline",
        message: "Нет соединения с локальным сервисом.",
        retryable: true,
        request_id: "test-offline",
      }),
    }),
  );
  await page.goto("/network");
  await expect(
    page.getByText("Нет соединения с локальным сервисом.", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".kpi")).toHaveCount(0);
  await expect(page.locator(".graph-canvas")).toHaveCount(0);
});
test("empty installation offers real file validation rather than a demo graph", async ({
  page,
}) => {
  await page.route("**/api/runs/current", (route) =>
    route.fulfill({
      json: {
        run_id: null,
        status: "empty",
        capabilities: run.capabilities,
        ai_status: "not_configured",
      },
    }),
  );
  await page.goto("/network");
  await expect(
    page.getByRole("heading", { name: "Данные ещё не обработаны" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Данные и проверка файлов" }).click();
  await page.getByRole("button", { name: "Проверить файлы" }).click();
  await expect(
    page.getByText("Проверены схема, значения и согласованность:", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(page.locator(".graph-canvas")).toHaveCount(0);
});
test("unknown node does not fall back to another client", async ({ page }) => {
  await page.goto(`/nodes/999?run=${run.run_id}`);
  await expect(
    page.getByRole("heading", { name: "Узел не найден в этом анализе" }),
  ).toBeVisible();
  await expect(page.locator(".graph-canvas")).toHaveCount(0);
  await page.getByRole("button", { name: "К списку узлов" }).click();
  await expect(
    page.getByRole("heading", { name: "Узлы сети", exact: true }),
  ).toBeVisible();
});
test("recompute retains old snapshot and atomically publishes the new run", async ({
  page,
}) => {
  let newRun = "";
  let release = false;
  await page.route("**/api/runs", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const response = await route.fetch();
    newRun = (await response.json()).run_id;
    await route.fulfill({ response });
  });
  await page.route(/\/api\/runs\/[^/]+$/, async (route) => {
    const id = route.request().url().split("/").pop();
    if (id === newRun && !release)
      return route.fulfill({
        json: { run_id: newRun, status: "running", stage: "Расчёт" },
      });
    return route.continue();
  });
  const n = graph.nodes.find((n) => n.rank === 1)!;
  await page.goto(`/network?run=${run.run_id}&gid=${n.gid}`);
  await expect(page.locator(".inspector-content")).toContainText(n.evidence);
  await page.getByRole("button", { name: "Пересчитать", exact: true }).click();
  await expect(
    page.getByText("Показаны результаты предыдущего анализа.", {
      exact: false,
    }),
  ).toBeVisible();
  expect(new URL(page.url()).searchParams.get("run")).toBe(run.run_id);
  await expect(page.locator(".inspector-header")).toContainText(n.gid);
  release = true;
  await expect
    .poll(() => new URL(page.url()).searchParams.get("run"))
    .toBe(newRun);
  await expect(
    page.getByRole("heading", { name: "Выберите узел", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".network-heading")).toContainText(
    new Intl.NumberFormat("ru-RU").format(run.rows.nodes),
  );
});
for (const width of [1920, 1512, 1280, 1024, 768, 390])
  test(`responsive ${width}, no document overflow`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.goto(`/network?run=${run.run_id}`);
    await expect(
      page.getByRole("heading", { name: "Транзакционная сеть", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    expect(
      await page
        .locator(".graph-legend button")
        .evaluateAll((buttons) =>
          buttons.every(
            (button) => button.scrollWidth <= button.clientWidth + 1,
          ),
        ),
    ).toBe(true);
    await page.screenshot({ path: `test-results/network-${width}.png` });
    if (width < 1280) {
      const n = graph.nodes.find((n) => n.rank === 1)!;
      await page
        .getByRole("combobox", { name: "Найти узел или кластер" })
        .fill(n.gid);
      await page.getByRole("option").filter({ hasText: n.gid }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await expect(page.locator(".inspector-header")).toContainText(n.gid);
    }
  });
