import { mkdir } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { loadConfig } from "./config/loader";
import { loadMiniMaxModelEnv } from "./config/model-env";
import { bootstrap } from "./process/bootstrap";
import { getDb } from "./store/db";
import { createCoreClient, type CoreClient } from "./web/core-client";
import { createWebApp } from "./web/app";
import { resumeInterruptedRuns } from "./pipelines/resume";
import { reapStuckRuns } from "./pipelines/reaper";
import { createBookmarkProcessor } from "./sources/x/bookmarks/processor";
import { createAutolikeProcessor } from "./sources/x/interactions/processor";
import { createAutofollowProcessor } from "./sources/x/follow/processor";
import { createTimelineScrapeProcessor } from "./sources/x/timeline/processor";
import { createProcessSupervisor } from "./process/supervisor";
import { chat } from "./agent/chat";
import {
  addUserMessage,
  addAssistantMessage,
  getSessionHistory,
  clearSession,
} from "./agent/session";

import {
  createLogger,
  setLogLevel,
  setProcessName,
  startLogPersistence,
} from "./logger";
// @ts-ignore — Bun file import
import logoFile from "./web/agenthub-mark.png" with { type: "file" };
// @ts-ignore — Bun file import
import faviconFile from "./web/agenthub-mark.png" with { type: "file" };

const log = createLogger("web-main");
const ROOT_DIR = resolve(import.meta.dir, "..");
const UI_DIR = join(import.meta.dir, "web", "ui");
const WEB_ASSETS_DIR = join(ROOT_DIR, ".runtime", "web-assets");
let webAssetVersion = Date.now().toString(36);

async function buildWebBundle(): Promise<void> {
  await mkdir(WEB_ASSETS_DIR, { recursive: true });
  const result = await Bun.build({
    entrypoints: [join(UI_DIR, "app.tsx")],
    outdir: WEB_ASSETS_DIR,
    target: "browser",
    sourcemap: process.env.NODE_ENV === "production" ? "none" : "external",
  });

  if (!result.success) {
    const logs = result.logs.map((entry) => entry.message).join("\n");
    throw new Error(`Frontend bundle failed:\n${logs}`);
  }
  webAssetVersion = `${Date.now().toString(36)}-${Bun.hash(
    result.outputs.map((output) => output.path).join("|"),
  ).toString(36)}`;
}

function contentTypeFor(path: string): string {
  const ext = extname(path).toLowerCase();
  if (ext === ".js") return "application/javascript";
  if (ext === ".css") return "text/css";
  if (ext === ".map") return "application/json";
  if (ext === ".png") return "image/png";
  if (ext === ".ico") return "image/x-icon";
  if (ext === ".html") return "text/html";
  return "application/octet-stream";
}

function safeAssetPath(pathname: string): string | null {
  const base = resolve(WEB_ASSETS_DIR);
  const resolved = resolve(base, pathname.replace(/^\/+/, ""));
  if (resolved === base || resolved.startsWith(`${base}\\`)) return resolved;
  return null;
}

function webIndexHtml(): Response {
  return new Response(
    `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AgentHub</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">
  <script>(function(){var t=localStorage.getItem('agenthub-theme')||localStorage.getItem('opencrow-theme');if(t)document.documentElement.setAttribute('data-theme',t);})()</script>
  <link rel="icon" type="image/png" href="/favicon.ico?v=agenthub">
  <link rel="stylesheet" href="/tailwind-out.css?v=${webAssetVersion}">
  <link rel="stylesheet" href="/style.css?v=${webAssetVersion}">
  <link rel="stylesheet" href="/assets/app.css?v=${webAssetVersion}">
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/assets/app.js?v=${webAssetVersion}"></script>
</body>
</html>`,
    {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      },
    },
  );
}

function assetCacheControl(): string {
  return process.env.NODE_ENV === "production"
    ? "public, max-age=31536000, immutable"
    : "no-store";
}

