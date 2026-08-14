import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { getAgentHubRoot } from "../../config/agenthub-root";

export type CrawlerConfigStatus = "ready" | "partial" | "missing-env";
export type CrawlerConfigGroupStatus = "ok" | "partial" | "missing";

export interface CrawlerConfigField {
  readonly id: string;
  readonly label: string;
  readonly configured: boolean;
  readonly required: boolean;
  readonly sensitive: boolean;
  readonly multiline: boolean;
  readonly valueType: "text" | "csv";
  readonly itemCount: number | null;
  readonly inputType: "text" | "password" | "textarea";
}

export interface CrawlerConfigGroup {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly required: boolean;
  readonly mode: "all" | "any";
  readonly status: CrawlerConfigGroupStatus;
  readonly configuredCount: number;
  readonly totalCount: number;
  readonly fields: readonly CrawlerConfigField[];
}

export interface CrawlerPlatformConfig {
  readonly id: string;
  readonly label: string;
  readonly envExists: boolean;
  readonly envUpdatedAt: string | null;
  readonly status: CrawlerConfigStatus;
  readonly statusLabel: string;
  readonly configuredRequiredGroups: number;
  readonly totalRequiredGroups: number;
  readonly missingRequiredGroups: readonly string[];
  readonly groups: readonly CrawlerConfigGroup[];
  readonly notes: string;
}

export interface CrawlerConfigOverview {
  readonly serviceName: string;
  readonly generatedAt: string;
  readonly summary: {
    readonly platformCount: number;
    readonly readyCount: number;
    readonly partialCount: number;
    readonly missingEnvCount: number;
  };
  readonly platforms: readonly CrawlerPlatformConfig[];
}

interface FieldSpec {
  readonly id: string;
  readonly key: string;
  readonly label: string;
  readonly required?: boolean;
  readonly sensitive?: boolean;
  readonly multiline?: boolean;
  readonly valueType?: "text" | "csv";
}

interface GroupSpec {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly required?: boolean;
  readonly mode?: "all" | "any";
  readonly fields: readonly FieldSpec[];
}

interface PlatformSpec {
  readonly id: string;
  readonly label: string;
  readonly crawlerPath: string;
  readonly envPath: string;
  readonly notes: string;
  readonly groups: readonly GroupSpec[];
}

const AGENT_HUB_ROOT = getAgentHubRoot();
const CRAWLER_ROOT = process.env.CRAWLER_ROOT ?? join(AGENT_HUB_ROOT, "Crawler");
const CRAWLER_ENV_ROOT =
  process.env.CRAWLER_ENV_ROOT ?? join(AGENT_HUB_ROOT, "env", "Crawler_env");

const secretPattern = /(TOKEN|COOKIE|PASSWORD|SECRET|HASH|KEY|SESSION)/i;
const envKeyPattern = /^[A-Za-z_][A-Za-z0-9_]*$/;

export class CrawlerConfigError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "CrawlerConfigError";
    this.status = status;
  }
}

