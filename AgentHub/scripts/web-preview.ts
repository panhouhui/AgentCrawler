import { createServer } from "node:net";
import { dirname, extname, join, resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { AGENT_SEEDS } from "../src/config/agent-seeds";
import type { AgentDefinition, ResolvedAgent } from "../src/agents/types";
import {
  MODEL_ROUTING_DEFAULTS,
  MODEL_ROUTING_KEYS,
  isModelRoutingKey,
  type ModelRoute,
  type ModelRoutingKey,
} from "../src/store/model-routing";
import { chat as chatMiniMaxDirect } from "../src/agent/minimax-direct";
import { runSocialPipeline } from "../src/pipelines/social/pipeline";
import { dispatchKanMessage } from "../src/integrations/kan/client";
import {
  KanPushConfigError,
  deleteKanPushRouteConfig,
  getKanPushOverview,
  saveKanPushRouteConfig,
} from "../src/integrations/kan/config";
import {
  CrawlerConfigError,
  clearCrawlerConfigField,
  getCrawlerConfigField,
  getCrawlerConfigOverview,
  getCrawlerPlatformConfig,
  setCrawlerConfigField,
  setCrawlerPlatformConfig,
} from "../src/integrations/crawlers/config";
import { loadMiniMaxModelEnv } from "../src/config/model-env";
import type {
  LightweightSocialSignal,
  SocialAgentRunner,
} from "../src/pipelines/social/types";

const ROOT = resolve(import.meta.dir, "..");
const UI_DIR = join(ROOT, "src", "web", "ui");
const PREVIEW_DIR = join(ROOT, ".preview");
const ASSETS_DIR = join(PREVIEW_DIR, "assets");
const DEFAULT_PORT = 48080;

const DEFAULT_TOOL_FILTER = { mode: "allowlist" as const, tools: [] };
const DEFAULT_SUBAGENTS = { allowAgents: [], maxChildren: 5 };
const DEFAULT_MODEL = "claude-sonnet-4-6";
const DEFAULT_SYSTEM_PROMPT =
  "你是 AgentHub 的社交情报智能体，请保持简洁、直接、可执行。";

const modelRoutes = new Map<ModelRoutingKey, ModelRoute>(
  MODEL_ROUTING_KEYS.map((key) => [key, MODEL_ROUTING_DEFAULTS[key]]),
);

function resolveAgent(def: AgentDefinition): ResolvedAgent {
  return {
    id: def.id,
    name: def.name,
    description: def.description ?? "",
    default: def.default ?? false,
    provider: def.provider ?? "anthropic",
    model: def.model ?? DEFAULT_MODEL,
    systemPrompt: def.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
    maxIterations: def.maxIterations,
    modelParams: def.modelParams,
    reasoning: def.reasoning,
    stateless: def.stateless,
    maxInputLength: def.maxInputLength,
    maxHistoryMessages: def.maxHistoryMessages,
    maxOutputTokens: def.maxOutputTokens,
    keepAssistantMessages: def.keepAssistantMessages,
    toolFilter: def.toolFilter ?? DEFAULT_TOOL_FILTER,
    subagents: def.subagents
      ? { ...DEFAULT_SUBAGENTS, ...def.subagents }
      : DEFAULT_SUBAGENTS,
    mcpServers: def.mcpServers ?? {},
    hooks: def.hooks,
    telegramBotToken: def.telegramBotToken,
    skills: def.skills ?? [],
    category: def.category ?? "research",
  };
}

const agents = AGENT_SEEDS.map(resolveAgent);
const agentById = new Map(agents.map((agent) => [agent.id, agent]));
const configHash = Bun.hash(JSON.stringify(agents)).toString(36);
const startedAt = Date.now();

interface PreviewSkill {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly content: string;
}

const previewSkills: PreviewSkill[] = [];
const previewSecrets = new Map<string, string>();
const disabledTools = new Set<string>();

interface PreviewRoutingRule {
  readonly id: string;
  readonly channel: string;
  readonly matchType: string;
  readonly matchValue: string;
  readonly agentId: string;
  readonly priority: number;
  readonly enabled: boolean;
  readonly notes: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

interface PreviewWorkflowRecord {
  readonly id: string;
  name: string;
  description: string;
  enabled: boolean;
  nodes: unknown[];
  edges: unknown[];
  viewport?: { readonly x: number; readonly y: number; readonly zoom: number };
  readonly createdAt: string;
  updatedAt: string;
}

interface PreviewWorkflowExecution {
  readonly id: string;
  readonly workflowId: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  error?: string;
  result?: unknown;
  startedAt?: number | null;
  finishedAt?: number | null;
  readonly createdAt: number;
  steps: Array<{
    readonly nodeId: string;
    status: "pending" | "running" | "completed" | "failed" | "skipped";
    output?: unknown;
    error?: string;
  }>;
}

const previewRoutingRules: PreviewRoutingRule[] = [];
const previewWorkflows: PreviewWorkflowRecord[] = [];
const previewWorkflowExecutions = new Map<string, PreviewWorkflowExecution>();

function previewHnStories(): readonly Record<string, unknown>[] {
  const now = Math.floor(Date.now() / 1000);
  return [
    {
      id: "hn-preview-1",
      rank: 1,
      title: "开源智能体项目正在重新组合爬虫与信息发现流程",
      url: "https://news.ycombinator.com/item?id=preview-1",
      site_label: "news.ycombinator.com",
      points: 428,
      author: "预览用户",
      age: "12 分钟前",
      comment_count: 86,
      hn_url: "https://news.ycombinator.com/item?id=preview-1",
      feed_type: "top",
      first_seen_at: now - 720,
      updated_at: now,
      description:
        "预览服务返回的样例内容，用于验证新闻预览接口已接入。",
      top_comments_json: JSON.stringify([
        "这个样例用于确认前端接口已经接通，不代表真实 HN 抓取结果。",
        "正式环境需要接入数据库和实际 Hacker News 爬虫进程。",
      ]),
    },
    {
      id: "hn-preview-2",
      rank: 2,
      title: "跨平台社交传播分析需要先做相关性过滤",
      url: "https://news.ycombinator.com/item?id=preview-2",
      site_label: "news.ycombinator.com",
      points: 196,
      author: "智能体运营",
      age: "28 分钟前",
      comment_count: 34,
      hn_url: "https://news.ycombinator.com/item?id=preview-2",
      feed_type: "top",
      first_seen_at: now - 1680,
      updated_at: now,
      description:
        "这里展示的是当前预览服务的模拟数据，避免页面在无数据库时进入失败态。",
      top_comments_json: JSON.stringify([
        "先用中国相关性判断智能体过滤，再让各平台智能体深挖，能降低噪声。",
      ]),
    },
  ];
}

function maskSecret(value: string | undefined): string | null {
  if (!value) return null;
  if (value.length <= 8) return "********";
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

async function buildFrontend(): Promise<void> {
  await mkdir(ASSETS_DIR, { recursive: true });
  const result = await Bun.build({
    entrypoints: [join(UI_DIR, "app.tsx")],
    outdir: ASSETS_DIR,
    target: "browser",
    sourcemap: "external",
  });
  if (!result.success) {
    const logs = result.logs.map((log) => log.message).join("\n");
    throw new Error(`Frontend bundle failed:\n${logs}`);
  }
}

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolveFree) => {
    const probe = createServer();
    probe.once("error", () => resolveFree(false));
    probe.once("listening", () => {
      probe.close(() => resolveFree(true));
    });
    probe.listen(port, "127.0.0.1");
  });
}

