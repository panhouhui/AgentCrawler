import { Hono } from "hono";
import { z } from "zod";
import {
  KanPushConfigError,
  deleteKanPushRouteConfig,
  getKanPushOverview,
  saveKanPushRouteConfig,
} from "../../integrations/kan/config";
import { dispatchKanMessage } from "../../integrations/kan/client";

const dispatchSchema = z.object({
  platform: z.string().trim().optional(),
  routeId: z.string().trim().optional(),
  source: z.string().trim().optional(),
  message: z.string().trim().min(1, "推送消息不能为空"),
  channelIds: z.array(z.string().trim().min(1)).optional(),
  dedupeKey: z.string().trim().optional(),
  dryRun: z.boolean().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const routeMutationSchema = z.object({
  platform: z.string().trim().optional(),
  routeId: z.string().trim().optional(),
  baseUrl: z.string().trim().optional(),
  botToken: z.string().trim().optional(),
  channelIds: z.array(z.string().trim().min(1)).min(1, "至少需要一个 Kan 频道"),
});

type ErrorStatus = 400 | 404 | 500;

function errorStatus(status: number): ErrorStatus {
  if (status === 400 || status === 404 || status === 500) return status;
  return 500;
}

function kanConfigError(error: unknown): {
  readonly message: string;
  readonly status: ErrorStatus;
} {
  if (error instanceof KanPushConfigError) {
    return { message: error.message, status: errorStatus(error.status) };
  }
  return {
    message: error instanceof Error ? error.message : "Kan 推送配置保存失败",
    status: 500,
  };
}

export function createKanPushRoutes(): Hono {
  const app = new Hono();

  app.get("/kan-push/config", async (c) => {
    return c.json({ success: true, data: await getKanPushOverview() });
  });

  app.get("/kan-push/channels", async (c) => {
    return c.json({ success: true, data: (await getKanPushOverview()).channels });
  });

  app.post("/kan-push/routes", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ success: false, error: "请求体不是有效 JSON" }, 400);
    }

    const parsed = routeMutationSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { success: false, error: parsed.error.issues[0]?.message ?? "请求体无效" },
        400,
      );
    }

    try {
      const overview = await saveKanPushRouteConfig(parsed.data);
      return c.json({ success: true, data: overview });
    } catch (error) {
      const response = kanConfigError(error);
      return c.json({ success: false, error: response.message }, response.status);
    }
  });

  app.put("/kan-push/routes/:routeId", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ success: false, error: "请求体不是有效 JSON" }, 400);
    }

    const parsed = routeMutationSchema.safeParse({
      ...(typeof body === "object" && body ? body : {}),
      routeId: c.req.param("routeId"),
    });
    if (!parsed.success) {
      return c.json(
        { success: false, error: parsed.error.issues[0]?.message ?? "请求体无效" },
        400,
      );
    }

    try {
      const overview = await saveKanPushRouteConfig(parsed.data);
      return c.json({ success: true, data: overview });
    } catch (error) {
      const response = kanConfigError(error);
      return c.json({ success: false, error: response.message }, response.status);
    }
  });

  app.delete("/kan-push/routes/:routeId", async (c) => {
    try {
      const overview = await deleteKanPushRouteConfig(c.req.param("routeId"));
      return c.json({ success: true, data: overview });
    } catch (error) {
      const response = kanConfigError(error);
      return c.json({ success: false, error: response.message }, response.status);
    }
  });

  app.post("/kan-push/dispatch", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ success: false, error: "请求体不是有效 JSON" }, 400);
    }

    const parsed = dispatchSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { success: false, error: parsed.error.issues[0]?.message ?? "请求体无效" },
        400,
      );
    }

    try {
      const result = await dispatchKanMessage(parsed.data);
      return c.json({ success: true, data: result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ success: false, error: message }, 500);
    }
  });

  return app;
}
