import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { getAgentHubRoot } from "../../config/agenthub-root";
import type {
  KanPushChannel,
  KanPushOverview,
  KanPushRoute,
  KanPushRouteMutationInput,
  KanPushRouteStatus,
  KanPushTeam,
  KanPushTeamChannel,
  ResolvedKanPushRoute,
} from "./types";

interface PlatformSpec {
  readonly platform: string;
  readonly label: string;
  readonly envPath: string;
  readonly baseUrlKeys: readonly string[];
  readonly tokenKeys: readonly string[];
  readonly channelKeys: readonly string[];
  readonly sourceKeys?: readonly string[];
  readonly channelMapKeys?: readonly string[];
  readonly notes: string;
}

const AGENT_HUB_ROOT = getAgentHubRoot();
const CRAWLER_ENV_ROOT =
  process.env.CRAWLER_ENV_ROOT ?? join(AGENT_HUB_ROOT, "env", "Crawler_env");
const SOCIAL_FUSION_ENV_PATH =
  process.env.SOCIAL_FUSION_KAN_ENV ??
  join(CRAWLER_ENV_ROOT, "SocialFusion_env");

const DEFAULT_BASE_URL = "https://kan.cool";
const CHANNEL_NAME_CACHE_TTL_MS = 5 * 60_000;
export const SOCIAL_FUSION_KAN_ROUTE_ID = "social-fusion-kan";
export const SOCIAL_FUSION_KAN_PLATFORM = "social-fusion";

interface KanChannelResponse {
  readonly id?: string;
  readonly display_name?: string;
  readonly name?: string;
  readonly team_id?: string;
}

interface KanTeamResponse {
  readonly id?: string;
  readonly name?: string;
  readonly display_name?: string;
}

interface ChannelMetadata {
  readonly id: string;
  readonly name: string;
  readonly displayName: string;
  readonly teamId: string | null;
  readonly teamName: string | null;
  readonly teamDisplayName: string | null;
}

export class KanPushConfigError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "KanPushConfigError";
    this.status = status;
  }
}

const channelInfoCache = new Map<string, { readonly value: ChannelMetadata; readonly expiresAt: number }>();
const teamInfoCache = new Map<string, { readonly value: KanPushTeam; readonly expiresAt: number }>();