const PLATFORM_SPECS: readonly PlatformSpec[] = [
  {
    id: "x",
    label: "X",
    crawlerPath: join(CRAWLER_ROOT, "X"),
    envPath: join(CRAWLER_ENV_ROOT, "X_env"),
    notes: "X 智能体使用该配置登录 X 平台，自主发现热门推文、复核候选事件并抓取评论。",
    groups: [
      {
        id: "account",
        label: "账号 / Cookie",
        description: "用于注入登录态访问 X；Cookie 不会在页面中明文展示。",
        required: true,
        mode: "any",
        fields: [
          {
            id: "cookies",
            key: "TWITTER_COOKIES",
            label: "X Cookie",
            sensitive: true,
            multiline: true,
          },
          {
            id: "cookie",
            key: "X_COOKIE",
            label: "备用 X Cookie",
            required: false,
            sensitive: true,
            multiline: true,
          },
        ],
      },
      {
        id: "network",
        label: "网络代理",
        description: "用于 Playwright 浏览器访问 X；默认使用系统爬虫代理端口。",
        required: false,
        fields: [
          { id: "proxy", key: "X_PROXY", label: "X 代理", required: false, sensitive: true },
        ],
      },
      {
        id: "scope",
        label: "发现与评论范围",
        description: "控制自主发现、事件复核和评论抓取的单次上限。",
        required: false,
        fields: [
          { id: "discoverLimit", key: "X_DISCOVER_LIMIT", label: "自主发现条数", required: false },
          { id: "searchLimit", key: "X_SEARCH_LIMIT", label: "事件复核条数", required: false },
          {
            id: "commentsPerTweet",
            key: "X_COMMENTS_PER_TWEET",
            label: "每条推文评论数",
            required: false,
          },
          { id: "searchDays", key: "X_SEARCH_DAYS", label: "搜索时间范围（天）", required: false },
          {
            id: "discoveryStrategy",
            key: "X_DISCOVERY_STRATEGY",
            label: "自主发现策略",
            required: false,
          },
        ],
      },
    ],
  },
  {
    id: "facebook",
    label: "Facebook",
    crawlerPath: join(CRAWLER_ROOT, "Facebook"),
    envPath: join(CRAWLER_ENV_ROOT, "Facebook_env"),
    notes: "依赖 Facebook Cookie 进行页面抓取。",
    groups: [
      {
        id: "account",
        label: "账号 / Cookie",
        description: "用于访问 Facebook 页面内容。",
        required: true,
        fields: [
          {
            id: "cookie",
            key: "FACEBOOK_COOKIE",
            label: "Facebook Cookie",
            sensitive: true,
            multiline: true,
          },
        ],
      },
    ],
  },
  {
    id: "github",
    label: "GitHub",
    crawlerPath: join(CRAWLER_ROOT, "GitHub"),
    envPath: join(CRAWLER_ENV_ROOT, "GitHub_env"),
    notes: "依赖 GitHub Token 抓取仓库、话题和趋势。",
    groups: [
      {
        id: "account",
        label: "GitHub 访问",
        description: "用于调用 GitHub API 或提升抓取限额。",
        required: true,
        fields: [
          { id: "token", key: "GITHUB_TOKEN", label: "GitHub Token", sensitive: true },
        ],
      },
    ],
  },
  {
    id: "instagram",
    label: "instagram",
    crawlerPath: join(CRAWLER_ROOT, "instagram"),
    envPath: join(CRAWLER_ENV_ROOT, "instagram_env"),
    notes: "监控 Instagram / Threads，Instagram Cookie 为主，Threads Cookie 可选。",
    groups: [
      {
        id: "account",
        label: "账号 / Cookie",
        description: "用于登录和读取 Instagram / Threads 内容。",
        required: true,
        fields: [
          { id: "login", key: "INSTAGRAM_LOGIN", label: "登录账号" },
          {
            id: "cookie",
            key: "INSTAGRAM_COOKIE",
            label: "Instagram Cookie",
            sensitive: true,
            multiline: true,
          },
          {
            id: "threadsCookie",
            key: "THREADS_COOKIE",
            label: "Threads Cookie",
            required: false,
            sensitive: true,
            multiline: true,
          },
        ],
      },
    ],
  },
  {
    id: "lien",
    label: "Lien",
    crawlerPath: join(CRAWLER_ROOT, "Lien"),
    envPath: join(CRAWLER_ENV_ROOT, "Lien_env"),
    notes: "预留 LinkedIn/Lien 平台配置，账号字段为空时不可运行。",
    groups: [
      {
        id: "account",
        label: "LinkedIn 账号",
        description: "用于登录并抓取 LinkedIn/Lien 内容。",
        required: true,
        fields: [
          { id: "email", key: "LINKEDIN_EMAIL", label: "邮箱", required: false },
          { id: "username", key: "LINKEDIN_USERNAME", label: "用户名" },
          { id: "password", key: "LINKEDIN_PASSWORD", label: "密码", sensitive: true },
        ],
      },
    ],
  },
  {
    id: "lihkg",
    label: "Lihkg",
    crawlerPath: join(CRAWLER_ROOT, "Lihkg"),
    envPath: join(CRAWLER_ENV_ROOT, "Lihkg_env"),
    notes: "抓取 LIHKG 热门/分类帖子，Cookie 和分类配置齐全后可运行。",
    groups: [
      {
        id: "crawler",
        label: "抓取范围",
        description: "控制 LIHKG 抓取分类、页数和线程数量。",
        required: true,
        fields: [
          { id: "catId", key: "LIHKG_CAT_ID", label: "分类 ID" },
          { id: "types", key: "LIHKG_TYPES", label: "抓取类型" },
          { id: "listPages", key: "LIHKG_LIST_PAGES", label: "列表页数" },
          { id: "limitThreads", key: "LIHKG_LIMIT_THREADS", label: "线程数量限制" },
        ],
      },
      {
        id: "account",
        label: "Cookie / 代理",
        description: "Cookie 用于稳定访问，代理配置可降低请求风险。",
        required: true,
        fields: [
          {
            id: "cookie",
            key: "LIHKG_COOKIE",
            label: "LIHKG Cookie",
            sensitive: true,
            multiline: true,
          },
          { id: "proxy", key: "LIHKG_PROXY", label: "代理", required: false, sensitive: true },
        ],
      },
    ],
  },
  {
    id: "netlight",
    label: "NetLight",
    crawlerPath: join(CRAWLER_ROOT, "NetLight"),
    envPath: join(CRAWLER_ENV_ROOT, "NetLight_env"),
    notes: "抓取 Matrix/NetLight 房间消息。",
    groups: [
      {
        id: "account",
        label: "Matrix 账号",
        description: "用于连接 Matrix 房间并读取消息。",
        required: true,
        fields: [
          { id: "server", key: "MATRIX_SERVER", label: "Matrix 服务" },
          { id: "roomId", key: "MATRIX_ROOM_ID", label: "房间 ID" },
          { id: "username", key: "MATRIX_USERNAME", label: "用户名" },
          { id: "password", key: "MATRIX_PASSWORD", label: "密码", sensitive: true },
        ],
      },
    ],
  },
  {
    id: "ptt",
    label: "PTT",
    crawlerPath: join(CRAWLER_ROOT, "PTT"),
    envPath: join(CRAWLER_ENV_ROOT, "PTT_env"),
    notes: "抓取 PTT 看板最新内容；跨平台复核时由总控下发候选事件条件。",
    groups: [
      {
        id: "scope",
        label: "抓取范围",
        description: "用于指定 PTT 看板；未填写时使用爬虫默认看板范围。",
        required: false,
        fields: [
          { id: "boards", key: "PTT_BOARDS", label: "看板", required: false },
        ],
      },
    ],
  },
  {
    id: "telegram",
    label: "Telegram",
    crawlerPath: join(CRAWLER_ROOT, "Telegram"),
    envPath: join(CRAWLER_ENV_ROOT, "Telegram_env"),
    notes: "使用 Telegram API 和本地 session 读取指定群/频道。",
    groups: [
      {
        id: "account",
        label: "Telegram 账号",
        description: "用于连接 Telegram API 和复用登录会话。",
        required: true,
        fields: [
          { id: "apiId", key: "TELEGRAM_API_ID", label: "API 编号" },
          { id: "apiHash", key: "TELEGRAM_API_HASH", label: "API 凭证", sensitive: true },
          {
            id: "session",
            key: "TELEGRAM_SESSION",
            label: "登录会话",
            sensitive: true,
            multiline: true,
          },
          {
            id: "proxy",
            key: "TELEGRAM_PROXY",
            label: "代理",
            required: false,
            sensitive: true,
          },
        ],
      },
      {
        id: "scope",
        label: "抓取范围",
        description: "控制需要监控的 Telegram 对话。",
        required: true,
        fields: [
          {
            id: "dialogs",
            key: "TELEGRAM_PUSH_DIALOGS",
            label: "监控对话",
            multiline: true,
            valueType: "csv",
          },
        ],
      },
    ],
  },
  {
    id: "youtube",
    label: "YouTube",
    crawlerPath: join(CRAWLER_ROOT, "YouTube"),
    envPath: join(CRAWLER_ENV_ROOT, "YouTube_env"),
    notes: "抓取 YouTube 内容，Cookie 配置齐全后可运行。",
    groups: [
      {
        id: "account",
        label: "YouTube Cookie",
        description: "用于访问 YouTube 内容。",
        required: true,
        fields: [
          {
            id: "cookie",
            key: "YouTube_cookie",
            label: "YouTube Cookie",
            sensitive: true,
            multiline: true,
          },
        ],
      },
    ],
  },
];

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseEnvText(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  let currentKey = "";
  let currentValue = "";

  const flush = () => {
    if (!currentKey) return;
    values[currentKey] = unquote(currentValue.trim());
    currentKey = "";
    currentValue = "";
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const normalized = line.startsWith("export ") ? line.slice(7).trim() : line;
    const eq = normalized.indexOf("=");
    if (eq > 0) {
      flush();
      currentKey = normalized.slice(0, eq).trim();
      currentValue = normalized.slice(eq + 1).trim();
    } else if (currentKey) {
      currentValue += normalized;
    }
  }
  flush();
  return values;
}

