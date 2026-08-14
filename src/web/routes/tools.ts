import { Hono } from "hono";
import { z } from "zod";
import {
  buildToolCatalog,
  CATEGORY_LABELS,
} from "../../tools/catalog";
import { getOverride, setOverride } from "../../store/config-overrides";

const NAMESPACE = "tools";
const HIDDEN_LEGACY_SOURCE_CATEGORIES = new Set([
  "product_hunt",
  "hacker_news",
  "reddit",
  "appstore",
  "playstore",
  "x_timeline",
  "github",
]);

function visibleCatalog() {
  return buildToolCatalog().filter(
    (entry) => !HIDDEN_LEGACY_SOURCE_CATEGORIES.has(entry.category),
  );
}

function visibleCategoryLabels(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(CATEGORY_LABELS).filter(
      ([category]) => !HIDDEN_LEGACY_SOURCE_CATEGORIES.has(category),
    ),
  );
}

async function getDisabledTools(): Promise<readonly string[]> {
  const disabled = await Promise.race([
    getOverride(NAMESPACE, "disabledTools"),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500)),
  ]).catch(() => null);
  return Array.isArray(disabled) ? disabled.filter((name) => typeof name === "string") : [];
}

const updateDisabledSchema = z.object({
  disabled: z.array(z.string()),
});

export function createToolsRoutes(): Hono {
  const app = new Hono();

  app.get("/tools", async (c) => {
    const catalog = visibleCatalog();
    const disabledTools = await getDisabledTools();
    const filtered = catalog.map((entry) => ({
      ...entry,
      enabled: !disabledTools.includes(entry.name),
    }));
    return c.json({
      success: true,
      data: filtered,
      categories: visibleCategoryLabels(),
      disabledTools,
    });
  });

  app.put("/tools/disabled", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ success: false, error: "请求体不是有效 JSON" }, 400);
    }

    const parsed = updateDisabledSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { success: false, error: parsed.error.issues[0]?.message ?? "请求内容无效" },
        400,
      );
    }

    try {
      await setOverride(NAMESPACE, "disabledTools", parsed.data.disabled);
      return c.json({ success: true, data: { disabled: parsed.data.disabled } });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ success: false, error: message }, 500);
    }
  });

  return app;
}