async function main(): Promise<void> {
  loadMiniMaxModelEnv();
  const config = loadConfig();
  setProcessName("web");
  setLogLevel(config.logLevel);
  log.info("Starting AgentHub web process...");
  await buildWebBundle();
  log.info("Frontend bundle built", { outdir: WEB_ASSETS_DIR });

  // Bootstrap full agent capabilities (handles DB init, agent registry, tool registry, memory)
  const ctx = await bootstrap({
    config,
    processName: "web",
    dbPoolSize: 5,
  });
  startLogPersistence(getDb());

  // Create core client pointing to internal API
  const coreUrl = `http://${config.internalApi.host}:${config.internalApi.port}`;
  const coreClient: CoreClient = createCoreClient(coreUrl);

  // Check core health
  const healthy = await coreClient.isHealthy();
  if (healthy) {
    log.info("Core process is healthy", { url: coreUrl });
  } else {
    log.warn("Core process is not reachable — some features will be degraded", {
      url: coreUrl,
    });
  }

  // Cron store for CRUD — always available in web process (scheduler runs in cron process)
  const { createCronStore } = await import("./cron/store");
  const cronStore = createCronStore();

  // X processors for direct use (not started — no timer ticks).
  const bookmarkProcessor = createBookmarkProcessor();
  const autolikeProcessor = createAutolikeProcessor();
  const autofollowProcessor = createAutofollowProcessor();
  const timelineScrapeProcessor = createTimelineScrapeProcessor({
    memoryManager: ctx.memoryManager ?? undefined,
  });

  const mergedConfig = ctx.config;

  // Use the workflow tool registry which includes ALL enabled scraper tools
  // without agent-specific tool filters that would exclude some tools.
  const fullToolRegistry = ctx.workflowToolRegistry ?? ctx.baseToolRegistry;

  const webApp = createWebApp({
    config: mergedConfig,
    channels: new Map(),
    getDefaultAgentOptions: async () => {
      const agent = ctx.agentRegistry.getDefault();
      return ctx.buildOptionsForAgent(agent);
    },
    agentRegistry: ctx.agentRegistry,
    toolRegistry: fullToolRegistry ?? undefined,
    buildAgentOptions: ctx.buildOptionsForAgent,
    cronStore,
    memoryManager: ctx.memoryManager ?? undefined,
    coreClient,
    bookmarkProcessor,
    autolikeProcessor,
    autofollowProcessor,
    timelineScrapeProcessor,
  });

  // Resume any pipeline runs interrupted by a process restart (deploy). Runs
  // stuck as 'running' are re-dispatched from their last completed step; runs
  // that exhausted their resume budget are failed.
  resumeInterruptedRuns(ctx.memoryManager ?? undefined)
    .then(({ resumed, failed, skipped }) => {
      if (resumed > 0 || failed > 0 || skipped > 0) {
        log.info("Processed interrupted pipeline runs", {
          resumed,
          failed,
          skipped,
        });
      }
    })
    .catch(() => {});

  // Periodic reaper: fail stuck pipeline runs (running, no heartbeat, no executor).
  // Runs every 60s — generous enough to not interfere with slow-but-alive steps.
  setInterval(() => {
    reapStuckRuns()
      .then(({ reaped }) => {
        if (reaped > 0) {
          log.info("Reaper: reaped stuck pipeline runs", { reaped });
        }
      })
      .catch((err) => {
        log.warn("Reaper sweep failed", { err });
      });
  }, 60_000);

  // Periodic agent reload — skip if config unchanged
  let lastConfigHash = "";
  setInterval(async () => {
    try {
      const { loadConfigWithOverrides } = await import("./config/loader");
      const fresh = await loadConfigWithOverrides();
      const hash = Bun.hash(JSON.stringify(fresh)).toString(36);
      if (hash === lastConfigHash) return;
      lastConfigHash = hash;
      ctx.agentRegistry.reload(fresh.agents, fresh.agent);
      log.info("Config reloaded (changed)", { hash });
    } catch (err) {
      log.error("Web agent reload failed (non-fatal)", { error: err });
    }
  }, 30_000);

  type WsData =
    | { kind: "system"; id: number }
    | { kind: "chat"; chatId: string };

  let systemWsNextId = 0;
  const systemWsClients = new Set<import("bun").ServerWebSocket<WsData>>();

  // FAIL-CLOSED auth for the raw Bun.serve routes (/ws/* and /internal/restart).
  // The Hono /api/* surface enforces this in src/web/app.ts, but these handlers
  // bypass Hono. Resolve the token from DB secrets first, then env (mirroring
  // src/web/app.ts) so DB rotations take effect without a restart. When no token
  // is configured we reject — these endpoints must never be unauthenticated.
  // Returns a Response when the request must be rejected, or null when authorized.
  async function checkWebTokenAuth(req: Request): Promise<Response | null> {
    const { getSecret } = await import("./config/secrets");
    let expectedToken: string | undefined;
    try {
      expectedToken = await getSecret("OPENCROW_WEB_TOKEN");
    } catch (err) {
      log.error("Failed to resolve web token — failing closed", { error: err });
      return new Response("Auth unavailable", { status: 503 });
    }
    if (!expectedToken) {
      log.error("Request rejected — OPENCROW_WEB_TOKEN not configured (fail-closed)", {
        path: new URL(req.url).pathname,
      });
      return new Response("Web API not configured", { status: 503 });
    }
    const protocol = req.headers.get("sec-websocket-protocol");
    const authHeader = req.headers.get("authorization");
    const bearerToken = authHeader?.startsWith("Bearer ")
      ? authHeader.slice(7)
      : null;
    const providedToken = protocol ?? bearerToken;
    if (providedToken !== expectedToken) {
      return new Response("Unauthorized", { status: 401 });
    }
    return null;
  }

  Bun.serve<WsData>({
    port: config.web.port,
    hostname: config.web.host,
    idleTimeout: 120,
    // reusePort intentionally OFF. With SO_REUSEPORT, a stale/orphaned web child
    // (e.g. one that outlived a SIGKILLed core) keeps binding the same port and
    // the kernel round-robins connections across live AND zombie listeners —
    // silently splitting traffic and hanging requests. With it off, a second
    // binder fails loudly with EADDRINUSE, so the new child crashes and the
    // supervisor's restart/backoff surfaces the conflict instead of hiding it.
    // The parent-death watchdog (src/process/parent-watchdog.ts) reaps the stale
    // child within a few seconds, after which the restart succeeds. Orchestrator
    // restarts are sequential (killChild awaits exit before re-spawn), so there
    // is no intentional zero-downtime overlap that relied on reusePort.
    reusePort: false,
    development:
      process.env.NODE_ENV === "production"
        ? false
        : { hmr: true, console: true },
    routes: {
      "/logo.png": new Response(Bun.file(logoFile), {
        headers: {
          "Content-Type": "image/png",
          "Cache-Control": "public, max-age=86400",
        },
      }),
      "/favicon.ico": new Response(Bun.file(faviconFile), {
        headers: {
          "Content-Type": "image/png",
          "Cache-Control": "public, max-age=60",
        },
      }),
    },
    async fetch(req, bunServer) {
      const url = new URL(req.url);

      if (url.pathname === "/" || url.pathname === "/index.html") {
        return webIndexHtml();
      }

      // Serve CSS files dynamically (tailwind-out.css is a build artifact)
      if (url.pathname === "/tailwind-out.css" || url.pathname === "/style.css") {
        const cssPath = import.meta.dir + "/web/ui" + url.pathname;
        return new Response(Bun.file(cssPath), {
          headers: {
            "Content-Type": "text/css",
            "Cache-Control": "public, max-age=60",
          },
        });
      }

      if (url.pathname.startsWith("/assets/")) {
        const assetPath = safeAssetPath(url.pathname.slice("/assets/".length));
        if (!assetPath) return new Response("Invalid asset path", { status: 400 });
        return new Response(Bun.file(assetPath), {
          headers: {
            "Content-Type": contentTypeFor(assetPath),
            "Cache-Control": assetCacheControl(),
          },
        });
      }

      // WebSocket system events feed — real-time dashboard updates
      if (url.pathname === "/ws/system") {
        const unauthorized = await checkWebTokenAuth(req);
        if (unauthorized) return unauthorized;
        const upgraded = bunServer.upgrade(req, {
          data: { kind: "system" as const, id: systemWsNextId++ },
        });
        if (upgraded) return undefined as unknown as Response;
        return new Response("WebSocket upgrade failed", { status: 400 });
      }

      // WebSocket chat — local agent execution with progress streaming
      if (url.pathname === "/ws/chat") {
        const unauthorized = await checkWebTokenAuth(req);
        if (unauthorized) return unauthorized;
        const upgraded = bunServer.upgrade(req, {
          data: { kind: "chat" as const, chatId: "web-default" },
        });
        if (upgraded) return undefined as unknown as Response;
        return new Response("WebSocket upgrade failed", { status: 400 });
      }

      // Internal restart endpoint — web process restarts itself
      if (url.pathname === "/internal/restart" && req.method === "POST") {
        const unauthorized = await checkWebTokenAuth(req);
        if (unauthorized) return unauthorized;
        log.info("Restart requested via /internal/restart");
        setTimeout(() => process.exit(0), 100);
        return new Response(JSON.stringify({ ok: true }), {
          headers: { "Content-Type": "application/json" },
        });
      }

      return webApp.fetch(req);
    },
    websocket: {
      open(ws) {
        if (ws.data.kind === "system") {
          systemWsClients.add(ws);
          log.debug("System WS client connected", { clients: systemWsClients.size });
          return;
        }
        if (ws.data.kind === "chat") {
          log.debug("Chat WS client connected");
          return;
        }
      },
      message(ws, msg) {
        if (ws.data.kind === "chat") {
          handleChatMessage(ws as import("bun").ServerWebSocket<{ kind: "chat"; chatId: string }>, msg);
          return;
        }
      },
      close(ws) {
        if (ws.data.kind === "system") {
          systemWsClients.delete(ws);
          log.debug("System WS client disconnected", { clients: systemWsClients.size });
          return;
        }
        if (ws.data.kind === "chat") {
          log.debug("Chat WS client disconnected");
          return;
        }
      },
    },
  });

  function safeSend(
    ws: import("bun").ServerWebSocket<WsData>,
    payload: unknown,
  ): void {
    try {
      ws.send(JSON.stringify(payload));
    } catch {
      // Client already disconnected
    }
  }

  function handleChatMessage(
    ws: import("bun").ServerWebSocket<{ kind: "chat"; chatId: string }>,
    msg: string | Buffer,
  ): void {
    const raw = typeof msg === "string" ? msg : new TextDecoder().decode(msg);

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      safeSend(ws, { type: "error", message: "Invalid JSON" });
      return;
    }

    if (parsed["type"] === "clear") {
      const chatId = (parsed["chatId"] as string | undefined) ?? ws.data.chatId;
      clearSession("web", chatId)
        .then(() => safeSend(ws, { type: "cleared" }))
        .catch((err) => safeSend(ws, { type: "error", message: String(err) }));
      return;
    }

    if (parsed["type"] === "message") {
      const text = parsed["text"] as string | undefined;
      if (!text?.trim()) {
        safeSend(ws, { type: "error", message: "Empty message" });
        return;
      }

      const chatId = (parsed["chatId"] as string | undefined) ?? ws.data.chatId;
      const agentId = parsed["agentId"] as string | undefined;

      processChatMessage(ws, chatId, text, agentId).catch((err) => {
        log.error("Chat WS message processing failed", { error: err });
        safeSend(ws, { type: "error", message: String(err) });
      });
    }
  }

  async function processChatMessage(
    ws: import("bun").ServerWebSocket<WsData>,
    chatId: string,
    text: string,
    agentId: string | undefined,
  ): Promise<void> {
    await addUserMessage("web", chatId, "web-user", text);
    const history = await getSessionHistory("web", chatId);

    const agent = agentId
      ? (ctx.agentRegistry.getById(agentId) ?? ctx.agentRegistry.getDefault())
      : ctx.agentRegistry.getDefault();

    const agentOptions = await ctx.buildOptionsForAgent(agent, (event) => {
      safeSend(ws, event);
    });

    const response = await chat(history, {
      ...agentOptions,
      usageContext: { channel: "web", chatId, source: "web" as const },
    });

    await addAssistantMessage("web", chatId, response.text);

    safeSend(ws, {
      type: "response",
      text: response.text,
      usage: response.usage,
      toolUseCount: response.toolUseCount,
    });
  }

  log.info(`AgentHub web: http://${config.web.host}:${config.web.port}`);

  // Broadcast system status to WS clients (replaces per-client HTTP polling)
  let lastStatusJson = "";
  setInterval(async () => {
    if (systemWsClients.size === 0) return;
    try {
      // /api/status is now fail-closed: resolve the token from DB secrets or env
      // so this internal self-fetch authenticates even when the token lives only
      // in the DB.
      const { getSecret } = await import("./config/secrets");
      const statusToken = await getSecret("OPENCROW_WEB_TOKEN");
      const res = await webApp.fetch(
        new Request(`http://localhost:${config.web.port}/api/status`, {
          headers: statusToken
            ? { Authorization: `Bearer ${statusToken}` }
            : {},
        }),
      );
      const body = await res.json() as Record<string, unknown>;
      const json = JSON.stringify(body);
      if (json === lastStatusJson) return;
      lastStatusJson = json;
      const event = JSON.stringify({ type: "status", data: body, ts: Date.now() });
      for (const ws of systemWsClients) {
        try { ws.send(event); } catch { systemWsClients.delete(ws); }
      }
    } catch {
      // Status fetch failed — skip this tick
    }
  }, 5_000);

  const supervisor = createProcessSupervisor("web", {
    type: "web",
    port: config.web.port,
  });
  await supervisor.start();

  // NOTE: supervisor.start() already registers SIGTERM/SIGINT handlers that
  // call unregisterProcess + process.exit(0). We must NOT register our own
  // competing handlers — they race with the supervisor's DB unregister and
  // can close the DB connection before the unregister completes, leaving
  // stale PIDs in the registry and causing crash loops.
  // Instead, server.stop() is best-effort on exit. The DB pool auto-closes.

  process.on("unhandledRejection", (reason: unknown) => {
    log.error("Unhandled promise rejection (non-fatal)", { error: reason });
  });

  process.on("uncaughtException", (error: Error) => {
    log.error("Uncaught exception — exiting", {
      error: error.message,
      stack: error.stack,
    });
    process.exit(1);
  });
}

main().catch((err) => {
  log.error("Failed to start AgentHub web", err);
  process.exit(1);
});
