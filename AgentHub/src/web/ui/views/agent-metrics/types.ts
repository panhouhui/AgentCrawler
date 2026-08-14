// ============================================================================
// AgentMetrics — shared types and constants
// ============================================================================

export interface AgentUsage {
  readonly agentId: string;
  readonly totalInputTokens: number;
  readonly totalOutputTokens: number;
  readonly totalCacheReadTokens: number;
  readonly totalCacheCreationTokens: number;
  readonly totalCostUsd: number;
  readonly requestCount: number;
}

export interface ModelUsage {
  readonly model: string;
  readonly totalInputTokens: number;
  readonly totalOutputTokens: number;
  readonly totalCacheReadTokens: number;
  readonly totalCacheCreationTokens: number;
  readonly totalCostUsd: number;
  readonly requestCount: number;
}

export interface TimePoint {
  readonly bucket: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheCreationTokens: number;
  readonly costUsd: number;
  readonly requestCount: number;
}

export interface RecentRecord {
  readonly id: string;
  readonly agentId: string;
  readonly model: string;
  readonly provider: string;
  readonly channel: string;
  readonly source: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheCreationTokens: number;
  readonly costUsd: number;
  readonly durationMs: number;
  readonly toolUseCount: number;
  readonly createdAt: number;
}

export interface CronJob {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly payload: { readonly agentId?: string; readonly message?: string };
  readonly nextRunAt: number | null;
  readonly lastRunAt: number | null;
  readonly lastStatus: string | null;
  readonly lastError: string | null;
}

// ============================================================================
// Constants
// ============================================================================

export const RANGES = [
  { id: "24h", label: "24 小时", seconds: 86400 },
  { id: "7d", label: "7 天", seconds: 7 * 86400 },
  { id: "30d", label: "30 天", seconds: 30 * 86400 },
  { id: "all", label: "全部", seconds: 0 },
] as const;

export type RangeId = (typeof RANGES)[number]["id"];

export const AGENT_COLORS = [
  "#a78bfa", "#2dd4bf", "#f59e0b", "#f472b6", "#3b82f6",
  "#ef4444", "#06b6d4", "#84cc16", "#f97316", "#6366f1",
] as const;

export const MODEL_COLORS = [
  "#3b82f6", "#8b5cf6", "#06b6d4", "#10b981",
  "#f97316", "#ec4899", "#ef4444", "#84cc16",
] as const;

export const TOOLTIP_STYLE = {
  backgroundColor: "rgba(16, 19, 26, 0.95)",
  borderColor: "rgba(255,255,255,0.08)",
  borderWidth: 1,
  textStyle: { color: "#b0b0b8", fontSize: 12, fontFamily: "'JetBrains Mono', monospace" },
  extraCssText: "border-radius:8px;box-shadow:0 8px 32px rgba(0,0,0,0.3);",
} as const;

export const AXIS_LABEL = {
  color: "#454550",
  fontSize: 11,
  fontFamily: "'JetBrains Mono', monospace",
} as const;

export const AGENT_DISPLAY_NAMES: Record<string, string> = {
  "china-relevance-gate": "中国相关性与风险判断智能体",
  "x-social-agent": "X 社交智能体",
  "telegram-social-agent": "Telegram 社交智能体",
  "lihkg-social-agent": "LIHKG 社交智能体",
  "facebook-social-agent": "Facebook 社交智能体",
  "github-social-agent": "GitHub 社交智能体",
  "instagram-social-agent": "Instagram 社交智能体",
  "lien-social-agent": "Lien 社交智能体",
  "netlight-social-agent": "NetLight 社交智能体",
  "ptt-social-agent": "PTT 社交智能体",
  "youtube-social-agent": "YouTube 社交智能体",
  "social-fusion-agent": "社交融合总控智能体",
  default: "默认智能体",
};

export const SOURCE_DISPLAY_NAMES: Record<string, string> = {
  preview: "预览",
  chat: "对话",
  cron: "定时任务",
  "社交融合": "社交融合",
};

export function agentDisplayName(agentId: string): string {
  return AGENT_DISPLAY_NAMES[agentId] ?? agentId;
}

export function sourceDisplayName(source: string): string {
  return SOURCE_DISPLAY_NAMES[source] ?? source;
}

export function modelDisplayName(model: string): string {
  if (model.toLowerCase().includes("minimax")) return model.replace(/-/g, " ");
  if (model.toLowerCase().includes("claude")) return `Claude ${model.replace(/^claude-/, "").replace(/-/g, " ")}`;
  return model;
}

export const SPLIT_LINE = {
  lineStyle: { color: "#1e1e24", type: "dashed" as const, opacity: 0.5 },
} as const;

// ============================================================================
// Helpers
// ============================================================================

export function sinceEpoch(rangeId: string): number | undefined {
  const range = RANGES.find((r) => r.id === rangeId);
  if (!range || range.seconds === 0) return undefined;
  return Math.floor(Date.now() / 1000) - range.seconds;
}