const PLATFORM_SPECS: readonly PlatformSpec[] = [
  {
    platform: "telegram",
    label: "Telegram",
    envPath: join(CRAWLER_ENV_ROOT, "Telegram_env"),
    baseUrlKeys: ["MATTERMOST_URL", "MATTERMOST_BASE_URL", "MATTERMOST_SERVER_URL"],
    tokenKeys: ["KAN_COOL_BOT_TOKEN", "MATTERMOST_TOKEN", "MATTERMOST_BOT_TOKEN"],
    channelKeys: ["MATTERMOST_CHANNEL_IDS", "MATTERMOST_CHANNEL_ID"],
    sourceKeys: ["TELEGRAM_PUSH_DIALOGS"],
    channelMapKeys: ["TELEGRAM_MATTERMOST_CHANNEL_MAP", "TELEGRAM_KAN_CHANNEL_MAP"],
    notes: "按 Telegram 群/频道聚合后推送，可使用来源到频道映射。",
  },
  {
    platform: "netlight",
    label: "NetLight / Matrix",
    envPath: join(CRAWLER_ENV_ROOT, "NetLight_env"),
    baseUrlKeys: ["MATTERMOST_BASE_URL", "MATTERMOST_URL", "MATTERMOST_SERVER_URL"],
    tokenKeys: ["KAN_COOL_BOT_TOKEN", "MATTERMOST_BOT_TOKEN", "MATTERMOST_TOKEN"],
    channelKeys: ["MATTERMOST_CHANNEL_ID", "MATTERMOST_CHANNEL_IDS"],
    sourceKeys: ["MATRIX_ROOM_ID", "MATRIX_SERVER"],
    notes: "Matrix 消息批量汇总后统一推送。",
  },
  {
    platform: "instagram",
    label: "Instagram / Threads",
    envPath: join(CRAWLER_ENV_ROOT, "instagram_env"),
    baseUrlKeys: ["MATTERMOST_URL", "MATTERMOST_BASE_URL", "MATTERMOST_SERVER_URL"],
    tokenKeys: ["KAN_COOL_BOT_TOKEN", "MATTERMOST_BOT_TOKEN", "MATTERMOST_TOKEN"],
    channelKeys: ["MATTERMOST_CHANNEL_IDS", "MATTERMOST_CHANNEL_ID"],
    sourceKeys: ["INSTAGRAM_LOGIN"],
    notes: "Instagram 话题和 Threads 用户监控命中后推送。",
  },
  {
    platform: "facebook",
    label: "Facebook",
    envPath: join(CRAWLER_ENV_ROOT, "Facebook_env"),
    baseUrlKeys: ["MATTERMOST_URL", "MATTERMOST_BASE_URL", "MATTERMOST_SERVER_URL"],
    tokenKeys: ["KAN_COOL_BOT_TOKEN", "MATTERMOST_BOT_TOKEN", "MATTERMOST_TOKEN"],
    channelKeys: ["MATTERMOST_CHANNEL_IDS", "MATTERMOST_CHANNEL_ID"],
    notes: "Facebook 页面事件复核命中后推送。",
  },
  {
    platform: "lihkg",
    label: "LIHKG",
    envPath: join(CRAWLER_ENV_ROOT, "Lihkg_env"),
    baseUrlKeys: ["MATTERMOST_URL", "MATTERMOST_BASE_URL", "MATTERMOST_SERVER_URL"],
    tokenKeys: ["KAN_COOL_BOT_TOKEN", "MATTERMOST_TOKEN", "MATTERMOST_BOT_TOKEN"],
    channelKeys: ["MATTERMOST_CHANNEL_ID", "MATTERMOST_CHANNEL_IDS"],
    sourceKeys: ["LIHKG_TYPES", "LIHKG_CAT_ID"],
    notes: "LIHKG 热门主题或指定分类命中后推送。",
  },
  {
    platform: "github",
    label: "GitHub",
    envPath: join(CRAWLER_ENV_ROOT, "GitHub_env"),
    baseUrlKeys: ["MATTERMOST_SERVER_URL", "MATTERMOST_URL", "MATTERMOST_BASE_URL"],
    tokenKeys: ["KAN_COOL_BOT_TOKEN", "MATTERMOST_BOT_TOKEN", "MATTERMOST_TOKEN"],
    channelKeys: ["MATTERMOST_CHANNEL_ID", "MATTERMOST_CHANNEL_IDS"],
    sourceKeys: ["GITHUB_SEARCH_TYPES"],
    notes: "GitHub 港澳台相关监控和待确认结果推送。",
  },
  {
    platform: "ptt",
    label: "PTT",
    envPath: join(CRAWLER_ENV_ROOT, "PTT_env"),
    baseUrlKeys: ["MATTERMOST_SERVER_URL", "MATTERMOST_URL", "MATTERMOST_BASE_URL"],
    tokenKeys: ["KAN_COOL_BOT_TOKEN", "MATTERMOST_BOT_TOKEN", "MATTERMOST_TOKEN"],
    channelKeys: ["MATTERMOST_CHANNEL_ID", "MATTERMOST_CHANNEL_IDS"],
    sourceKeys: ["PTT_BOARDS"],
    notes: "PTT 看板文章分析命中后推送。",
  },
  {
    platform: "youtube",
    label: "YouTube",
    envPath: join(CRAWLER_ENV_ROOT, "YouTube_env"),
    baseUrlKeys: ["MATTERMOST_URL", "MATTERMOST_BASE_URL", "MATTERMOST_SERVER_URL"],
    tokenKeys: ["KAN_COOL_BOT_TOKEN", "MATTERMOST_BOT_TOKEN", "MATTERMOST_TOKEN"],
    channelKeys: ["MATTERMOST_CHANNEL_IDS", "MATTERMOST_CHANNEL_ID"],
    notes: "YouTube avtdl 插件推送，频道通常来自 avtdl 配置。",
  },
  {
    platform: "lien",
    label: "Lien",
    envPath: join(CRAWLER_ENV_ROOT, "Lien_env"),
    baseUrlKeys: ["MATTERMOST_URL", "MATTERMOST_BASE_URL", "MATTERMOST_SERVER_URL"],
    tokenKeys: ["KAN_COOL_BOT_TOKEN", "MATTERMOST_BOT_TOKEN", "MATTERMOST_TOKEN"],
    channelKeys: ["MATTERMOST_CHANNEL_IDS", "MATTERMOST_CHANNEL_ID"],
    notes: "预留平台，当前配置为空时页面会标记为未就绪。",
  },
  {
    platform: SOCIAL_FUSION_KAN_PLATFORM,
    label: "社交融合总控",
    envPath: SOCIAL_FUSION_ENV_PATH,
    baseUrlKeys: ["SOCIAL_FUSION_KAN_BASE_URL", "MATTERMOST_URL", "MATTERMOST_BASE_URL"],
    tokenKeys: [
      "SOCIAL_FUSION_KAN_BOT_TOKEN",
      "KAN_COOL_BOT_TOKEN",
      "MATTERMOST_BOT_TOKEN",
      "MATTERMOST_TOKEN",
    ],
    channelKeys: ["SOCIAL_FUSION_KAN_CHANNEL_IDS", "SOCIAL_FUSION_KAN_CHANNEL_ID"],
    sourceKeys: ["SOCIAL_FUSION_KAN_SOURCE_LABELS"],
    notes: "Social Fusion Agent 达到跨平台阈值后统一推送的总频道，不属于单个平台爬虫路由。",
  },
];