async function pickPort(start: number): Promise<number> {
  for (let port = start; port < start + 50; port++) {
    if (await isPortFree(port)) return port;
  }
  throw new Error(`No free port found in ${start}-${start + 49}`);
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function text(data: string, status = 200, contentType = "text/plain"): Response {
  return new Response(data, {
    status,
    headers: { "Content-Type": `${contentType}; charset=utf-8` },
  });
}

function fileResponse(path: string, contentType?: string): Response {
  const headers: Record<string, string> = {
    "Cache-Control": "no-store",
  };
  if (contentType) headers["Content-Type"] = contentType;
  return new Response(Bun.file(path), { headers });
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

function indexHtml(): Response {
  return text(
    `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AgentHub 预览</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">
  <script>(function(){var t=localStorage.getItem('agenthub-theme')||localStorage.getItem('opencrow-theme');if(t)document.documentElement.setAttribute('data-theme',t);})()</script>
  <link rel="stylesheet" href="/tailwind-out.css">
  <link rel="stylesheet" href="/style.css">
  <link rel="stylesheet" href="/assets/app.css">
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/assets/app.js"></script>
</body>
</html>`,
    200,
    "text/html",
  );
}

function agentListItem(agent: ResolvedAgent): Record<string, unknown> {
  return {
    id: agent.id,
    name: agent.name,
    description: agent.description,
    provider: agent.provider,
    model: agent.model,
    maxIterations: agent.maxIterations,
    isDefault: agent.default,
    toolFilter: agent.toolFilter,
    subagents: agent.subagents,
    reasoning: agent.reasoning,
    stateless: agent.stateless,
    maxInputLength: agent.maxInputLength,
    modelParams: agent.modelParams,
    mcpServers: agent.mcpServers,
    hooks: agent.hooks,
    skills: agent.skills,
    source: "file",
  };
}

function agentDetail(agent: ResolvedAgent): Record<string, unknown> {
  return {
    ...agentListItem(agent),
    systemPrompt: agent.systemPrompt,
  };
}

function skillListItem(skill: PreviewSkill): Record<string, unknown> {
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
  };
}

function skillDetail(skill: PreviewSkill): Record<string, unknown> {
  return {
    ...skillListItem(skill),
    content: skill.content,
    body: skill.content,
  };
}

function epochNow(): number {
  return Math.floor(Date.now() / 1000);
}

function previewTools(): readonly Record<string, unknown>[] {
  const tools = [
    {
      name: "social_gate",
      category: "social",
      description: "深度爬取前判断线索是否与中国相关。",
      params: ["platform", "title", "summary", "evidence"],
      inputSchema: {
        type: "object",
        properties: {
          platform: { type: "string", description: "来源平台" },
          title: { type: "string", description: "事件标题" },
          summary: { type: "string", description: "初步摘要" },
          evidence: {
            type: "string",
            description: "原始证据、链接或样例文本",
          },
        },
        required: ["platform", "title", "summary"],
      },
    },
    {
      name: "social_platform_report",
      category: "social",
      description: "让指定平台智能体返回固定格式的发现或未发现报告。",
      params: ["platform", "event", "china_relevance", "metrics"],
      inputSchema: {
        type: "object",
        properties: {
          platform: { type: "string", description: "x / telegram / lihkg / facebook" },
          event: { type: "string", description: "需要复核的事件" },
          china_relevance: { type: "string", description: "中国相关性判断结果" },
          metrics: { type: "string", description: "平台侧观测指标" },
        },
        required: ["platform", "event"],
      },
    },
    {
      name: "social_fusion",
      category: "social",
      description: "聚合多个平台智能体的报告，判断是否为同一事件并生成传播路径。",
      params: ["platform_reports"],
      inputSchema: {
        type: "object",
        properties: {
          platform_reports: {
            type: "string",
            description: "各平台智能体的结构化报告 JSON",
          },
        },
        required: ["platform_reports"],
      },
    },
    {
      name: "crawler_probe",
      category: "crawler",
      description: "调用现有爬虫脚本做自主发现或候选事件复核。",
      params: ["crawler", "phase", "eventTitle", "limit"],
      inputSchema: {
        type: "object",
        properties: {
          crawler: { type: "string", description: "爬虫平台标识" },
          phase: { type: "string", description: "discover 或 search" },
          eventTitle: { type: "string", description: "候选事件标题，search 阶段使用" },
          limit: { type: "integer", description: "最多返回条数" },
        },
        required: ["crawler", "phase"],
      },
    },
  ];

  return tools.map((tool) => ({
    ...tool,
    enabled: !disabledTools.has(tool.name),
  }));
}

function previewChannelEntries(): readonly Record<string, unknown>[] {
  return [
    {
      id: "telegram",
      meta: { id: "telegram", label: "Telegram 渠道", icon: "TG", order: 1 },
      capabilities: { media: true, groups: true },
      snapshot: {
        enabled: true,
        configured: true,
        connected: true,
        allowedUserIds: [],
      },
    },
    {
      id: "whatsapp",
      meta: { id: "whatsapp", label: "WhatsApp 渠道", icon: "WA", order: 2 },
      capabilities: { media: true, groups: true },
      snapshot: {
        enabled: false,
        configured: false,
        connected: false,
        pairingState: "disconnected",
        allowedNumbers: [],
        allowedGroups: [],
      },
    },
    {
      id: "social-fusion",
      meta: { id: "social-fusion", label: "社交融合总控", icon: "社", order: 3 },
      capabilities: { media: false, groups: true },
      snapshot: {
        enabled: true,
        configured: true,
        connected: true,
        mode: "preview",
      },
    },
  ];
}

function socialAgentIds(): readonly string[] {
  return [
    "china-relevance-gate",
    "x-social-agent",
    "telegram-social-agent",
    "lihkg-social-agent",
    "facebook-social-agent",
    "social-fusion-agent",
  ];
}

function previewUsageByAgent(): readonly Record<string, unknown>[] {
  return socialAgentIds().map((agentId, index) => ({
    agentId,
    totalInputTokens: 1200 + index * 140,
    totalOutputTokens: 520 + index * 75,
    totalCacheReadTokens: 100 + index * 10,
    totalCacheCreationTokens: 60 + index * 8,
    totalCostUsd: Number((0.012 + index * 0.004).toFixed(6)),
    requestCount: 2 + index,
  }));
}

function previewUsageByModel(): readonly Record<string, unknown>[] {
  return [
    {
      model: "MiniMax-M2.7",
      totalInputTokens: 10440,
      totalOutputTokens: 4245,
      totalCacheReadTokens: 750,
      totalCacheCreationTokens: 480,
      totalCostUsd: 0.132,
      requestCount: 27,
    },
  ];
}

function previewUsageTimeseries(): readonly Record<string, unknown>[] {
  const now = Date.now();
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(now - (6 - index) * 86400_000);
    return {
      bucket: date.toISOString(),
      inputTokens: 600 + index * 120,
      outputTokens: 260 + index * 55,
      cacheReadTokens: 80 + index * 12,
      cacheCreationTokens: 40 + index * 8,
      costUsd: Number((0.01 + index * 0.006).toFixed(6)),
      requestCount: 2 + index,
    };
  });
}

function previewRecentUsage(): readonly Record<string, unknown>[] {
  const now = epochNow();
  return socialAgentIds().map((agentId, index) => ({
    id: `usage-preview-${index + 1}`,
    agentId,
    model: "MiniMax-M2.7",
    provider: "minimax",
    channel: "社交融合",
    source: "preview",
    inputTokens: 900 + index * 90,
    outputTokens: 420 + index * 50,
    cacheReadTokens: 80,
    cacheCreationTokens: 40,
    costUsd: Number((0.01 + index * 0.004).toFixed(6)),
    durationMs: 1200 + index * 250,
    toolUseCount: 0,
    createdAt: now - index * 900,
  }));
}

function previewPlayApps(): readonly Record<string, unknown>[] {
  const now = epochNow();
  return [
    {
      id: "com.agenthub.social.monitor",
      name: "社交信号监控",
      developer: "AgentHub 预览",
      category: "社交分析",
      rank: 1,
      list_type: "top-free",
      icon_url: "",
      store_url: "https://play.google.com/store",
      description: "用于预览 Play Store 页面结构的样例应用。",
      price: "0",
      rating: 4.6,
      installs: "10,000+",
      updated_at: now,
      indexed_at: now,
    },
    {
      id: "com.agenthub.fusion.ops",
      name: "融合运营台",
      developer: "AgentHub 预览",
      category: "效率工具",
      rank: 2,
      list_type: "top-paid",
      icon_url: "",
      store_url: "https://play.google.com/store",
      description: "跨平台事件聚合和复核流程样例。",
      price: "$1.99",
      rating: 4.3,
      installs: "5,000+",
      updated_at: now - 3600,
      indexed_at: now,
    },
  ];
}

function previewPlayReviews(): readonly Record<string, unknown>[] {
  const now = epochNow();
  return [
    {
      id: "play-review-preview-1",
      app_id: "com.agenthub.social.monitor",
      app_name: "社交信号监控",
      author: "预览用户",
      rating: 2,
      title: "希望过滤更精准",
      content: "低分评论样例，用于验证评论页和筛选逻辑。",
      thumbs_up: 12,
      version: "1.0.0",
      first_seen_at: now - 7200,
      indexed_at: now,
    },
  ];
}