function readEnv(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  try {
    return parseEnvText(readFileSync(path, "utf-8"));
  } catch {
    return {};
  }
}

function isSensitive(field: FieldSpec): boolean {
  return field.sensitive ?? secretPattern.test(field.key);
}

function fieldInputType(
  field: FieldSpec,
): CrawlerConfigField["inputType"] {
  if (field.multiline) return "textarea";
  if (isSensitive(field)) return "password";
  return "text";
}

function fieldValueType(field: FieldSpec): CrawlerConfigField["valueType"] {
  return field.valueType ?? "text";
}

function resolveField(env: Record<string, string>, field: FieldSpec): CrawlerConfigField {
  const value = env[field.key]?.trim() ?? "";
  const sensitive = isSensitive(field);
  const valueType = fieldValueType(field);
  return {
    id: field.id,
    label: field.label,
    configured: value.length > 0,
    required: field.required ?? true,
    sensitive,
    multiline: field.multiline ?? false,
    valueType,
    itemCount:
      valueType === "csv"
        ? value.split(",").map((item) => item.trim()).filter(Boolean).length
        : null,
    inputType: fieldInputType(field),
  };
}

function resolveGroup(env: Record<string, string>, group: GroupSpec): CrawlerConfigGroup {
  const fields = group.fields.map((field) => resolveField(env, field));
  const requiredFields = fields.filter((field) => field.required);
  const mode = group.mode ?? "all";
  const required = group.required ?? true;
  const configuredCount = requiredFields.filter((field) => field.configured).length;
  const totalCount = requiredFields.length;
  const ok =
    totalCount === 0 ||
    (mode === "any" ? configuredCount > 0 : configuredCount === totalCount);
  const partial = configuredCount > 0 && !ok;

  return {
    id: group.id,
    label: group.label,
    description: group.description,
    required,
    mode,
    status: ok ? "ok" : partial ? "partial" : "missing",
    configuredCount,
    totalCount,
    fields,
  };
}