export function parseEnvText(text: string): Record<string, string> {
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

function unquote(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function readEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  try {
    return parseEnvText(readFileSync(path, "utf-8"));
  } catch {
    return {};
  }
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

function valueFor(env: Record<string, string>, keys: readonly string[]): {
  readonly key: string | null;
  readonly value: string;
} {
  for (const key of keys) {
    const processValue = process.env[key]?.trim();
    if (processValue) return { key, value: processValue };
    const envValue = env[key]?.trim();
    if (envValue) return { key, value: envValue };
  }
  return { key: null, value: "" };
}

function parseCsv(value: string | undefined): readonly string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseChannelMap(raw: string): Record<string, readonly string[]> {
  const map: Record<string, readonly string[]> = {};
  for (const pair of raw.split(/[;\n]/)) {
    const text = pair.trim();
    if (!text) continue;
    const sep = text.includes("=") ? "=" : ":";
    const index = text.indexOf(sep);
    if (index <= 0) continue;
    const key = text.slice(0, index).trim();
    const channels = parseCsv(text.slice(index + 1));
    if (key && channels.length > 0) map[key] = channels;
  }
  return map;
}

function routeStatus(
  tokenConfigured: boolean,
  channelIds: readonly string[],
): KanPushRouteStatus {
  if (!tokenConfigured) return "missing-token";
  if (channelIds.length === 0) return "missing-channel";
  return "ready";
}

function fallbackChannelName(channelId: string): string {
  return `Kan 频道 ${channelId.slice(0, 8)}`;
}

function fallbackChannelMetadata(channelId: string): ChannelMetadata {
  return {
    id: channelId,
    name: channelId,
    displayName: fallbackChannelName(channelId),
    teamId: null,
    teamName: null,
    teamDisplayName: null,
  };
}

async function fetchJson<T>(
  url: string,
  token: string,
): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2_000);
  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchTeamInfo(
  baseUrl: string,
  token: string,
  teamId: string,
): Promise<KanPushTeam | null> {
  const cacheKey = `${baseUrl}|${teamId}`;
  const cached = teamInfoCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const team = await fetchJson<KanTeamResponse>(
    `${baseUrl}/api/v4/teams/${teamId}`,
    token,
  );
  if (!team?.id) return null;

  const value: KanPushTeam = {
    id: team.id,
    name: team.name ?? team.id,
    displayName: team.display_name || team.name || team.id,
    baseUrl,
    channels: [],
  };
  teamInfoCache.set(cacheKey, {
    value,
    expiresAt: Date.now() + CHANNEL_NAME_CACHE_TTL_MS,
  });
  return value;
}

async function fetchChannelMetadata(
  route: ResolvedKanPushRoute,
  channelId: string,
): Promise<ChannelMetadata> {
  if (!route.token) return fallbackChannelMetadata(channelId);
  const cacheKey = `${route.baseUrl}|${channelId}`;
  const cached = channelInfoCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const body = await fetchJson<KanChannelResponse>(
    `${route.baseUrl}/api/v4/channels/${channelId}`,
    route.token,
  );
  if (!body?.id) return fallbackChannelMetadata(channelId);

  const team = body.team_id
    ? await fetchTeamInfo(route.baseUrl, route.token, body.team_id)
    : null;
  const value: ChannelMetadata = {
    id: body.id,
    name: body.name ?? body.id,
    displayName: body.display_name || body.name || fallbackChannelName(body.id),
    teamId: body.team_id ?? null,
    teamName: team?.name ?? null,
    teamDisplayName: team?.displayName ?? null,
  };
  channelInfoCache.set(cacheKey, {
    value,
    expiresAt: Date.now() + CHANNEL_NAME_CACHE_TTL_MS,
  });
  return value;
}

async function resolveChannelMetadata(
  routes: readonly ResolvedKanPushRoute[],
): Promise<ReadonlyMap<string, ChannelMetadata>> {
  const entries = await Promise.all(
    routes.flatMap((route) =>
      route.channelIds.map(async (channelId) => {
        const metadata = await fetchChannelMetadata(route, channelId);
        return [`${route.baseUrl}|${channelId}`, metadata] as const;
      }),
    ),
  );
  return new Map(entries);
}

async function fetchTeamsForRoute(route: ResolvedKanPushRoute): Promise<readonly KanPushTeam[]> {
  if (!route.token) return [];
  const teams = await fetchJson<KanTeamResponse[]>(
    `${route.baseUrl}/api/v4/users/me/teams`,
    route.token,
  );
  if (!Array.isArray(teams)) return [];

  const resolved = await Promise.all(
    teams
      .filter((team): team is Required<Pick<KanTeamResponse, "id">> & KanTeamResponse =>
        Boolean(team.id),
      )
      .map(async (team) => {
        const channels = await fetchJson<KanChannelResponse[]>(
          `${route.baseUrl}/api/v4/users/me/teams/${team.id}/channels`,
          route.token!,
        );
        const teamName = team.name ?? team.id;
        const teamDisplayName = team.display_name || team.name || team.id;
        const normalizedChannels: KanPushTeamChannel[] = Array.isArray(channels)
          ? channels
              .filter((channel): channel is Required<Pick<KanChannelResponse, "id">> & KanChannelResponse =>
                Boolean(channel.id),
              )
              .map((channel) => ({
                id: channel.id,
                name: channel.name ?? channel.id,
                displayName: channel.display_name || channel.name || fallbackChannelName(channel.id),
                teamId: team.id,
                teamName,
                teamDisplayName,
                baseUrl: route.baseUrl,
              }))
          : [];
        return {
          id: team.id,
          name: teamName,
          displayName: teamDisplayName,
          baseUrl: route.baseUrl,
          channels: normalizedChannels.sort((a, b) =>
            a.displayName.localeCompare(b.displayName),
          ),
        } satisfies KanPushTeam;
      }),
  );
  return resolved.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

async function resolveTeams(routes: readonly ResolvedKanPushRoute[]): Promise<readonly KanPushTeam[]> {
  const uniqueRoutes = new Map<string, ResolvedKanPushRoute>();
  for (const route of routes) {
    if (route.token) uniqueRoutes.set(`${route.baseUrl}|${route.token}`, route);
  }
  const teams = (await Promise.all([...uniqueRoutes.values()].map(fetchTeamsForRoute))).flat();
  const deduped = new Map<string, KanPushTeam>();
  for (const team of teams) {
    deduped.set(`${team.baseUrl}|${team.id}`, team);
  }
  return [...deduped.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
}

function buildRoute(spec: PlatformSpec): ResolvedKanPushRoute {
  const env = readEnvFile(spec.envPath);
  const baseUrl = valueFor(env, spec.baseUrlKeys).value || DEFAULT_BASE_URL;
  const token = valueFor(env, spec.tokenKeys);
  const channels = valueFor(env, spec.channelKeys);
  const sourceLabels =
    spec.sourceKeys
      ?.flatMap((key) => parseCsv(process.env[key] ?? env[key]))
      .filter(Boolean) ?? [];
  const channelMapRaw =
    spec.channelMapKeys
      ?.map((key) => process.env[key] ?? env[key] ?? "")
      .find((value) => value.trim()) ?? "";
  const channelMap = parseChannelMap(channelMapRaw);
  const mappedChannels = Object.values(channelMap).flat();
  const channelIds = [...new Set([...parseCsv(channels.value), ...mappedChannels])];
  const status = routeStatus(Boolean(token.value), channelIds);

  return {
    id: routeIdForSpec(spec),
    platform: spec.platform,
    platformLabel: spec.label,
    baseUrl: baseUrl.replace(/\/+$/, ""),
    token: token.value || null,
    tokenConfigured: Boolean(token.value),
    channelIds,
    channelNames: channelIds.map(fallbackChannelName),
    sourceLabels: sourceLabels.length > 0 ? sourceLabels : ["默认来源"],
    channelMap,
    status,
    notes: spec.notes,
  };
}

function routeIdForSpec(spec: PlatformSpec): string {
  return spec.platform === SOCIAL_FUSION_KAN_PLATFORM
    ? SOCIAL_FUSION_KAN_ROUTE_ID
    : `${spec.platform}-kan`;
}

function publicRoute(
  route: ResolvedKanPushRoute,
  channelMetadata: ReadonlyMap<string, ChannelMetadata>,
): KanPushRoute {
  const { token: _token, ...safe } = route;
  return {
    ...safe,
    channelNames: route.channelIds.map(
      (channelId) =>
        channelMetadata.get(`${route.baseUrl}|${channelId}`)?.displayName ??
        fallbackChannelName(channelId),
    ),
  };
}

function buildChannels(routes: readonly KanPushRoute[]): readonly KanPushChannel[] {
  const channels = new Map<string, KanPushChannel>();
  for (const route of routes) {
    for (const [index, channelId] of route.channelIds.entries()) {
      const key = `${route.baseUrl}|${channelId}`;
      const existing = channels.get(key);
      const status = !route.tokenConfigured
        ? "缺少令牌"
        : route.status === "missing-channel"
          ? "缺少频道"
          : "已配置";
      if (existing) {
        channels.set(key, {
          ...existing,
          routeIds: [...new Set([...existing.routeIds, route.id])],
          platformLabels: [...new Set([...existing.platformLabels, route.platformLabel])],
          tokenConfigured: existing.tokenConfigured || route.tokenConfigured,
          status: existing.status === "已配置" ? existing.status : status,
        });
      } else {
        const metadata = {
          ...fallbackChannelMetadata(channelId),
          displayName: route.channelNames[index] ?? fallbackChannelName(channelId),
        };
        channels.set(key, {
          id: channelId,
          baseUrl: route.baseUrl,
          displayName: metadata.displayName,
          teamId: metadata.teamId,
          teamName: metadata.teamName,
          teamDisplayName: metadata.teamDisplayName,
          routeIds: [route.id],
          platformLabels: [route.platformLabel],
          tokenConfigured: route.tokenConfigured,
          status,
        });
      }
    }
  }
  return [...channels.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function getResolvedKanPushRoutes(): readonly ResolvedKanPushRoute[] {
  return PLATFORM_SPECS.map(buildRoute);
}

function findPlatformSpec(input: {
  readonly platform?: string;
  readonly routeId?: string;
}): PlatformSpec | null {
  if (input.routeId) {
    return PLATFORM_SPECS.find((spec) => routeIdForSpec(spec) === input.routeId) ?? null;
  }
  if (input.platform) {
    const platform = input.platform.toLowerCase();
    return PLATFORM_SPECS.find((spec) => spec.platform === platform) ?? null;
  }
  return null;
}

function requirePlatformSpec(input: {
  readonly platform?: string;
  readonly routeId?: string;
}): PlatformSpec {
  const spec = findPlatformSpec(input);
  if (!spec) {
    throw new KanPushConfigError("Kan 推送平台路由不存在", 404);
  }
  return spec;
}

function normalizeChannelIds(channelIds: readonly string[]): readonly string[] {
  return [...new Set(channelIds.map((item) => item.trim()).filter(Boolean))];
}

export async function saveKanPushRouteConfig(
  input: KanPushRouteMutationInput,
): Promise<KanPushOverview> {
  const spec = requirePlatformSpec(input);
  const channelIds = normalizeChannelIds(input.channelIds);
  if (channelIds.length === 0) {
    throw new KanPushConfigError("至少需要选择或填写一个 Kan 频道");
  }

  const updates = new Map<string, string>();
  const baseUrl = input.baseUrl?.trim().replace(/\/+$/, "");
  if (baseUrl) {
    updates.set(spec.baseUrlKeys[0]!, baseUrl);
    for (const key of spec.baseUrlKeys.slice(1)) updates.set(key, "");
  }

  const botToken = input.botToken?.trim();
  if (botToken) {
    updates.set(spec.tokenKeys[0]!, botToken);
    for (const key of spec.tokenKeys.slice(1)) updates.set(key, "");
  }

  updates.set(spec.channelKeys[0]!, channelIds.join(","));
  for (const key of spec.channelKeys.slice(1)) updates.set(key, "");
  for (const key of spec.channelMapKeys ?? []) updates.set(key, "");

  writeEnvValues(spec.envPath, updates);
  channelInfoCache.clear();
  teamInfoCache.clear();
  return getKanPushOverview();
}

export async function deleteKanPushRouteConfig(routeId: string): Promise<KanPushOverview> {
  const spec = requirePlatformSpec({ routeId });
  const updates = new Map<string, string>();
  for (const key of spec.channelKeys) updates.set(key, "");
  for (const key of spec.channelMapKeys ?? []) updates.set(key, "");
  for (const key of spec.tokenKeys) updates.set(key, "");
  writeEnvValues(spec.envPath, updates);
  channelInfoCache.clear();
  teamInfoCache.clear();
  return getKanPushOverview();
}

export async function getKanPushOverview(): Promise<KanPushOverview> {
  const resolvedRoutes = getResolvedKanPushRoutes();
  const [channelMetadata, teams] = await Promise.all([
    resolveChannelMetadata(resolvedRoutes),
    resolveTeams(resolvedRoutes),
  ]);
  const routes = resolvedRoutes.map((route) => publicRoute(route, channelMetadata));
  const baseUrls = [...new Set(routes.map((route) => route.baseUrl))];
  const channels = buildChannels(routes).map((channel) => {
    const metadata =
      channelMetadata.get(`${channel.baseUrl}|${channel.id}`) ??
      fallbackChannelMetadata(channel.id);
    return {
      ...channel,
      displayName: metadata.displayName,
      teamId: metadata.teamId,
      teamName: metadata.teamName,
      teamDisplayName: metadata.teamDisplayName,
    };
  });
  return {
    serviceName: "AgentHub Kan 推送中心",
    generatedAt: new Date().toISOString(),
    summary: {
      routeCount: routes.length,
      readyRouteCount: routes.filter((route) => route.status === "ready").length,
      channelCount: channels.length,
      teamCount: teams.length,
      configuredTokenCount: routes.filter((route) => route.tokenConfigured).length,
      baseUrls,
    },
    routes,
    channels,
    teams,
    platforms: PLATFORM_SPECS.map((spec) => ({
      id: spec.platform,
      label: spec.label,
    })),
  };
}

export function findKanPushRoute(
  routeId?: string,
  platform?: string,
): ResolvedKanPushRoute | null {
  const routes = getResolvedKanPushRoutes();
  if (routeId) {
    const route = routes.find((item) => item.id === routeId);
    if (route) return route;
  }
  if (platform) {
    const normalized = platform.toLowerCase();
    return routes.find((item) => item.platform === normalized) ?? null;
  }
  return routes.find((item) => item.status === "ready") ?? null;
}