function previewAppStoreApps(): readonly Record<string, unknown>[] {
  const now = epochNow();
  return [
    {
      id: "ios-social-monitor",
      name: "社交信号监控",
      artist: "AgentHub 预览",
      category: "社交分析",
      rank: 1,
      list_type: "top-free",
      icon_url: "",
      store_url: "https://apps.apple.com",
      description: "用于预览 App Store 页面结构的样例应用。",
      price: "0",
      bundle_id: "com.agenthub.social.monitor",
      release_date: new Date((now - 86400) * 1000).toISOString(),
      updated_at: now,
      indexed_at: now,
    },
    {
      id: "ios-fusion-ops",
      name: "融合运营台",
      artist: "AgentHub 预览",
      category: "效率工具",
      rank: 2,
      list_type: "top-paid",
      icon_url: "",
      store_url: "https://apps.apple.com",
      description: "跨平台事件聚合和复核流程样例。",
      price: "$1.99",
      bundle_id: "com.agenthub.fusion.ops",
      release_date: new Date((now - 172800) * 1000).toISOString(),
      updated_at: now - 3600,
      indexed_at: now,
    },
  ];
}

function previewAppStoreReviews(): readonly Record<string, unknown>[] {
  const now = epochNow();
  return [
    {
      id: "app-review-preview-1",
      app_id: "ios-social-monitor",
      app_name: "社交信号监控",
      author: "预览用户",
      rating: 2,
      title: "希望过滤更精准",
      content: "低分评论样例，用于验证评论页和筛选逻辑。",
      version: "1.0.0",
      first_seen_at: now - 5400,
      indexed_at: now,
    },
  ];
}

function savedWorkflowResponse(workflow: PreviewWorkflowRecord): Record<string, unknown> {
  return {
    id: workflow.id,
    name: workflow.name,
    description: workflow.description,
    enabled: workflow.enabled,
    nodes: workflow.nodes,
    edges: workflow.edges,
    viewport: workflow.viewport,
    createdAt: workflow.createdAt,
    updatedAt: workflow.updatedAt,
  };
}

function modelRoutesResponse(): Response {
  return json({
    routes: MODEL_ROUTING_KEYS.map((key) => ({
      key,
      ...modelRoutes.get(key),
    })),
  });
}

function previewRunner(): SocialAgentRunner {
  return {
    async run(input: {
      readonly agentId: string;
      readonly task: string;
      readonly routeKey: ModelRoutingKey;
    }): Promise<string> {
      const agent = agentById.get(input.agentId);
      if (!agent) {
        throw new Error(`Social agent not found: ${input.agentId}`);
      }
      const route = modelRoutes.get(input.routeKey);
      if (!route) {
        throw new Error(`Model route not found: ${input.routeKey}`);
      }
      if (route.provider !== "minimax") {
        throw new Error(
          `Preview social runner expects MiniMax, got ${route.provider}`,
        );
      }
      const response = await chatMiniMaxDirect(
        [
          {
            role: "user",
            content: input.task,
            timestamp: Math.floor(Date.now() / 1000),
          },
        ],
        {
          systemPrompt: agent.systemPrompt,
          agentId: agent.id,
          model: route.model,
          provider: "minimax",
          maxOutputTokens: agent.maxOutputTokens,
          reasoning: agent.reasoning,
          toolsEnabled: false,
          rawSystemPrompt: true,
        },
      );
      return response.text;
    },
  };
}