function statusLabel(status: CrawlerConfigStatus): string {
  switch (status) {
    case "ready":
      return "已配置";
    case "partial":
      return "部分配置";
    case "missing-env":
      return "缺少 env 文件";
  }
}

function resolvePlatform(spec: PlatformSpec): CrawlerPlatformConfig {
  const envExists = existsSync(spec.envPath);
  const env = readEnv(spec.envPath);
  const groups = spec.groups.map((group) => resolveGroup(env, group));
  const requiredGroups = groups.filter((group) => group.required);
  const missingRequiredGroups = requiredGroups
    .filter((group) => group.status !== "ok")
    .map((group) => group.label);
  const configuredRequiredGroups = requiredGroups.length - missingRequiredGroups.length;
  const status: CrawlerConfigStatus = !envExists
    ? "missing-env"
    : missingRequiredGroups.length === 0
      ? "ready"
      : "partial";
  let envUpdatedAt: string | null = null;
  if (envExists) {
    try {
      envUpdatedAt = statSync(spec.envPath).mtime.toISOString();
    } catch {
      envUpdatedAt = null;
    }
  }

  return {
    id: spec.id,
    label: spec.label,
    envExists,
    envUpdatedAt,
    status,
    statusLabel: statusLabel(status),
    configuredRequiredGroups,
    totalRequiredGroups: requiredGroups.length,
    missingRequiredGroups,
    groups,
    notes: spec.notes,
  };
}

export function getCrawlerConfigOverview(): CrawlerConfigOverview {
  const platforms = PLATFORM_SPECS.map(resolvePlatform);
  return {
    serviceName: "AgentHub 爬虫配置中心",
    generatedAt: new Date().toISOString(),
    summary: {
      platformCount: platforms.length,
      readyCount: platforms.filter((platform) => platform.status === "ready").length,
      partialCount: platforms.filter((platform) => platform.status === "partial").length,
      missingEnvCount: platforms.filter((platform) => platform.status === "missing-env").length,
    },
    platforms,
  };
}

