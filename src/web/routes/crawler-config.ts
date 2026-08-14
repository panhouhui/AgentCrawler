import { Hono } from "hono";
import { z } from "zod";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CrawlerConfigError,
  clearCrawlerConfigField,
  getCrawlerConfigField,
  getCrawlerConfigOverview,
  getCrawlerPlatformConfig,
  setCrawlerConfigField,
  setCrawlerPlatformConfig,
} from "../../integrations/crawlers/config";
import { getAgentHubRoot } from "../../config/agenthub-root";

const AGENT_HUB_ROOT = getAgentHubRoot();
const CRAWLER_ENV_ROOT =
  process.env.CRAWLER_ENV_ROOT ?? join(AGENT_HUB_ROOT, "env", "Crawler_env");
const PYTHON = process.env.AGENTHUB_PYTHON ?? "python";

interface TelegramDialogInfo {
  readonly id: string;
  readonly title: string;
  readonly username: string;
  readonly type: string;
}

const fieldValueSchema = z
  .object({
    value: z.string().max(50_000, "配置内容过长"),
  })
  .strict();

const platformFieldsSchema = z
  .object({
    fields: z.record(z.string(), z.string().max(50_000, "配置内容过长")),
  })
  .strict();

type ErrorStatus = 400 | 404 | 500;

function errorStatus(status: number): ErrorStatus {
  if (status === 400 || status === 404 || status === 500) return status;
  return 500;
}

function crawlerErrorResponse(error: unknown): {
  readonly message: string;
  readonly status: ErrorStatus;
} {
  if (error instanceof CrawlerConfigError) {
    return { message: error.message, status: errorStatus(error.status) };
  }
  return {
    message: error instanceof Error ? error.message : "爬虫配置保存失败",
    status: 500,
  };
}

function readTelegramDialogIds(): string[] {
  try {
    const text = readFileSync(join(CRAWLER_ENV_ROOT, "Telegram_env"), "utf-8");
    const match = /^TELEGRAM_PUSH_DIALOGS=(.*)$/m.exec(text);
    if (!match) return [];
    return (match[1] ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function redactLocalPaths(message: string): string {
  return message
    .replaceAll(AGENT_HUB_ROOT, "<AgentHub>")
    .replace(/[A-Za-z]:\\[^\r\n"]+/g, "<本地路径>");
}

async function fetchTelegramDialogs(): Promise<TelegramDialogInfo[]> {
  const proc = Bun.spawn(
    [
      PYTHON,
      "-X",
      "utf8",
      "telegram_ai_tool.py",
      "list_dialogs",
      "--env",
      join(CRAWLER_ENV_ROOT, "Telegram_env"),
    ],
    {
      cwd: join(AGENT_HUB_ROOT, "Crawler", "Telegram"),
      stdout: "pipe",
      stderr: "pipe",
      windowsHide: true,
    },
  );
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, 30_000);
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]).finally(() => clearTimeout(timer));
  if (timedOut) {
    throw new Error("获取 Telegram 会话超时，请稍后重试");
  }
  if (exitCode !== 0) {
    throw new Error(
      redactLocalPaths(stderr.trim() || stdout.trim() || "获取 Telegram 会话失败"),
    );
  }
  const parsed = JSON.parse(stdout) as {
    ok?: boolean;
    dialogs?: TelegramDialogInfo[];
  };
  if (!parsed.ok || !Array.isArray(parsed.dialogs)) {
    throw new Error("Telegram 会话响应格式非法");
  }
  return parsed.dialogs;
}

export function createCrawlerConfigRoutes(): Hono {
  const app = new Hono();

  app.get("/crawler-config", (c) => {
    return c.json({ success: true, data: getCrawlerConfigOverview() });
  });

  app.get("/crawler-config/telegram/dialogs", async (c) => {
    try {
      const dialogs = await fetchTelegramDialogs();
      return c.json({
        success: true,
        data: {
          dialogs,
          selectedIds: readTelegramDialogIds(),
        },
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "获取 Telegram 会话失败";
      return c.json({ success: false, error: redactLocalPaths(message) }, 500);
    }
  });

  app.get("/crawler-config/:platformId/fields/:fieldId", (c) => {
    try {
      const field = getCrawlerConfigField(
        c.req.param("platformId"),
        c.req.param("fieldId"),
      );
      return c.json({ success: true, data: field });
    } catch (error) {
      const response = crawlerErrorResponse(error);
      return c.json({ success: false, error: response.message }, response.status);
    }
  });

  app.post("/crawler-config/:platformId/fields/:fieldId", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ success: false, error: "请求体不是合法 JSON" }, 400);
    }

    const parsed = fieldValueSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ success: false, error: parsed.error.message }, 400);
    }

    try {
      const platform = setCrawlerConfigField(
        c.req.param("platformId"),
        c.req.param("fieldId"),
        parsed.data.value,
      );
      return c.json({ success: true, data: platform });
    } catch (error) {
      const response = crawlerErrorResponse(error);
      return c.json({ success: false, error: response.message }, response.status);
    }
  });

  app.put("/crawler-config/:platformId/fields/:fieldId", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ success: false, error: "请求体不是合法 JSON" }, 400);
    }

    const parsed = fieldValueSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ success: false, error: parsed.error.message }, 400);
    }

    try {
      const platform = setCrawlerConfigField(
        c.req.param("platformId"),
        c.req.param("fieldId"),
        parsed.data.value,
      );
      return c.json({ success: true, data: platform });
    } catch (error) {
      const response = crawlerErrorResponse(error);
      return c.json({ success: false, error: response.message }, response.status);
    }
  });

  app.delete("/crawler-config/:platformId/fields/:fieldId", (c) => {
    try {
      const platform = clearCrawlerConfigField(
        c.req.param("platformId"),
        c.req.param("fieldId"),
      );
      return c.json({ success: true, data: platform });
    } catch (error) {
      const response = crawlerErrorResponse(error);
      return c.json({ success: false, error: response.message }, response.status);
    }
  });

  app.put("/crawler-config/:platformId", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ success: false, error: "请求体不是合法 JSON" }, 400);
    }

    const parsed = platformFieldsSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ success: false, error: parsed.error.message }, 400);
    }

    try {
      const platform = setCrawlerPlatformConfig(
        c.req.param("platformId"),
        parsed.data.fields,
      );
      return c.json({ success: true, data: platform });
    } catch (error) {
      const response = crawlerErrorResponse(error);
      return c.json({ success: false, error: response.message }, response.status);
    }
  });

  app.get("/crawler-config/:platformId", (c) => {
    const platform = getCrawlerPlatformConfig(c.req.param("platformId"));
    if (!platform) {
      return c.json({ success: false, error: "爬虫平台不存在" }, 404);
    }
    return c.json({ success: true, data: platform });
  });

  return app;
}