async function handleApi(req: Request, url: URL): Promise<Response> {
  const path = url.pathname;

  if (path === "/api/status") {
    return json({
      uptime: Math.floor((Date.now() - startedAt) / 1000),
      authEnabled: false,
      version: "preview",
      sessions: 0,
      channels: {
        "社交融合": { status: "connected", type: "preview" },
      },
      agents: agents.length,
      cron: { running: false, jobCount: 0, nextDueAt: null },
    });
  }

  if (path === "/api/features") {
    return json({
      data: {
        scrapers: {
          available: [
            {
              id: "cryptopanic",
              name: "CryptoPanic 新闻源",
              description: "抓取加密市场新闻信号。",
            },
            {
              id: "cointelegraph",
              name: "Cointelegraph 新闻源",
              description: "抓取 Cointelegraph 新闻内容。",
            },
            {
              id: "reuters",
              name: "Reuters 新闻源",
              description: "抓取 Reuters 新闻内容。",
            },
            {
              id: "investing_news",
              name: "Investing 新闻源",
              description: "抓取 Investing 市场新闻。",
            },
            {
              id: "investing_calendar",
              name: "Investing 日历源",
              description: "抓取 Investing 经济日历。",
            },
          ],
          enabled: [
            "cryptopanic",
            "cointelegraph",
            "reuters",
            "investing_news",
            "investing_calendar",
          ],
        },
        qdrant: { enabled: true },
        embeddings: {
          provider: "openrouter",
          dimensions: 1536,
          openrouterModel: "openai/text-embedding-3-small",
          batchSize: 32,
        },
      },
    });
  }

  if (path === "/api/crawler-config" && req.method === "GET") {
    return json({ success: true, data: getCrawlerConfigOverview() });
  }

  const crawlerFieldMatch =
    /^\/api\/crawler-config\/([a-z0-9_-]+)\/fields\/([A-Za-z0-9_-]+)$/.exec(path);
  if (crawlerFieldMatch && req.method === "GET") {
    try {
      const field = getCrawlerConfigField(
        crawlerFieldMatch[1]!,
        crawlerFieldMatch[2]!,
      );
      return json({ success: true, data: field });
    } catch (error) {
      const status =
        error instanceof CrawlerConfigError ? error.status : 500;
      const message =
        error instanceof Error ? error.message : "爬虫配置字段读取失败";
      return json({ success: false, error: message }, status);
    }
  }

  if (
    crawlerFieldMatch &&
    (req.method === "POST" || req.method === "PUT")
  ) {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || typeof (body as { value?: unknown }).value !== "string") {
      return json({ success: false, error: "请求体必须包含字符串 value" }, 400);
    }
    try {
      const platform = setCrawlerConfigField(
        crawlerFieldMatch[1]!,
        crawlerFieldMatch[2]!,
        (body as { value: string }).value,
      );
      return json({ success: true, data: platform });
    } catch (error) {
      const status =
        error instanceof CrawlerConfigError ? error.status : 500;
      const message =
        error instanceof Error ? error.message : "爬虫配置保存失败";
      return json({ success: false, error: message }, status);
    }
  }

  if (crawlerFieldMatch && req.method === "DELETE") {
    try {
      const platform = clearCrawlerConfigField(
        crawlerFieldMatch[1]!,
        crawlerFieldMatch[2]!,
      );
      return json({ success: true, data: platform });
    } catch (error) {
      const status =
        error instanceof CrawlerConfigError ? error.status : 500;
      const message =
        error instanceof Error ? error.message : "爬虫配置清空失败";
      return json({ success: false, error: message }, status);
    }
  }

  const crawlerConfigMatch = /^\/api\/crawler-config\/([a-z0-9_-]+)$/.exec(path);
  if (crawlerConfigMatch && req.method === "PUT") {
    const body = await req.json().catch(() => null);
    const fields = (body as { fields?: unknown } | null)?.fields;
    if (!fields || typeof fields !== "object" || Array.isArray(fields)) {
      return json({ success: false, error: "请求体必须包含 fields 对象" }, 400);
    }
    const normalized: Record<string, string> = {};
    for (const [key, value] of Object.entries(fields)) {
      if (typeof value !== "string") {
        return json({ success: false, error: "fields 中的配置值必须是字符串" }, 400);
      }
      normalized[key] = value;
    }
    try {
      const platform = setCrawlerPlatformConfig(crawlerConfigMatch[1]!, normalized);
      return json({ success: true, data: platform });
    } catch (error) {
      const status =
        error instanceof CrawlerConfigError ? error.status : 500;
      const message =
        error instanceof Error ? error.message : "爬虫配置保存失败";
      return json({ success: false, error: message }, status);
    }
  }

  if (crawlerConfigMatch && req.method === "GET") {
    const platform = getCrawlerPlatformConfig(crawlerConfigMatch[1]!);
    if (!platform) return json({ success: false, error: "爬虫平台不存在" }, 404);
    return json({ success: true, data: platform });
  }

  if (
    (path === "/api/features/scrapers" ||
      path === "/api/features/qdrant" ||
      path === "/api/features/embeddings") &&
    req.method === "PUT"
  ) {
    return json({ success: true, data: await req.json().catch(() => ({})) });
  }

  const chunkProfileMatch = /^\/api\/features\/chunk-profiles\/([a-z0-9_-]+)$/.exec(path);
  if (chunkProfileMatch && req.method === "GET") {
    return json({
      data: {
        maxTokens: 512,
        overlap: 64,
        contentMaxChars: 4000,
        commentMaxChars: 800,
      },
    });
  }

  if (chunkProfileMatch && req.method === "PUT") {
    return json({ success: true, data: await req.json().catch(() => ({})) });
  }

  const scraperConfigMatch = /^\/api\/features\/scraper-config\/([a-z0-9_-]+)$/.exec(path);
  if (scraperConfigMatch && req.method === "GET") {
    return json({
      data: {
        intervalMinutes: 10,
        maxStories: 60,
        commentLimit: 3,
      },
    });
  }

  if (scraperConfigMatch && req.method === "PUT") {
    return json({ success: true, data: await req.json().catch(() => ({})) });
  }

  if (path === "/api/x/accounts") {
    return json({ success: true, data: [] });
  }

  if (path === "/api/ph/products") {
    return json({
      success: true,
      data: [
        {
          id: "ph-preview-1",
          slug: "social-fusion-preview",
          name: "社交融合监控",
          tagline: "跨平台社交事件聚合监控",
          description: "用于验证预览服务接口结构的中文样例。",
          url: "https://www.producthunt.com/",
          website_url: "https://example.com",
          thumbnail_url: "",
          votes_count: 128,
          comments_count: 12,
          reviews_count: 0,
          reviews_rating: 0,
          rank: 1,
          topics_json: JSON.stringify(["AI", "社交分析"]),
          makers_json: JSON.stringify(["AgentHub Preview"]),
          featured_at: epochNow() - 86400,
          updated_at: epochNow(),
        },
      ],
    });
  }

  if (path === "/api/ph/products/stats") {
    return json({
      success: true,
      data: { total_products: 1, last_updated_at: epochNow() },
    });
  }

  if (
    ["/api/ph/scrape-now", "/api/ph/backfill-rag"].includes(path) &&
    req.method === "POST"
  ) {
    return json({ success: true, data: { indexed: 1 } });
  }

  if (path === "/api/reddit/posts") {
    return json({ success: true, data: [] });
  }

  if (path === "/api/reddit/stats") {
    return json({
      success: true,
      data: { total_posts: 0, last_updated_at: epochNow(), subreddit_count: 0 },
    });
  }

  if (path === "/api/reddit/accounts") {
    if (req.method === "POST") return json({ success: true });
    return json({ success: true, data: [] });
  }

  if (
    ["/api/reddit/scrape-now", "/api/reddit/backfill-rag"].includes(path) &&
    req.method === "POST"
  ) {
    return json({ success: true, data: { indexed: 0 } });
  }

  const redditAccountActionMatch = /^\/api\/reddit\/accounts\/([^/]+)\/verify$/.exec(path);
  if (redditAccountActionMatch && req.method === "POST") {
    return json({ success: true });
  }

  const redditAccountMatch = /^\/api\/reddit\/accounts\/([^/]+)$/.exec(path);
  if (redditAccountMatch && req.method === "DELETE") {
    return json({ success: true });
  }

  if (path === "/api/github/repos") {
    return json({
      success: true,
      data: [
        {
          id: "github-preview-1",
          owner: "agenthub",
          name: "social-fusion-preview",
          full_name: "agenthub/social-fusion-preview",
          description: "社交融合、Kan 推送和中国相关性判断的预览仓库样例。",
          language: "TypeScript",
          stars: 1280,
          forks: 86,
          stars_today: 42,
          built_by_json: "[]",
          url: "https://github.com/gokhantos/opencrow",
          period: "daily",
          first_seen_at: epochNow() - 86400,
          updated_at: epochNow(),
        },
      ],
    });
  }

  if (path === "/api/github/stats") {
    return json({
      success: true,
      data: { total_repos: 1, last_updated_at: epochNow(), languages: 1 },
    });
  }

  if (
    ["/api/github/scrape-now", "/api/github/search-scrape-now"].includes(path) &&
    req.method === "POST"
  ) {
    return json({ success: true });
  }

  if (path === "/api/news/articles") {
    return json({
      success: true,
      data: [
        {
          id: "news-preview-1",
          source_name: "reuters",
          title: "AgentHub 预览新闻：跨平台社交事件开始统一聚合",
          url: "https://example.com/news-preview",
          published_at: new Date().toISOString(),
          summary: "这是预览服务返回的样例新闻，用于验证新闻源页面已接入接口。",
          sentiment: "neutral",
          currencies_json: "[]",
          source_domain: "example.com",
          scraped_at: epochNow(),
        },
      ],
    });
  }

  if (path === "/api/news/calendar") {
    return json({
      success: true,
      data: [
        {
          id: "calendar-preview-1",
          event_name: "预览经济事件",
          country: "中国",
          importance: "medium",
          event_datetime: new Date().toISOString(),
          actual: "-",
          forecast: "-",
          previous: "-",
        },
      ],
    });
  }

  if (path === "/api/news/stats") {
    return json({
      success: true,
      data: [
        { source_name: "reuters", count: 1, latest_at: epochNow() },
      ],
    });
  }

  if (
    ["/api/news/scrape-now", "/api/news/backfill-rag"].includes(path) &&
    req.method === "POST"
  ) {
    return json({ success: true, data: { indexed: 1 } });
  }

  if (path === "/api/appstore/opportunities") {
    const limit = Number(url.searchParams.get("limit") ?? 50);
    const offset = Number(url.searchParams.get("offset") ?? 0);
    return json({
      success: true,
      data: [],
      meta: { total: 0, limit, offset },
    });
  }

  const appstoreWatchlistMatch = /^\/api\/appstore\/(?:watchlist|verdicts)\/(.+)$/.exec(path);
  if (appstoreWatchlistMatch && ["POST", "DELETE"].includes(req.method)) {
    return json({ success: true });
  }

  if (path === "/api/pipelines") {
    return json({ success: true, data: [] });
  }

  if (path === "/api/pipelines-runs") {
    return json({ success: true, data: [] });
  }

  const pipelineRunMatch = /^\/api\/pipelines\/([^/]+)\/run$/.exec(path);
  if (pipelineRunMatch && req.method === "POST") {
    return json({
      success: true,
      message: "预览管线已启动",
      runId: `preview-${Date.now()}`,
    });
  }

  if (path === "/api/pipeline-ideas") {
    return json({ success: true, data: [], meta: { total: 0 } });
  }

  if (path === "/api/pipeline-ideas/runs") {
    return json({ success: true, data: [] });
  }

  const pipelineIdeaStageMatch = /^\/api\/pipeline-ideas\/([^/]+)\/stage$/.exec(path);
  if (pipelineIdeaStageMatch && req.method === "PATCH") {
    return json({ success: true, data: await req.json().catch(() => ({})) });
  }

  if (path === "/api/pipelines/lift-summary") {
    return json({
      success: true,
      data: {
        sinceSec: 0,
        humanOnly: true,
        lift: {
          guided: { runs: 0, ideas: 0, validatedRate: 0, keptRate: 0 },
          blind: { runs: 0, ideas: 0, validatedRate: 0, keptRate: 0 },
          validatedLift: 0,
          keptLift: 0,
        },
        lessons: [],
      },
    });
  }

  if (path === "/api/sige/sessions") {
    if (req.method === "POST") {
      return json({
        success: true,
        data: { id: `sige-preview-${Date.now()}` },
      });
    }
    return json({ success: true, data: { sessions: [] } });
  }

  if (path === "/api/sige/ideas") {
    return json({ success: true, data: { ideas: [], runs: [] } });
  }

  if (path === "/api/hn/stories" && req.method === "GET") {
    const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit") ?? 100), 100));
    return json({ success: true, data: previewHnStories().slice(0, limit) });
  }

  if (path === "/api/hn/stats" && req.method === "GET") {
    const stories = previewHnStories();
    return json({
      success: true,
      data: {
        total_stories: stories.length,
        last_updated_at: Math.floor(Date.now() / 1000),
        feed_types: 1,
      },
    });
  }

  if (path === "/api/hn/scrape-now" && req.method === "POST") {
    return json({ success: true, data: { queued: true } });
  }

  if (path === "/api/hn/backfill-rag" && req.method === "POST") {
    return json({ success: true, data: { indexed: previewHnStories().length } });
  }

  if (path === "/api/skills/generate" && req.method === "POST") {
    const body = (await req.json().catch(() => ({}))) as { prompt?: string };
    const prompt = body.prompt?.trim() || "智能体工作流技能";
    const text = JSON.stringify(
      {
        name: "AI 生成技能",
        description: `根据“${prompt}”生成的预览技能。`,
        content: `# AI 生成技能\n\n## 目标\n围绕“${prompt}”提供可执行的操作步骤。\n\n## 步骤\n1. 明确输入和目标。\n2. 按步骤执行并记录关键判断。\n3. 输出结论、依据和下一步建议。\n`,
      },
      null,
      2,
    );
    return new Response(
      `data: ${JSON.stringify({ type: "done", text })}\n\n`,
      {
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache",
        },
      },
    );
  }

  if (path === "/api/skills" && req.method === "GET") {
    return json({ success: true, data: previewSkills.map(skillListItem) });
  }

  if (path === "/api/skills" && req.method === "POST") {
    const body = (await req.json().catch(() => ({}))) as Partial<PreviewSkill>;
    const id =
      body.id?.trim() ||
      body.name
        ?.toLowerCase()
        .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
        .replace(/^-+|-+$/g, "") ||
      crypto.randomUUID();
    const skill: PreviewSkill = {
      id,
      name: body.name?.trim() || "未命名技能",
      description: body.description?.trim() || "预览技能",
      content: body.content ?? "",
    };
    previewSkills.push(skill);
    return json({ success: true, data: { id } });
  }

  const skillMatch = /^\/api\/skills\/([^/]+)$/.exec(path);
  if (skillMatch && req.method === "GET") {
    const skill = previewSkills.find((item) => item.id === decodeURIComponent(skillMatch[1]!));
    if (!skill) return json({ success: false, error: "技能不存在" }, 404);
    return json({ success: true, data: skillDetail(skill) });
  }

  if (skillMatch && req.method === "PUT") {
    const id = decodeURIComponent(skillMatch[1]!);
    const index = previewSkills.findIndex((item) => item.id === id);
    if (index < 0) return json({ success: false, error: "技能不存在" }, 404);
    const body = (await req.json().catch(() => ({}))) as Partial<PreviewSkill>;
    previewSkills[index] = {
      ...previewSkills[index]!,
      name: body.name?.trim() || previewSkills[index]!.name,
      description: body.description?.trim() || previewSkills[index]!.description,
      content: body.content ?? previewSkills[index]!.content,
    };
    return json({ success: true });
  }

  if (skillMatch && req.method === "DELETE") {
    const id = decodeURIComponent(skillMatch[1]!);
    const index = previewSkills.findIndex((item) => item.id === id);
    if (index >= 0) previewSkills.splice(index, 1);
    return json({ success: true });
  }

  if (path === "/api/agents" && req.method === "GET") {
    return json({
      success: true,
      data: agents.map(agentListItem),
      configHash,
    });
  }

  if (path === "/api/agents" && req.method === "POST") {
    const body = (await req.json().catch(() => ({}))) as Partial<AgentDefinition>;
    if (!body.id || !body.name) {
      return json({ success: false, error: "智能体 ID 和名称不能为空" }, 400);
    }
    const created = resolveAgent({
      id: String(body.id),
      name: String(body.name),
      description: body.description,
      provider: body.provider,
      model: body.model,
      default: body.default,
      systemPrompt: body.systemPrompt,
      maxIterations: body.maxIterations,
      reasoning: body.reasoning,
      stateless: body.stateless,
      maxInputLength: body.maxInputLength,
      modelParams: body.modelParams,
      toolFilter: body.toolFilter,
      subagents: body.subagents,
      mcpServers: body.mcpServers,
      hooks: body.hooks,
      telegramBotToken: body.telegramBotToken,
      skills: body.skills,
      category: body.category,
    });
    agents.push(created);
    agentById.set(created.id, created);
    return json({ success: true, data: agentDetail(created), configHash });
  }

  if (path === "/api/agents/templates") {
    return json({ success: true, data: [] });
  }

  if (path === "/api/agents/subagents") {
    return json({ success: true, data: [] });
  }

  const agentMatch = /^\/api\/agents\/([a-z0-9-]+)$/.exec(path);
  if (agentMatch && req.method === "GET") {
    const agent = agentById.get(agentMatch[1]!);
    if (!agent) return json({ success: false, error: "智能体不存在" }, 404);
    return json({ success: true, data: agentDetail(agent), configHash });
  }

  if (agentMatch && req.method === "PUT") {
    const agent = agentById.get(agentMatch[1]!);
    if (!agent) return json({ success: false, error: "智能体不存在" }, 404);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    Object.assign(agent as unknown as Record<string, unknown>, body);
    return json({ success: true, data: agentDetail(agent), configHash });
  }

  if (agentMatch && req.method === "DELETE") {
    const id = agentMatch[1]!;
    const index = agents.findIndex((agent) => agent.id === id);
    if (index >= 0) agents.splice(index, 1);
    agentById.delete(id);
    return json({ success: true, configHash });
  }

  if (path === "/api/model-routing" && req.method === "GET") {
    return modelRoutesResponse();
  }

  const modelRouteMatch = /^\/api\/model-routing\/(.+)$/.exec(path);
  if (modelRouteMatch && req.method === "PUT") {
    const key = decodeURIComponent(modelRouteMatch[1]!);
    if (!isModelRoutingKey(key)) {
      return json({ error: `未知模型路由键：${key}` }, 404);
    }
    const body = (await req.json().catch(() => null)) as Partial<ModelRoute> | null;
    if (!body?.provider || !body.model) {
      return json({ error: "模型路由无效" }, 400);
    }
    const route = { provider: body.provider, model: body.model } as ModelRoute;
    modelRoutes.set(key, route);
    return json({ key, ...route });
  }

  if (path === "/api/social/run" && req.method === "POST") {
    const body = (await req.json().catch(() => null)) as {
      signals?: readonly LightweightSocialSignal[];
    } | null;
    if (!body || !Array.isArray(body.signals) || body.signals.length === 0) {
      return json({ success: false, error: "社交运行请求无效" }, 400);
    }

    const now = Math.floor(Date.now() / 1000);
    try {
      const result = await runSocialPipeline({
        signals: body.signals.map((signal) => ({
          ...signal,
          observedAt: signal.observedAt ?? now,
        })),
        runner: previewRunner(),
      });
      return json({ success: true, data: result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return json({ success: false, error: message }, 500);
    }
  }

  if (path === "/api/kan-push/config" && req.method === "GET") {
    return json({ success: true, data: await getKanPushOverview() });
  }

  if (path === "/api/kan-push/channels" && req.method === "GET") {
    return json({ success: true, data: (await getKanPushOverview()).channels });
  }

  if (path === "/api/kan-push/routes" && req.method === "POST") {
    const body = (await req.json().catch(() => null)) as {
      platform?: string;
      baseUrl?: string;
      channelIds?: string[];
    } | null;
    if (!body || !Array.isArray(body.channelIds) || body.channelIds.length === 0) {
      return json({ success: false, error: "至少需要一个 Kan 频道" }, 400);
    }
    try {
      const overview = await saveKanPushRouteConfig({
        platform: body.platform,
        baseUrl: body.baseUrl,
        channelIds: body.channelIds,
      });
      return json({ success: true, data: overview });
    } catch (err) {
      const status = err instanceof KanPushConfigError ? err.status : 500;
      return json(
        { success: false, error: err instanceof Error ? err.message : String(err) },
        status,
      );
    }
  }

  const kanRouteMatch = /^\/api\/kan-push\/routes\/([a-z0-9_-]+)$/.exec(path);
  if (kanRouteMatch && req.method === "PUT") {
    const body = (await req.json().catch(() => null)) as {
      baseUrl?: string;
      channelIds?: string[];
    } | null;
    if (!body || !Array.isArray(body.channelIds) || body.channelIds.length === 0) {
      return json({ success: false, error: "至少需要一个 Kan 频道" }, 400);
    }
    try {
      const overview = await saveKanPushRouteConfig({
        routeId: kanRouteMatch[1]!,
        baseUrl: body.baseUrl,
        channelIds: body.channelIds,
      });
      return json({ success: true, data: overview });
    } catch (err) {
      const status = err instanceof KanPushConfigError ? err.status : 500;
      return json(
        { success: false, error: err instanceof Error ? err.message : String(err) },
        status,
      );
    }
  }

  if (kanRouteMatch && req.method === "DELETE") {
    try {
      const overview = await deleteKanPushRouteConfig(kanRouteMatch[1]!);
      return json({ success: true, data: overview });
    } catch (err) {
      const status = err instanceof KanPushConfigError ? err.status : 500;
      return json(
        { success: false, error: err instanceof Error ? err.message : String(err) },
        status,
      );
    }
  }

  if (path === "/api/kan-push/dispatch" && req.method === "POST") {
    const body = (await req.json().catch(() => ({}))) as {
      platform?: string;
      routeId?: string;
      source?: string;
      message?: string;
      channelIds?: string[];
      dedupeKey?: string;
      dryRun?: boolean;
      metadata?: Record<string, unknown>;
    };
    try {
      const result = await dispatchKanMessage({
        platform: body.platform,
        routeId: body.routeId,
        source: body.source,
        message: body.message ?? "",
        channelIds: body.channelIds,
        dedupeKey: body.dedupeKey,
        dryRun: body.dryRun,
        metadata: body.metadata,
      });
      return json({ success: true, data: result });
    } catch (err) {
      return json(
        { success: false, error: err instanceof Error ? err.message : String(err) },
        500,
      );
    }
  }

  if (path === "/api/tools" && req.method === "GET") {
    return json({
      success: true,
      data: previewTools(),
      categories: {
        social: "社交智能体",
        crawler: "爬虫探测",
      },
      disabledTools: [...disabledTools],
    });
  }

  if (path === "/api/tools/disabled" && req.method === "PUT") {
    const body = (await req.json().catch(() => ({}))) as { disabled?: string[] };
    disabledTools.clear();
    for (const name of body.disabled ?? []) {
      if (typeof name === "string" && name.trim()) disabledTools.add(name.trim());
    }
    return json({ success: true, disabledTools: [...disabledTools] });
  }

  if (path === "/api/sessions" && req.method === "GET") {
    const now = epochNow();
    return json({
      success: true,
      data: [
        {
          id: "preview-social-session",
          channel: "社交融合",
          chatId: "social-fusion-preview",
          createdAt: now - 3600,
          updatedAt: now - 120,
        },
      ],
    });
  }

  if (path === "/api/channels" && req.method === "GET") {
    return json({ success: true, data: previewChannelEntries() });
  }

  if (path === "/api/channels/whatsapp" && req.method === "GET") {
    const whatsapp = previewChannelEntries().find((item) => item.id === "whatsapp");
    return json({
      success: true,
      data: {
        snapshot:
          (whatsapp?.snapshot as Record<string, unknown> | undefined) ??
          { enabled: false, configured: false, connected: false },
      },
    });
  }

  if (path === "/api/channels/whatsapp/pair" && req.method === "POST") {
    return json({ success: true, data: { code: "12345678" } });
  }

  const channelActionMatch = /^\/api\/channels\/([^/]+)\/(setup|enable|disable|restart)$/.exec(path);
  if (channelActionMatch && req.method === "POST") {
    return json({
      success: true,
      data: {
        id: decodeURIComponent(channelActionMatch[1]!),
        action: channelActionMatch[2],
      },
    });
  }

  if (path === "/api/usage/by-agent" && req.method === "GET") {
    return json({ success: true, data: previewUsageByAgent() });
  }

  if (path === "/api/usage/by-model" && req.method === "GET") {
    return json({ success: true, data: previewUsageByModel() });
  }

  if (path === "/api/usage/timeseries" && req.method === "GET") {
    return json({ success: true, data: previewUsageTimeseries() });
  }

  if (path === "/api/usage/recent" && req.method === "GET") {
    const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit") ?? 50), 200));
    return json({ success: true, data: previewRecentUsage().slice(0, limit) });
  }

  if (path === "/api/cron/jobs" && req.method === "GET") {
    const now = epochNow();
    return json({
      success: true,
      data: [
        {
          id: "social-monitor-preview",
          name: "社交事件监控预览",
          enabled: true,
          deleteAfterRun: false,
          priority: 5,
          schedule: { kind: "every", everyMs: 30 * 60 * 1000 },
          payload: {
            kind: "agentTurn",
            agentId: "social-fusion-agent",
            message: "聚合各平台社交事件",
          },
          delivery: { mode: "internal" },
          nextRunAt: now + 1800,
          lastRunAt: now - 1800,
          lastStatus: "ok",
          lastError: null,
          createdAt: now - 86400,
          updatedAt: now - 1800,
        },
      ],
    });
  }

  if (path === "/api/cron/active-runs" && req.method === "GET") {
    return json({ success: true, data: [] });
  }

  const cronRunsMatch = /^\/api\/cron\/jobs\/([^/]+)\/runs$/.exec(path);
  if (cronRunsMatch && req.method === "GET") {
    return json({ success: true, data: [] });
  }

  const cronActionMatch = /^\/api\/cron\/jobs\/([^/]+)\/(toggle|run)$/.exec(path);
  if (cronActionMatch && req.method === "POST") {
    return json({ success: true, data: { id: cronActionMatch[1], action: cronActionMatch[2] } });
  }

  const cronJobMatch = /^\/api\/cron\/jobs\/([^/]+)$/.exec(path);
  if (cronJobMatch && req.method === "DELETE") {
    return json({ success: true });
  }

  if (path === "/api/cron/jobs" && req.method === "POST") {
    return json({ success: true });
  }

  if (path === "/api/routing/rules" && req.method === "GET") {
    return json({ success: true, data: previewRoutingRules });
  }

  if (path === "/api/routing/rules" && req.method === "POST") {
    const body = (await req.json().catch(() => ({}))) as Partial<PreviewRoutingRule>;
    const now = epochNow();
    const rule: PreviewRoutingRule = {
      id: crypto.randomUUID(),
      channel: body.channel || "*",
      matchType: body.matchType || "chat",
      matchValue: body.matchValue || "",
      agentId: body.agentId || "social-fusion-agent",
      priority: Number(body.priority ?? 0),
      enabled: body.enabled ?? true,
      notes: body.notes ?? null,
      createdAt: now,
      updatedAt: now,
    };
    previewRoutingRules.push(rule);
    return json({ success: true, data: rule });
  }

  const routingRuleMatch = /^\/api\/routing\/rules\/([^/]+)$/.exec(path);
  if (routingRuleMatch && req.method === "PUT") {
    const id = decodeURIComponent(routingRuleMatch[1]!);
    const index = previewRoutingRules.findIndex((rule) => rule.id === id);
    if (index < 0) return json({ success: false, error: "路由规则不存在" }, 404);
    const body = (await req.json().catch(() => ({}))) as Partial<PreviewRoutingRule>;
    const prev = previewRoutingRules[index]!;
    previewRoutingRules[index] = {
      ...prev,
      channel: body.channel ?? prev.channel,
      matchType: body.matchType ?? prev.matchType,
      matchValue: body.matchValue ?? prev.matchValue,
      agentId: body.agentId ?? prev.agentId,
      priority: Number(body.priority ?? prev.priority),
      enabled: body.enabled ?? prev.enabled,
      notes: body.notes ?? prev.notes,
      updatedAt: epochNow(),
    };
    return json({ success: true, data: previewRoutingRules[index] });
  }

  if (routingRuleMatch && req.method === "DELETE") {
    const id = decodeURIComponent(routingRuleMatch[1]!);
    const index = previewRoutingRules.findIndex((rule) => rule.id === id);
    if (index >= 0) previewRoutingRules.splice(index, 1);
    return json({ success: true });
  }

  if (path === "/api/appstore/rankings" && req.method === "GET") {
    const listType = url.searchParams.get("list_type");
    const category = url.searchParams.get("category");
    let data = [...previewAppStoreApps()];
    if (listType) data = data.filter((app) => app.list_type === listType);
    if (category && category !== "all") data = data.filter((app) => app.category === category);
    return json({ success: true, data });
  }

  if (path === "/api/appstore/discovered" && req.method === "GET") {
    return json({ success: true, data: previewAppStoreApps() });
  }

  if (path === "/api/appstore/reviews" && req.method === "GET") {
    return json({ success: true, data: previewAppStoreReviews() });
  }

  if (path === "/api/appstore/stats" && req.method === "GET") {
    return json({
      success: true,
      data: {
        total_apps: previewAppStoreApps().length,
        total_reviews: previewAppStoreReviews().length,
        total_categories: new Set(previewAppStoreApps().map((app) => app.category)).size,
        last_updated_at: epochNow(),
      },
    });
  }

  if (path === "/api/appstore/scrape-now" && req.method === "POST") {
    return json({ success: true, data: { queued: true } });
  }

  if (path === "/api/playstore/rankings" && req.method === "GET") {
    const listType = url.searchParams.get("list_type");
    const category = url.searchParams.get("category");
    let data = [...previewPlayApps()];
    if (listType) data = data.filter((app) => app.list_type === listType);
    if (category && category !== "all") data = data.filter((app) => app.category === category);
    return json({ success: true, data });
  }

  if (path === "/api/playstore/discovered" && req.method === "GET") {
    return json({ success: true, data: previewPlayApps() });
  }

  if (path === "/api/playstore/reviews" && req.method === "GET") {
    return json({ success: true, data: previewPlayReviews() });
  }

  if (path === "/api/playstore/stats" && req.method === "GET") {
    return json({
      success: true,
      data: {
        total_apps: previewPlayApps().length,
        total_reviews: previewPlayReviews().length,
        total_categories: new Set(previewPlayApps().map((app) => app.category)).size,
        last_updated_at: epochNow(),
      },
    });
  }

  if (path === "/api/playstore/scrape-now" && req.method === "POST") {
    return json({ success: true, data: { queued: true } });
  }

  if (path === "/api/workflows" && req.method === "GET") {
    return json({ success: true, data: previewWorkflows.map(savedWorkflowResponse) });
  }

  if (path === "/api/workflows" && req.method === "POST") {
    const body = (await req.json().catch(() => ({}))) as Partial<PreviewWorkflowRecord>;
    const now = new Date().toISOString();
    const workflow: PreviewWorkflowRecord = {
      id: crypto.randomUUID(),
      name: body.name?.trim() || "未命名工作流",
      description: body.description?.trim() || "",
      enabled: body.enabled ?? false,
      nodes: Array.isArray(body.nodes) ? body.nodes : [],
      edges: Array.isArray(body.edges) ? body.edges : [],
      viewport: body.viewport,
      createdAt: now,
      updatedAt: now,
    };
    previewWorkflows.unshift(workflow);
    return json({ success: true, data: { id: workflow.id, workflow: savedWorkflowResponse(workflow) } });
  }

  const workflowExecutionsMatch = /^\/api\/workflows\/([^/]+)\/executions$/.exec(path);
  if (workflowExecutionsMatch && req.method === "GET") {
    const workflowId = decodeURIComponent(workflowExecutionsMatch[1]!);
    const executions = [...previewWorkflowExecutions.values()]
      .filter((execution) => execution.workflowId === workflowId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, Math.max(1, Math.min(Number(url.searchParams.get("limit") ?? 20), 100)));
    return json({ success: true, data: executions });
  }

  const workflowRunMatch = /^\/api\/workflows\/([^/]+)\/run$/.exec(path);
  if (workflowRunMatch && req.method === "POST") {
    const workflowId = decodeURIComponent(workflowRunMatch[1]!);
    const workflow = previewWorkflows.find((item) => item.id === workflowId);
    if (!workflow) return json({ success: false, error: "工作流不存在" }, 404);
    const now = epochNow();
    const steps = (workflow.nodes.length > 0 ? workflow.nodes : [{ id: "manual-trigger" }]).map(
      (node, index) => {
        const nodeId =
          typeof node === "object" &&
          node !== null &&
          "id" in node &&
          typeof (node as { id?: unknown }).id === "string"
            ? (node as { id: string }).id
            : `step-${index + 1}`;
        return {
          nodeId,
          status: "completed" as const,
          output: { message: "预览运行已完成", nodeId },
        };
      },
    );
    const execution: PreviewWorkflowExecution = {
      id: crypto.randomUUID(),
      workflowId,
      status: "completed",
      result: { message: "预览工作流运行成功" },
      startedAt: now,
      finishedAt: now + 1,
      createdAt: now,
      steps,
    };
    previewWorkflowExecutions.set(execution.id, execution);
    return json({ success: true, data: { executionId: execution.id } });
  }

  const workflowDuplicateMatch = /^\/api\/workflows\/([^/]+)\/duplicate$/.exec(path);
  if (workflowDuplicateMatch && req.method === "POST") {
    const id = decodeURIComponent(workflowDuplicateMatch[1]!);
    const source = previewWorkflows.find((item) => item.id === id);
    if (!source) return json({ success: false, error: "工作流不存在" }, 404);
    const now = new Date().toISOString();
    const copy: PreviewWorkflowRecord = {
      ...source,
      id: crypto.randomUUID(),
      name: `${source.name} 副本`,
      enabled: false,
      createdAt: now,
      updatedAt: now,
    };
    previewWorkflows.unshift(copy);
    return json({ success: true, data: savedWorkflowResponse(copy) });
  }

  const workflowExecutionStreamMatch = /^\/api\/workflow-executions\/([^/]+)\/stream$/.exec(path);
  if (workflowExecutionStreamMatch && req.method === "GET") {
    const execution = previewWorkflowExecutions.get(decodeURIComponent(workflowExecutionStreamMatch[1]!));
    if (!execution) return json({ success: false, error: "执行记录不存在" }, 404);
    const payload = {
      type: "snapshot",
      execution,
      steps: execution.steps,
    };
    return new Response(`data: ${JSON.stringify(payload)}\n\n`, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
      },
    });
  }

  const workflowExecutionMatch = /^\/api\/workflow-executions\/([^/]+)$/.exec(path);
  if (workflowExecutionMatch && req.method === "GET") {
    const execution = previewWorkflowExecutions.get(decodeURIComponent(workflowExecutionMatch[1]!));
    if (!execution) return json({ success: false, error: "执行记录不存在" }, 404);
    return json({ success: true, data: execution });
  }

  const workflowMatch = /^\/api\/workflows\/([^/]+)$/.exec(path);
  if (workflowMatch && req.method === "GET") {
    const workflow = previewWorkflows.find((item) => item.id === decodeURIComponent(workflowMatch[1]!));
    if (!workflow) return json({ success: false, error: "工作流不存在" }, 404);
    return json({ success: true, data: savedWorkflowResponse(workflow) });
  }

  if (workflowMatch && req.method === "PUT") {
    const id = decodeURIComponent(workflowMatch[1]!);
    const workflow = previewWorkflows.find((item) => item.id === id);
    if (!workflow) return json({ success: false, error: "工作流不存在" }, 404);
    const body = (await req.json().catch(() => ({}))) as Partial<PreviewWorkflowRecord>;
    workflow.name = body.name?.trim() || workflow.name;
    workflow.description = body.description?.trim() ?? workflow.description;
    workflow.enabled = body.enabled ?? workflow.enabled;
    workflow.nodes = Array.isArray(body.nodes) ? body.nodes : workflow.nodes;
    workflow.edges = Array.isArray(body.edges) ? body.edges : workflow.edges;
    workflow.viewport = body.viewport ?? workflow.viewport;
    workflow.updatedAt = new Date().toISOString();
    return json({ success: true, data: savedWorkflowResponse(workflow) });
  }

  if (workflowMatch && req.method === "DELETE") {
    const id = decodeURIComponent(workflowMatch[1]!);
    const index = previewWorkflows.findIndex((item) => item.id === id);
    if (index >= 0) previewWorkflows.splice(index, 1);
    return json({ success: true });
  }

  if (path === "/api/secrets") {
    return json({
      success: true,
      data: [
        {
          key: "ALIBABA_API_KEY",
          set: previewSecrets.has("ALIBABA_API_KEY"),
          source: null,
          masked: maskSecret(previewSecrets.get("ALIBABA_API_KEY")),
        },
        {
          key: "ALIBABA_BASE_URL",
          set: previewSecrets.has("ALIBABA_BASE_URL"),
          source: null,
          masked: previewSecrets.get("ALIBABA_BASE_URL") ?? null,
        },
        {
          key: "MINIMAX_INTL_API_KEY",
          set: Boolean(process.env.MINIMAX_INTL_API_KEY),
          source: process.env.MINIMAX_INTL_API_KEY ? "env" : null,
          masked: maskSecret(process.env.MINIMAX_INTL_API_KEY),
        },
        {
          key: "MINIMAX_BASE_URL",
          set: Boolean(process.env.MINIMAX_BASE_URL),
          source: process.env.MINIMAX_BASE_URL ? "env" : null,
          masked: process.env.MINIMAX_BASE_URL ?? null,
        },
      ],
    });
  }

  const secretMatch = /^\/api\/secrets\/([A-Z0-9_]+)$/.exec(path);
  if (secretMatch && req.method === "PUT") {
    const key = secretMatch[1]!;
    const body = (await req.json().catch(() => ({}))) as { value?: string };
    if (body.value) previewSecrets.set(key, body.value);
    return json({ success: true });
  }

  if (secretMatch && req.method === "DELETE") {
    previewSecrets.delete(secretMatch[1]!);
    return json({ success: true });
  }

  if (path === "/api/usage/summary") {
    return json({
      success: true,
      data: {
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCacheReadTokens: 0,
        totalCacheCreationTokens: 0,
        totalCostUsd: 0,
        totalRequests: 0,
      },
    });
  }

  if (path === "/api/processes") {
    return json({
      data: [
        {
          name: "预览服务",
          pid: process.pid,
          status: "alive",
          startedAt: Math.floor(startedAt / 1000),
          lastHeartbeat: Math.floor(Date.now() / 1000),
          uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
          metadata: {},
          desired: true,
          syncStatus: "synced",
          restartCount: 0,
          backoffMs: 0,
          nextRetryAt: null,
          orchestrated: false,
        },
      ],
    });
  }

  if (path === "/api/cron/status") {
    return json({
      success: true,
      data: { running: false, jobCount: 1, nextDueAt: epochNow() + 1800 },
    });
  }

  if (path === "/api/system/metrics") {
    const totalMemory = 32 * 1024 * 1024 * 1024;
    const memoryPct = 45 + Math.sin(Date.now() / 30000) * 6;
    const usedMemory = Math.round(totalMemory * (memoryPct / 100));
    const diskTotal = 1024 * 1024 * 1024 * 1024;
    const diskUsed = Math.round(diskTotal * 0.58);
    return json({
      timestamp: Date.now(),
      cpu: {
        usage: Math.max(3, 18 + Math.sin(Date.now() / 18000) * 8),
        loadAvg: [1.12, 1.04, 0.96],
      },
      memory: {
        total: totalMemory,
        used: usedMemory,
        free: totalMemory - usedMemory,
        available: totalMemory - usedMemory,
        percentage: memoryPct,
      },
      disk: [
        {
          filesystem: "NTFS",
          mount: "本地磁盘",
          total: diskTotal,
          used: diskUsed,
          available: diskTotal - diskUsed,
          percentage: (diskUsed / diskTotal) * 100,
        },
      ],
      processes: [
        {
          pid: process.pid,
          name: "AgentHub 预览服务",
          cpu: 4.2,
          memory: 256 * 1024 * 1024,
          memoryMB: 256,
        },
        {
          pid: 48080,
          name: "Kan 推送配置页面",
          cpu: 1.7,
          memory: 128 * 1024 * 1024,
          memoryMB: 128,
        },
      ],
    });
  }

  if (path === "/api/memory/debug/stats") {
    return json({
      success: true,
      data: {
        totalSources: 2,
        totalChunks: 2,
        totalTokens: 420,
        agentsWithMemory: 1,
        byKind: [
          { kind: "social_event", count: 1 },
          { kind: "kan_route", count: 1 },
        ],
        byAgent: [
          {
            agentId: "social-fusion-agent",
            chunkCount: 2,
            sourceCount: 2,
            totalTokens: 420,
          },
        ],
      },
    });
  }

  if (path === "/api/memory/debug/chunks") {
    return json({
      success: true,
      data: [
        {
          id: "chunk-preview-1",
          sourceId: "source-preview-1",
          content: "社交融合智能体会先判断事件是否与中国相关，再调度各平台智能体复核。",
          chunkIndex: 0,
          tokenCount: 210,
          createdAt: epochNow() - 600,
          kind: "social_event",
          agentId: "social-fusion-agent",
          channel: "预览",
        },
        {
          id: "chunk-preview-2",
          sourceId: "source-preview-2",
          content: "Kan 推送配置统一管理 Telegram、LIHKG、Facebook、GitHub 等平台的频道映射。",
          chunkIndex: 0,
          tokenCount: 210,
          createdAt: epochNow() - 420,
          kind: "kan_route",
          agentId: "social-fusion-agent",
          channel: "预览",
        },
      ],
    });
  }

  if (path === "/api/memory/debug/agent-memory") {
    return json({
      success: true,
      data: [
        {
          agentId: "social-fusion-agent",
          key: "kan_push_policy",
          value: "所有爬虫推送统一经 AgentHub Kan 推送中心处理。",
          updatedAt: epochNow() - 300,
        },
      ],
    });
  }

  if (path === "/api/memory/debug/search") {
    return json({
      success: true,
      data: [
        {
          score: 0.86,
          content: "中国相关性判断通过后，社交融合智能体再调度各平台智能体深挖同一事件。",
          chunkId: "chunk-preview-1",
          chunkIndex: 0,
          tokenCount: 180,
          createdAt: epochNow() - 600,
          source: {
            id: "source-preview-1",
            kind: "social_event",
            agentId: "social-fusion-agent",
            channel: "预览",
            createdAt: epochNow() - 600,
          },
        },
      ],
    });
  }

  if (path === "/api/messages") {
    return json({ success: true, data: [] });
  }

  if (path === "/api/chat/clear") {
    return json({ success: true });
  }

  if (
    path === "/api/logs" ||
    path === "/api/logs/processes" ||
    path === "/api/logs/contexts"
  ) {
    return json({ success: true, data: [] });
  }

  return json({ success: false, error: `预览接口尚未实现：${path}` }, 404);
}