export function getCrawlerPlatformConfig(id: string): CrawlerPlatformConfig | null {
  return getCrawlerConfigOverview().platforms.find((platform) => platform.id === id) ?? null;
}

function findPlatformSpec(platformId: string): PlatformSpec | null {
  return PLATFORM_SPECS.find((platform) => platform.id === platformId) ?? null;
}

function findFieldSpec(
  platform: PlatformSpec,
  fieldId: string,
): FieldSpec | null {
  for (const group of platform.groups) {
    const field = group.fields.find((item) => item.id === fieldId);
    if (field) return field;
  }
  return null;
}

function requirePlatformSpec(platformId: string): PlatformSpec {
  const platform = findPlatformSpec(platformId);
  if (!platform) {
    throw new CrawlerConfigError("爬虫平台不存在", 404);
  }
  return platform;
}

function requireFieldSpec(platform: PlatformSpec, fieldId: string): FieldSpec {
  const field = findFieldSpec(platform, fieldId);
  if (!field) {
    throw new CrawlerConfigError("爬虫配置字段不存在", 404);
  }
  if (!envKeyPattern.test(field.key)) {
    throw new CrawlerConfigError("爬虫配置字段非法", 500);
  }
  return field;
}

function serializeEnvValue(value: string): string {
  if (value.length === 0) return "";
  if (/^[A-Za-z0-9_./:@%+=,;|-]+$/.test(value)) return value;
  return `"${value
    .replace(/\\/g, "\\\\")
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")
    .replace(/"/g, '\\"')}"`;
}

function writeEnvValues(envPath: string, updates: ReadonlyMap<string, string>): void {
  const existing = existsSync(envPath) ? readFileSync(envPath, "utf-8") : "";
  const newline = existing.includes("\r\n") ? "\r\n" : "\n";
  const lines = existing
    ? existing.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n$/, "").split("\n")
    : [];
  const seen = new Set<string>();

  const nextLines = lines.map((line) => {
    const match = /^(\s*(?:export\s+)?)([A-Za-z_][A-Za-z0-9_]*)(\s*=).*$/.exec(line);
    if (!match) return line;
    const key = match[2]!;
    if (!updates.has(key)) return line;
    seen.add(key);
    return `${match[1]}${key}${match[3]}${serializeEnvValue(updates.get(key) ?? "")}`;
  });

  for (const [key, value] of updates) {
    if (!seen.has(key)) {
      nextLines.push(`${key}=${serializeEnvValue(value)}`);
    }
  }

  mkdirSync(dirname(envPath), { recursive: true });
  writeFileSync(envPath, `${nextLines.join(newline)}${newline}`, "utf-8");
}

export function getCrawlerConfigField(
  platformId: string,
  fieldId: string,
): CrawlerConfigField {
  const platform = requirePlatformSpec(platformId);
  const field = requireFieldSpec(platform, fieldId);
  return resolveField(readEnv(platform.envPath), field);
}

export function setCrawlerConfigField(
  platformId: string,
  fieldId: string,
  value: string,
): CrawlerPlatformConfig {
  const platform = requirePlatformSpec(platformId);
  const field = requireFieldSpec(platform, fieldId);
  writeEnvValues(platform.envPath, new Map([[field.key, value]]));
  return resolvePlatform(platform);
}

export function clearCrawlerConfigField(
  platformId: string,
  fieldId: string,
): CrawlerPlatformConfig {
  return setCrawlerConfigField(platformId, fieldId, "");
}

export function setCrawlerPlatformConfig(
  platformId: string,
  fields: Readonly<Record<string, string>>,
): CrawlerPlatformConfig {
  const platform = requirePlatformSpec(platformId);
  const updates = new Map<string, string>();

  for (const [fieldId, value] of Object.entries(fields)) {
    const field = requireFieldSpec(platform, fieldId);
    updates.set(field.key, value);
  }

  if (updates.size === 0) {
    throw new CrawlerConfigError("没有提交任何爬虫配置字段");
  }

  writeEnvValues(platform.envPath, updates);
  return resolvePlatform(platform);
}
