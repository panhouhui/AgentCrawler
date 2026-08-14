import React, { useCallback, useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Bot,
  CheckCircle,
  Clock,
  Cpu,
  Database,
  DollarSign,
  Key,
  MessageCircle,
  Send,
  Shield,
  Timer,
  Users,
  XCircle,
  Zap,
} from "lucide-react";
import { apiFetch, clearToken, getToken, setToken } from "../api";
import { AppLogo, Button, Input } from "../components";
import { useSystemEvents } from "../hooks/useSystemEvents";
import { cn } from "../lib/cn";
import { formatCost, formatCountdown, formatNumber, formatUptime } from "../lib/format";

interface ChannelInfo {
  status: string;
  type: string;
}

interface StatusData {
  uptime: number;
  authEnabled: boolean;
  version: string;
  sessions: number;
  channels: Record<string, ChannelInfo>;
}

interface UsageSummary {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheCreationTokens: number;
  totalCostUsd: number;
  totalRequests: number;
}

interface CronStatus {
  running: boolean;
  jobCount: number;
  nextDueAt: number | null;
}

interface ProcessHealth {
  name: string;
  status: "alive" | "stale" | "dead";
  uptimeSeconds: number;
  restartCount?: number;
}

interface MemoryStats {
  totalSources: number;
  totalChunks: number;
  totalTokens: number;
  agentsWithMemory: number;
}

interface AgentItem {
  id: string;
  name: string;
}

type SystemStatus = "online" | "partial" | "offline" | "loading";

function deriveStatus(
  status: StatusData | null,
  channelEntries: [string, ChannelInfo][],
  processes: readonly ProcessHealth[] | null,
  cron: CronStatus | null,
): { label: string; variant: SystemStatus; connectedCount: number } {
  if (!status) return { label: "加载中", variant: "loading", connectedCount: 0 };

  const connectedCount = channelEntries.filter(
    ([, value]) => value.status === "connected",
  ).length;

  if (processes && processes.length > 0) {
    const criticalNames = new Set(["core", "web"]);
    const criticalProcesses = processes.filter((process) =>
      criticalNames.has(process.name.toLowerCase()),
    );
    const processScope = criticalProcesses.length > 0 ? criticalProcesses : processes;
    const aliveCount = processScope.filter((process) => process.status === "alive").length;

    if (aliveCount === processScope.length) {
      return { label: "系统运行正常", variant: "online", connectedCount };
    }
    if (aliveCount > 0) {
      return { label: "部分进程异常", variant: "partial", connectedCount };
    }
    return { label: "关键进程离线", variant: "offline", connectedCount };
  }

  if (cron && !cron.running) {
    return { label: "调度器未运行", variant: "partial", connectedCount };
  }

  return { label: "系统在线", variant: "online", connectedCount };
}

function statusText(variant: SystemStatus): string {
  if (variant === "online") return "运行正常";
  if (variant === "partial") return "需要关注";
  if (variant === "offline") return "离线";
  return "加载中";
}

function uptimePercent(uptimeSeconds: number): number {
  const maxDisplay = 30 * 24 * 3600;
  return Math.min((uptimeSeconds / maxDisplay) * 100, 100);
}

function formatVersionLabel(version: string): string {
  if (!version) return "未知版本";
  return version === "preview" ? "预览版" : `v${version}`;
}

function formatChannelName(name: string): string {
  const cleaned = name.replace(/^Agent:/i, "").trim();
  return cleaned || "未命名渠道";
}

const PROCESS_LABELS: Record<string, string> = {
  core: "核心服务",
  web: "前端服务",
  cron: "定时任务",
  ingestion: "采集进程",
  sige: "情报分析",
};

function processLabel(name: string): string {
  return PROCESS_LABELS[name.toLowerCase()] ?? name;
}

function processStatusLabel(status: ProcessHealth["status"]): string {
  if (status === "alive") return "健康";
  if (status === "stale") return "延迟";
  return "离线";
}