function safeStaticPath(baseDir: string, pathname: string): string | null {
  const resolved = resolve(baseDir, pathname.replace(/^\/+/, ""));
  const normalizedBase = resolve(baseDir);
  if (dirname(resolved).startsWith(normalizedBase) || resolved === normalizedBase) {
    return resolved;
  }
  return null;
}

loadMiniMaxModelEnv();
await buildFrontend();

const requestedPort = Number(
  process.env.OPENCROW_PREVIEW_PORT ?? process.env.PORT ?? DEFAULT_PORT,
);
const port = await pickPort(Number.isFinite(requestedPort) ? requestedPort : DEFAULT_PORT);

const server = Bun.serve<{ kind: "system" | "chat" }>({
  hostname: "127.0.0.1",
  port,
  async fetch(req, bunServer) {
    const url = new URL(req.url);

    if (url.pathname === "/ws/system") {
      const upgraded = bunServer.upgrade(req, { data: { kind: "system" } });
      return upgraded ? undefined : text("WebSocket 升级失败", 400);
    }

    if (url.pathname === "/ws/chat") {
      const upgraded = bunServer.upgrade(req, { data: { kind: "chat" } });
      return upgraded ? undefined : text("WebSocket 升级失败", 400);
    }

    if (url.pathname.startsWith("/api/")) {
      return handleApi(req, url);
    }

    if (url.pathname === "/" || url.pathname === "/index.html") {
      return indexHtml();
    }

    if (url.pathname === "/tailwind-out.css" || url.pathname === "/style.css") {
      const file = join(UI_DIR, url.pathname.slice(1));
      return fileResponse(file, "text/css");
    }

    if (url.pathname === "/logo.png") {
      return fileResponse(join(ROOT, "src", "web", "agenthub-mark.png"), "image/png");
    }

    if (url.pathname === "/favicon.ico") {
      return fileResponse(join(ROOT, "src", "web", "favicon.ico"), "image/x-icon");
    }

    if (url.pathname.startsWith("/assets/")) {
      const file = safeStaticPath(ASSETS_DIR, url.pathname.slice("/assets/".length));
      if (!file) return text("静态资源路径无效", 400);
      return fileResponse(file, contentTypeFor(file));
    }

    return indexHtml();
  },
  websocket: {
    open(ws) {
      if (ws.data.kind === "system") {
        ws.send(
          JSON.stringify({
            type: "status",
            data: {
              uptime: Math.floor((Date.now() - startedAt) / 1000),
              authEnabled: false,
              version: "preview",
              sessions: 0,
              channels: {
                "社交融合": { status: "connected", type: "preview" },
              },
              agents: agents.length,
              cron: { running: false, jobCount: 0, nextDueAt: null },
            },
            ts: Date.now(),
          }),
        );
      }
    },
    message(ws, raw) {
      if (ws.data.kind !== "chat") return;
      const message = typeof raw === "string" ? raw : new TextDecoder().decode(raw);
      try {
        const parsed = JSON.parse(message) as { type?: string };
        if (parsed.type === "clear") {
          ws.send(JSON.stringify({ type: "cleared" }));
          return;
        }
      } catch {
        // Fall through to the preview-only response.
      }
      ws.send(
        JSON.stringify({
          type: "response",
          text: "预览对话已运行。请到“社交融合”页面验证六个 MiniMax 社交智能体。",
        }),
      );
    },
  },
});

console.log(`AgentHub preview: http://${server.hostname}:${server.port}`);
console.log("MiniMax env: loaded from configured model_env when present.");