export default function Overview() {
  const [status, setStatus] = useState<StatusData | null>(null);
  const [error, setError] = useState("");
  const [tokenInput, setTokenInput] = useState("");
  const [tokenMsg, setTokenMsg] = useState("");
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [agents, setAgents] = useState<readonly AgentItem[] | null>(null);
  const [processes, setProcesses] = useState<readonly ProcessHealth[] | null>(null);
  const [cron, setCron] = useState<CronStatus | null>(null);
  const [memory, setMemory] = useState<MemoryStats | null>(null);

  const handleSystemEvent = useCallback(
    (event: { type: string; data: Record<string, unknown> }) => {
      if (event.type === "status") {
        setStatus(event.data as unknown as StatusData);
        setError("");
      }
    },
    [],
  );

  const { connected: wsConnected } = useSystemEvents(handleSystemEvent);

  const fetchStatus = useCallback(async () => {
    try {
      const data = await apiFetch<StatusData>("/api/status");
      setStatus(data);
      setError("");
    } catch {
      setError("连接系统失败，请确认服务正在运行。");
    }
  }, []);

  const fetchExtras = useCallback(async (signal: AbortSignal) => {
    const results = await Promise.allSettled([
      apiFetch<{ success: boolean; data: UsageSummary }>("/api/usage/summary", { signal }),
      apiFetch<{ success: boolean; data: readonly AgentItem[] }>("/api/agents", { signal }),
      apiFetch<{ data: readonly ProcessHealth[] }>("/api/processes", { signal }),
      apiFetch<{ success: boolean; data: CronStatus }>("/api/cron/status", { signal }),
      apiFetch<{ success: boolean; data: MemoryStats }>("/api/memory/debug/stats", { signal }),
    ]);

    if (signal.aborted) return;
    if (results[0].status === "fulfilled") setUsage(results[0].value.data);
    if (results[1].status === "fulfilled") setAgents(results[1].value.data);
    if (results[2].status === "fulfilled") setProcesses(results[2].value.data);
    if (results[3].status === "fulfilled") setCron(results[3].value.data);
    if (results[4].status === "fulfilled") setMemory(results[4].value.data);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void fetchStatus();
    void fetchExtras(controller.signal);

    if (!wsConnected) {
      const interval = setInterval(fetchStatus, 10000);
      return () => {
        clearInterval(interval);
        controller.abort();
      };
    }

    return () => controller.abort();
  }, [fetchStatus, fetchExtras, wsConnected]);

  async function handleTokenSave(event: React.FormEvent) {
    event.preventDefault();
    if (!tokenInput.trim()) return;

    setToken(tokenInput.trim());
    try {
      await apiFetch<StatusData>("/api/status");
      setTokenMsg("令牌已保存。");
      setTokenInput("");
      void fetchExtras(new AbortController().signal);
    } catch {
      clearToken();
      setTokenMsg("令牌无效，请重新输入。");
    }
  }

  const channelEntries = status ? Object.entries(status.channels) : [];
  const { label: statusLabel, variant: statusVariant, connectedCount } =
    deriveStatus(status, channelEntries, processes, cron);

  const aliveProcesses = processes?.filter((process) => process.status === "alive").length ?? 0;
  const totalProcesses = processes?.length ?? 0;
  const totalTokens = usage
    ? usage.totalInputTokens + usage.totalOutputTokens
    : null;

  return (
    <div className="ov-root">
      <section className="ov-hero" aria-label="AgentHub 总览">
        <div className="ov-hero-main">
          <div className={`ov-brand-mark ov-brand-mark--${statusVariant}`}>
            <AppLogo size="hero" />
            <span className={`ov-brand-pulse ov-brand-pulse--${statusVariant}`} />
          </div>

          <div className="ov-hero-copy">
            <div className="ov-kicker">
              <Activity size={14} />
              智能体运行中枢
            </div>
            <h2 className="ov-title" data-no-localize="true">
              AgentHub
            </h2>
            <p className="ov-subtitle">
              聚合爬虫、社交智能体、Kan 推送和系统调度状态。
            </p>
            <div className={`ov-hero-badge ov-hero-badge--${statusVariant}`}>
              <span className={`ov-hero-dot ov-hero-dot--${statusVariant}`} />
              {statusLabel}
            </div>
          </div>
        </div>

        <div className="ov-hero-stats">
          <MetricTile
            label="版本"
            value={status ? formatVersionLabel(status.version) : "-"}
            icon={<Shield size={16} />}
          />
          <MetricTile
            label="会话"
            value={status ? String(status.sessions) : "-"}
            icon={<Users size={16} />}
          />
          <MetricTile
            label="连接方式"
            value={wsConnected ? "实时" : "轮询"}
            icon={<Zap size={16} />}
          />
        </div>
      </section>

      {error && (
        <div className="ov-error" role="alert">
          {error}
        </div>
      )}

      <section className="ov-grid ov-grid--primary" aria-label="关键状态">
        <article className="ov-card ov-card--status">
          <CardLabel icon={<Zap size={14} />} label="系统状态" />
          <div className="ov-status-row">
            <span className={`ov-status-dot ov-status-dot--${statusVariant}`} />
            <span className="ov-card-value">{status ? statusText(statusVariant) : "-"}</span>
          </div>
          <p className="ov-card-meta">
            {processes && totalProcesses > 0
              ? `${aliveProcesses}/${totalProcesses} 个进程健康`
              : channelEntries.length > 0
                ? `${connectedCount}/${channelEntries.length} 个渠道在线`
                : "等待系统状态"}
          </p>
        </article>

        <article className="ov-card ov-card--uptime">
          <CardLabel icon={<Clock size={14} />} label="运行时间" />
          <div className="ov-card-value ov-card-value--mono">
            {status ? formatUptime(status.uptime) : "-"}
          </div>
          {status && (
            <div
              className="ov-progress"
              role="progressbar"
              aria-label="近 30 天运行时间"
              aria-valuenow={Math.round(uptimePercent(status.uptime))}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <span style={{ width: `${uptimePercent(status.uptime)}%` }} />
            </div>
          )}
        </article>

        <article className="ov-card ov-card--usage">
          <CardLabel icon={<DollarSign size={14} />} label="模型用量" />
          <div className="ov-card-value ov-card-value--mono">
            {usage ? formatNumber(totalTokens ?? 0) : "-"}
          </div>
          <p className="ov-card-meta">
            {usage
              ? `${formatCost(usage.totalCostUsd)} / ${formatNumber(usage.totalRequests)} 次请求`
              : "暂无用量数据"}
          </p>
        </article>

        <article className="ov-card ov-card--agents">
          <CardLabel icon={<Bot size={14} />} label="智能体" />
          <div className="ov-card-value">{agents ? String(agents.length) : "-"}</div>
          <p className="ov-card-meta">已注册智能体</p>
        </article>
      </section>

      <section className="ov-section" aria-label="运行概况">
        <div className="ov-section-head">
          <h3>运行概况</h3>
          <span />
        </div>
        <div className="ov-grid ov-grid--ops">
          <article className="ov-card ov-card--processes">
            <CardLabel icon={<Cpu size={14} />} label="进程健康" />
            {processes ? (
              <>
                <div className="ov-process-list">
                  {processes.map((process) => (
                    <div key={process.name} className="ov-process-row">
                      <ProcessIcon status={process.status} />
                      <span className="ov-process-name">{processLabel(process.name)}</span>
                      <span className={`ov-process-state ov-process-state--${process.status}`}>
                        {processStatusLabel(process.status)}
                      </span>
                      <span className="ov-process-uptime">
                        {formatUptime(process.uptimeSeconds)}
                      </span>
                    </div>
                  ))}
                </div>
                <p className="ov-card-meta">{aliveProcesses}/{totalProcesses} 个进程健康</p>
              </>
            ) : (
              <p className="ov-card-meta">正在读取进程状态</p>
            )}
          </article>

          <article className="ov-card ov-card--cron">
            <CardLabel icon={<Timer size={14} />} label="定时任务" />
            {cron ? (
              <>
                <div className="ov-status-row">
                  <span className={cn(
                    "ov-status-dot",
                    cron.running ? "ov-status-dot--online" : "ov-status-dot--offline",
                  )} />
                  <span className="ov-card-value">{cron.jobCount}</span>
                </div>
                <p className="ov-card-meta">
                  {cron.running ? "调度器运行中" : "调度器已停止"}
                  {cron.nextDueAt ? ` / 下次执行 ${formatCountdown(cron.nextDueAt)}` : ""}
                </p>
              </>
            ) : (
              <p className="ov-card-meta">正在读取定时任务</p>
            )}
          </article>

          {memory && (
            <article className="ov-card ov-card--memory">
              <CardLabel icon={<Database size={14} />} label="记忆索引" />
              <div className="ov-card-value ov-card-value--mono">
                {formatNumber(memory.totalChunks ?? 0)}
              </div>
              <div className="ov-inline-metrics">
                <span>{formatNumber(memory.totalSources ?? 0)} 个来源</span>
                <span>{formatNumber(memory.agentsWithMemory ?? 0)} 个智能体</span>
              </div>
              <p className="ov-card-meta">
                已索引 {formatNumber(memory.totalTokens ?? 0)} tokens
              </p>
            </article>
          )}
        </div>
      </section>

      {channelEntries.length > 0 && (
        <section className="ov-section" aria-label="渠道状态">
          <div className="ov-section-head">
            <h3>渠道状态</h3>
            <strong>{connectedCount}/{channelEntries.length}</strong>
            <span />
          </div>
          <div className="ov-channel-grid">
            {channelEntries.map(([name, info]) => {
              const connected = info.status === "connected";
              return (
                <article
                  key={name}
                  className={cn(
                    "ov-channel",
                    connected ? "ov-channel--connected" : "ov-channel--offline",
                  )}
                >
                  <SignalBars connected={connected} />
                  <div className="ov-channel-info">
                    <h4>{formatChannelName(name)}</h4>
                    <p>{connected ? "已连接" : info.status}</p>
                  </div>
                  <ChannelTypeBadges type={info.type} />
                </article>
              );
            })}
          </div>
        </section>
      )}

      {status?.authEnabled && (
        <section className="ov-section" aria-label="访问令牌">
          <div className="ov-section-head">
            <h3>访问令牌</h3>
            <span />
          </div>
          {getToken() ? (
            <div className="ov-token-card">
              <div className="ov-token-row">
                <Key size={16} className="ov-token-icon" />
                <span>令牌已配置</span>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    clearToken();
                    setTokenMsg("令牌已清除，刷新后需要重新输入。");
                  }}
                >
                  清除
                </Button>
              </div>
              {tokenMsg && <p className="ov-token-msg">{tokenMsg}</p>}
            </div>
          ) : (
            <div className="ov-token-card">
              <form onSubmit={handleTokenSave} className="ov-token-form">
                <Input
                  id="overview-token"
                  type="password"
                  value={tokenInput}
                  onChange={(event) => setTokenInput(event.target.value)}
                  placeholder="输入访问令牌"
                />
                <Button type="submit" variant="primary">
                  保存
                </Button>
              </form>
              {tokenMsg && <p className="ov-token-msg ov-token-msg--danger">{tokenMsg}</p>}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function CardLabel({
  icon,
  label,
}: {
  readonly icon: React.ReactNode;
  readonly label: string;
}) {
  return (
    <div className="ov-card-label">
      {icon}
      {label}
    </div>
  );
}

function MetricTile({
  icon,
  label,
  value,
}: {
  readonly icon: React.ReactNode;
  readonly label: string;
  readonly value: string;
}) {
  return (
    <div className="ov-metric-tile">
      <span className="ov-metric-icon">{icon}</span>
      <span className="ov-metric-label">{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ProcessIcon({ status }: { readonly status: ProcessHealth["status"] }) {
  if (status === "alive") {
    return <CheckCircle size={14} className="ov-process-icon--alive" />;
  }
  if (status === "stale") {
    return <AlertTriangle size={14} className="ov-process-icon--stale" />;
  }
  return <XCircle size={14} className="ov-process-icon--dead" />;
}

function SignalBars({ connected }: { readonly connected: boolean }) {
  return (
    <div className={cn("ov-channel-signal", connected && "ov-channel-signal--on")}>
      <span />
      <span />
      <span />
      <span />
    </div>
  );
}

const CHANNEL_TYPE_META: Record<string, { icon: React.ReactNode; label: string }> = {
  telegram: { icon: <Send size={11} />, label: "Telegram" },
  whatsapp: { icon: <MessageCircle size={11} />, label: "WhatsApp" },
  preview: { icon: <MessageCircle size={11} />, label: "预览" },
};

function ChannelTypeBadges({ type }: { readonly type: string }) {
  const types = type.split("+").filter(Boolean);
  return (
    <div className="ov-channel-badges">
      {types.map((item) => {
        const meta = CHANNEL_TYPE_META[item] ?? {
          icon: <MessageCircle size={11} />,
          label: item,
        };
        return (
          <span key={item} className="ov-channel-badge" title={item}>
            {meta.icon}
            {meta.label}
          </span>
        );
      })}
    </div>
  );
}
