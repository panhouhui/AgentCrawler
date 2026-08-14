import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Database,
  Edit3,
  Plus,
  RefreshCw,
  Route,
  Send,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { apiFetch } from "../api";
import {
  Button,
  EmptyState,
  LoadingState,
  Modal,
  PageHeader,
  SearchBar,
} from "../components";
import { cn } from "../lib/cn";

interface KanPushRoute {
  readonly id: string;
  readonly platform: string;
  readonly platformLabel: string;
  readonly baseUrl: string;
  readonly tokenConfigured: boolean;
  readonly channelIds: readonly string[];
  readonly channelNames: readonly string[];
  readonly sourceLabels: readonly string[];
  readonly channelMap: Readonly<Record<string, readonly string[]>>;
  readonly status: "ready" | "missing-token" | "missing-channel";
  readonly notes: string;
}

interface KanPushTeamChannel {
  readonly id: string;
  readonly name: string;
  readonly displayName: string;
  readonly teamId: string | null;
  readonly teamName: string | null;
  readonly teamDisplayName: string | null;
  readonly baseUrl: string;
}

interface KanPushTeam {
  readonly id: string;
  readonly name: string;
  readonly displayName: string;
  readonly baseUrl: string;
  readonly channels: readonly KanPushTeamChannel[];
}

interface KanPushChannel {
  readonly id: string;
  readonly baseUrl: string;
  readonly displayName: string;
  readonly teamId: string | null;
  readonly teamName: string | null;
  readonly teamDisplayName: string | null;
  readonly routeIds: readonly string[];
  readonly platformLabels: readonly string[];
  readonly tokenConfigured: boolean;
  readonly status: string;
}

interface KanPushOverview {
  readonly serviceName: string;
  readonly generatedAt: string;
  readonly summary: {
    readonly routeCount: number;
    readonly readyRouteCount: number;
    readonly channelCount: number;
    readonly teamCount: number;
    readonly configuredTokenCount: number;
    readonly baseUrls: readonly string[];
  };
  readonly routes: readonly KanPushRoute[];
  readonly channels: readonly KanPushChannel[];
  readonly teams: readonly KanPushTeam[];
  readonly platforms: readonly {
    readonly id: string;
    readonly label: string;
  }[];
}

const TH =
  "px-4 py-2.5 text-[10px] font-semibold text-faint uppercase tracking-[0.1em]";

const SOCIAL_FUSION_ROUTE_ID = "social-fusion-kan";
const SOCIAL_FUSION_PLATFORM_ID = "social-fusion";

const STATUS_VIEW: Record<
  KanPushRoute["status"],
  { readonly label: string; readonly className: string }
> = {
  ready: {
    label: "已就绪",
    className: "bg-success-subtle text-success",
  },
  "missing-token": {
    label: "缺少令牌",
    className: "bg-danger-subtle text-danger",
  },
  "missing-channel": {
    label: "缺少频道",
    className: "bg-warning-subtle text-warning",
  },
};

function StatusPill({ status }: { readonly status: KanPushRoute["status"] }) {
  const view = STATUS_VIEW[status];
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold whitespace-nowrap",
        view.className,
      )}
    >
      {view.label}
    </span>
  );
}

function TokenPill({ configured }: { readonly configured: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-semibold whitespace-nowrap",
        configured ? "bg-success-subtle text-success" : "bg-danger-subtle text-danger",
      )}
    >
      {configured ? <ShieldCheck size={12} /> : <AlertTriangle size={12} />}
      {configured ? "已配置令牌" : "未配置"}
    </span>
  );
}

function Chips({ values, max = 4 }: { readonly values: readonly string[]; readonly max?: number }) {
  if (values.length === 0) return <span className="text-faint">—</span>;
  const visible = values.slice(0, max);
  return (
    <div className="flex flex-wrap gap-1.5">
      {visible.map((value, index) => (
        <span
          key={`${value}-${index}`}
          className="inline-flex max-w-[220px] truncate px-2 py-0.5 rounded bg-bg-2 text-[11px] font-mono text-muted"
          title={value}
        >
          {value}
        </span>
      ))}
      {values.length > visible.length && (
        <span className="inline-flex px-2 py-0.5 rounded bg-bg-2 text-[11px] font-mono text-faint">
          +{values.length - visible.length}
        </span>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  icon,
  note,
}: {
  readonly label: string;
  readonly value: string | number;
  readonly icon: React.ReactNode;
  readonly note: string;
}) {
  return (
    <div className="bg-bg-1 border border-border rounded-lg px-5 py-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <span className="text-xs font-semibold text-muted">{label}</span>
        <span className="text-accent">{icon}</span>
      </div>
      <div className="text-2xl font-bold text-strong font-mono">{value}</div>
      <div className="text-xs text-faint mt-1.5">{note}</div>
    </div>
  );
}

function parseChannelInput(value: string): readonly string[] {
  return [
    ...new Set(
      value
        .split(/[\n,]/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

function formatChannelInput(values: readonly string[]): string {
  return values.join("\n");
}

function RouteTable({
  routes,
  onAdd,
  onEdit,
  onDelete,
}: {
  readonly routes: readonly KanPushRoute[];
  readonly onAdd: () => void;
  readonly onEdit: (route: KanPushRoute) => void;
  readonly onDelete: (route: KanPushRoute) => void;
}) {
  return (
    <div className="bg-bg-1 border border-border rounded-lg overflow-hidden">
      <div className="px-5 py-3 border-b border-border flex items-center justify-between">
        <h3 className="text-sm font-semibold text-strong m-0">爬虫平台到 Kan 频道映射</h3>
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-faint">{routes.length} 个平台</span>
          <Button type="button" size="sm" onClick={onAdd}>
            <Plus size={14} />
            添加路由
          </Button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className={cn(TH, "text-left")}>平台</th>
              <th className={cn(TH, "text-left")}>状态</th>
              <th className={cn(TH, "text-left")}>Kan 服务</th>
              <th className={cn(TH, "text-left")}>群/频道 ID</th>
              <th className={cn(TH, "text-left")}>Kan 群名称</th>
              <th className={cn(TH, "text-left")}>来源范围</th>
              <th className={cn(TH, "text-right")}>操作</th>
            </tr>
          </thead>
          <tbody>
            {routes.length === 0 ? (
              <tr>
                <td className="px-4 py-8 text-sm text-muted text-center" colSpan={7}>
                  没有匹配的爬虫平台路由。
                </td>
              </tr>
            ) : (
              routes.map((route) => (
                <tr key={route.id} className="border-b border-border/30 hover:bg-bg-2/50">
                  <td className="px-4 py-3">
                    <div className="font-semibold text-foreground">{route.platformLabel}</div>
                    <div className="font-mono text-[11px] text-faint">{route.id}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-1.5">
                      <StatusPill status={route.status} />
                      <TokenPill configured={route.tokenConfigured} />
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted whitespace-nowrap">
                    {route.baseUrl}
                  </td>
                  <td className="px-4 py-3">
                    <Chips values={route.channelIds} />
                  </td>
                  <td className="px-4 py-3">
                    <Chips values={route.channelNames} max={6} />
                  </td>
                  <td className="px-4 py-3">
                    <Chips values={route.sourceLabels} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => onEdit(route)}
                      >
                        <Edit3 size={14} />
                        编辑
                      </Button>
                      <Button
                        type="button"
                        variant="danger"
                        size="sm"
                        onClick={() => onDelete(route)}
                      >
                        <Trash2 size={14} />
                        清空
                      </Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SocialFusionRoutePanel({
  route,
  onEdit,
  onClear,
}: {
  readonly route: KanPushRoute | null;
  readonly onEdit: (route: KanPushRoute) => void;
  readonly onClear: (route: KanPushRoute) => void;
}) {
  return (
    <div className="bg-bg-1 border border-border rounded-lg overflow-hidden mb-5">
      <div className="px-5 py-3 border-b border-border flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-strong m-0">社交融合监控总推送频道</h3>
          <p className="m-0 mt-1 text-xs text-muted">
            只用于 Social Fusion Agent 达到推送阈值后的总控告警，不参与单个平台爬虫路由。
          </p>
        </div>
        {route && (
          <div className="flex items-center gap-2 shrink-0">
            <Button type="button" size="sm" variant="secondary" onClick={() => onEdit(route)}>
              <Edit3 size={14} />
              配置
            </Button>
            <Button type="button" size="sm" variant="danger" onClick={() => onClear(route)}>
              <Trash2 size={14} />
              清空
            </Button>
          </div>
        )}
      </div>
      {route ? (
        <div className="grid grid-cols-[1.1fr_1fr_1fr_1.2fr] max-xl:grid-cols-2 max-sm:grid-cols-1 gap-0 divide-x divide-border/50 max-xl:divide-x-0">
          <div className="px-5 py-4">
            <div className="text-[11px] font-semibold text-faint uppercase tracking-[0.1em] mb-2">
              状态
            </div>
            <div className="flex flex-wrap gap-2">
              <StatusPill status={route.status} />
              <TokenPill configured={route.tokenConfigured} />
            </div>
            <div className="text-xs text-muted mt-2 leading-relaxed">{route.notes}</div>
          </div>
          <div className="px-5 py-4">
            <div className="text-[11px] font-semibold text-faint uppercase tracking-[0.1em] mb-2">
              Kan 服务
            </div>
            <div className="font-mono text-xs text-muted break-all">{route.baseUrl}</div>
          </div>
          <div className="px-5 py-4">
            <div className="text-[11px] font-semibold text-faint uppercase tracking-[0.1em] mb-2">
              群/频道 ID
            </div>
            <Chips values={route.channelIds} max={6} />
          </div>
          <div className="px-5 py-4">
            <div className="text-[11px] font-semibold text-faint uppercase tracking-[0.1em] mb-2">
              Kan 群名称
            </div>
            <Chips values={route.channelNames} max={6} />
          </div>
        </div>
      ) : (
        <div className="px-5 py-6 text-sm text-muted">
          当前没有解析到社交融合总推送路由。
        </div>
      )}
    </div>
  );
}

function ChannelTable({
  channels,
}: {
  readonly channels: readonly KanPushChannel[];
}) {
  return (
    <div className="bg-bg-1 border border-border rounded-lg overflow-hidden">
      <div className="px-5 py-3 border-b border-border flex items-center justify-between">
        <h3 className="text-sm font-semibold text-strong m-0">Kan 频道清单</h3>
        <span className="text-[11px] text-faint">{channels.length} 个频道</span>
      </div>
      {channels.length === 0 ? (
        <EmptyState description="当前没有解析到 Kan 频道配置。" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className={cn(TH, "text-left")}>团队</th>
                <th className={cn(TH, "text-left")}>频道</th>
                <th className={cn(TH, "text-left")}>Kan 服务</th>
                <th className={cn(TH, "text-left")}>推送平台</th>
                <th className={cn(TH, "text-left")}>关联路由</th>
                <th className={cn(TH, "text-center")}>状态</th>
              </tr>
            </thead>
            <tbody>
              {channels.map((channel) => (
                <tr key={`${channel.baseUrl}:${channel.id}`} className="border-b border-border/30 hover:bg-bg-2/50">
                  <td className="px-4 py-3">
                    <div className="text-foreground font-semibold">
                      {channel.teamDisplayName ?? "暂未解析"}
                    </div>
                    <div className="font-mono text-xs text-faint">
                      {channel.teamName ?? channel.teamId ?? "—"}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-foreground font-semibold">{channel.displayName}</div>
                    <div className="font-mono text-xs text-faint">{channel.id}</div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted">{channel.baseUrl}</td>
                  <td className="px-4 py-3">
                    <Chips values={channel.platformLabels} />
                  </td>
                  <td className="px-4 py-3">
                    <Chips values={channel.routeIds} />
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span
                      className={cn(
                        "inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold",
                        channel.status === "已配置"
                          ? "bg-success-subtle text-success"
                          : "bg-warning-subtle text-warning",
                      )}
                    >
                      {channel.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function RouteConfigModal({
  mode,
  open,
  route,
  overview,
  platformOptions,
  platform,
  baseUrl,
  botToken,
  channelText,
  teamKey,
  saving,
  error,
  onClose,
  onPlatformChange,
  onBaseUrlChange,
  onBotTokenChange,
  onChannelTextChange,
  onTeamKeyChange,
  onToggleChannel,
  onSubmit,
}: {
  readonly mode: "create" | "edit";
  readonly open: boolean;
  readonly route: KanPushRoute | null;
  readonly overview: KanPushOverview;
  readonly platformOptions: readonly KanPushOverview["platforms"][number][];
  readonly platform: string;
  readonly baseUrl: string;
  readonly botToken: string;
  readonly channelText: string;
  readonly teamKey: string;
  readonly saving: boolean;
  readonly error: string;
  readonly onClose: () => void;
  readonly onPlatformChange: (value: string) => void;
  readonly onBaseUrlChange: (value: string) => void;
  readonly onBotTokenChange: (value: string) => void;
  readonly onChannelTextChange: (value: string) => void;
  readonly onTeamKeyChange: (value: string) => void;
  readonly onToggleChannel: (channelId: string) => void;
  readonly onSubmit: () => void;
}) {
  const selectedTeam =
    overview.teams.find((team) => `${team.baseUrl}|${team.id}` === teamKey) ?? null;
  const selectedChannelIds = parseChannelInput(channelText);
  const selectOptions =
    route && !platformOptions.some((item) => item.id === route.platform)
      ? [{ id: route.platform, label: route.platformLabel }, ...platformOptions]
      : platformOptions;

  return (
    <Modal
      open={open}
      title={mode === "create" ? "添加 Kan 推送路由" : `编辑 ${route?.platformLabel ?? "Kan 推送路由"}`}
      onClose={onClose}
      width="720px"
    >
      <form
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <div className="grid grid-cols-2 max-md:grid-cols-1 gap-4">
          <label className="block">
            <span className="block text-sm font-semibold text-muted mb-2">爬虫平台</span>
            <select
              className="w-full px-3 py-2.5 bg-bg border border-border-2 rounded-lg text-foreground outline-none focus:border-accent"
              value={platform}
              onChange={(event) => onPlatformChange(event.target.value)}
              disabled={mode === "edit"}
            >
              {selectOptions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="block text-sm font-semibold text-muted mb-2">Kan 服务</span>
            <input
              className="w-full px-3 py-2.5 bg-bg border border-border-2 rounded-lg text-foreground outline-none focus:border-accent"
              value={baseUrl}
              onChange={(event) => onBaseUrlChange(event.target.value)}
              placeholder="https://kan.cool"
            />
          </label>
        </div>

        <label className="block">
          <span className="block text-sm font-semibold text-muted mb-2">机器人访问令牌</span>
          <input
            type="password"
            autoComplete="new-password"
            className="w-full px-3 py-2.5 bg-bg border border-border-2 rounded-lg text-foreground outline-none focus:border-accent"
            value={botToken}
            onChange={(event) => onBotTokenChange(event.target.value)}
            placeholder={
              route?.tokenConfigured
                ? "已配置令牌；留空保存会沿用现有令牌"
                : "填写 Kan 机器人访问令牌"
            }
          />
          <span className="block text-xs text-faint mt-1.5">
            页面不会显示已有令牌明文；只有填写新值时才会覆盖保存。
          </span>
        </label>

        <label className="block">
          <span className="block text-sm font-semibold text-muted mb-2">团队</span>
          <select
            className="w-full px-3 py-2.5 bg-bg border border-border-2 rounded-lg text-foreground outline-none focus:border-accent"
            value={teamKey}
            onChange={(event) => {
              const value = event.target.value;
              onTeamKeyChange(value);
              const team = overview.teams.find((item) => `${item.baseUrl}|${item.id}` === value);
              if (team) onBaseUrlChange(team.baseUrl);
            }}
          >
            <option value="">不从团队选择，手动填写频道 ID</option>
            {overview.teams.map((team) => (
              <option key={`${team.baseUrl}|${team.id}`} value={`${team.baseUrl}|${team.id}`}>
                {team.displayName} / {team.baseUrl}
              </option>
            ))}
          </select>
        </label>

        {selectedTeam && (
          <div>
            <div className="text-sm font-semibold text-muted mb-2">团队频道</div>
            <div className="max-h-[220px] overflow-y-auto rounded-lg border border-border bg-bg divide-y divide-border/50">
              {selectedTeam.channels.length === 0 ? (
                <div className="px-4 py-3 text-sm text-muted">这个团队暂时没有解析到频道。</div>
              ) : (
                selectedTeam.channels.map((channel) => {
                  const checked = selectedChannelIds.includes(channel.id);
                  return (
                    <label
                      key={channel.id}
                      className="flex items-center justify-between gap-3 px-4 py-3 text-sm cursor-pointer hover:bg-bg-2"
                    >
                      <span className="min-w-0">
                        <span className="block text-foreground font-semibold truncate">
                          {channel.displayName}
                        </span>
                        <span className="block text-xs text-faint font-mono truncate">
                          {channel.id}
                        </span>
                      </span>
                      <input
                        type="checkbox"
                        className="size-4 accent-accent"
                        checked={checked}
                        onChange={() => onToggleChannel(channel.id)}
                      />
                    </label>
                  );
                })
              )}
            </div>
          </div>
        )}

        <label className="block">
          <span className="block text-sm font-semibold text-muted mb-2">群/频道 ID</span>
          <textarea
            className="w-full min-h-[110px] px-3 py-2.5 bg-bg border border-border-2 rounded-lg text-foreground outline-none focus:border-accent font-mono text-sm"
            value={channelText}
            onChange={(event) => onChannelTextChange(event.target.value)}
            placeholder="每行一个群/频道 ID，也可以用英文逗号分隔"
          />
        </label>

        {error && (
          <div className="rounded-lg border border-danger/30 bg-danger-subtle px-4 py-3 text-danger text-sm">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            取消
          </Button>
          <Button type="submit" loading={saving}>
            保存配置
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function DeleteRouteModal({
  open,
  route,
  saving,
  error,
  onClose,
  onConfirm,
}: {
  readonly open: boolean;
  readonly route: KanPushRoute | null;
  readonly saving: boolean;
  readonly error: string;
  readonly onClose: () => void;
  readonly onConfirm: () => void;
}) {
  return (
    <Modal open={open} title="清空 Kan 推送路由配置" onClose={onClose} width="520px">
      <div className="space-y-5">
        <p className="m-0 text-sm text-muted leading-relaxed">
          确认清空 {route?.platformLabel ?? "这个平台"} 的 Kan 频道映射和机器人令牌吗？这不会删除爬虫平台，也不会影响其他路由。
        </p>
        {error && (
          <div className="rounded-lg border border-danger/30 bg-danger-subtle px-4 py-3 text-danger text-sm">
            {error}
          </div>
        )}
        <div className="flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            取消
          </Button>
          <Button type="button" variant="danger" loading={saving} onClick={onConfirm}>
            确认清空
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export default function KanPushConfig() {
  const [overview, setOverview] = useState<KanPushOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [routeModalMode, setRouteModalMode] = useState<"create" | "edit" | null>(null);
  const [deleteRoute, setDeleteRoute] = useState<KanPushRoute | null>(null);
  const [activeRoute, setActiveRoute] = useState<KanPushRoute | null>(null);
  const [formPlatform, setFormPlatform] = useState("");
  const [formBaseUrl, setFormBaseUrl] = useState("");
  const [formBotToken, setFormBotToken] = useState("");
  const [formChannelText, setFormChannelText] = useState("");
  const [formTeamKey, setFormTeamKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState("");
  const [actionMessage, setActionMessage] = useState("");

  const loadConfig = useCallback(async () => {
    setError("");
    try {
      const res = await apiFetch<{ success: boolean; data: KanPushOverview }>(
        "/api/kan-push/config",
      );
      if (res.success) setOverview(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kan 推送配置加载失败");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  const platformOptions = useMemo(
    () =>
      (overview?.platforms ?? []).filter(
        (platform) => platform.id !== SOCIAL_FUSION_PLATFORM_ID,
      ),
    [overview],
  );

  const socialFusionRoute = useMemo(
    () =>
      overview?.routes.find((route) => route.id === SOCIAL_FUSION_ROUTE_ID) ??
      null,
    [overview],
  );

  const filteredRoutes = useMemo(() => {
    const routes = overview?.routes ?? [];
    const q = search.trim().toLowerCase();
    const platformRoutes = routes.filter((route) => route.id !== SOCIAL_FUSION_ROUTE_ID);
    if (!q) return platformRoutes;
    return platformRoutes.filter((route) =>
      [
        route.id,
        route.platform,
        route.platformLabel,
        route.baseUrl,
        ...route.channelIds,
        ...route.channelNames,
        ...route.sourceLabels,
      ].some((value) => value.toLowerCase().includes(q)),
    );
  }, [overview, search]);

  function openCreateModal() {
    if (!overview) return;
    const firstPlatform = platformOptions[0]?.id ?? "";
    const firstTeam = overview.teams[0] ?? null;
    setRouteModalMode("create");
    setActiveRoute(null);
    setFormPlatform(firstPlatform);
    setFormBaseUrl(firstTeam?.baseUrl ?? overview.summary.baseUrls[0] ?? "https://kan.cool");
    setFormBotToken("");
    setFormChannelText("");
    setFormTeamKey(firstTeam ? `${firstTeam.baseUrl}|${firstTeam.id}` : "");
    setModalError("");
    setActionMessage("");
  }

  function openEditModal(route: KanPushRoute) {
    const matchingTeam =
      overview?.teams.find((team) =>
        route.channelIds.some((channelId) =>
          team.channels.some((channel) => channel.id === channelId),
        ),
      ) ?? null;
    setRouteModalMode("edit");
    setActiveRoute(route);
    setFormPlatform(route.platform);
    setFormBaseUrl(route.baseUrl);
    setFormBotToken("");
    setFormChannelText(formatChannelInput(route.channelIds));
    setFormTeamKey(matchingTeam ? `${matchingTeam.baseUrl}|${matchingTeam.id}` : "");
    setModalError("");
    setActionMessage("");
  }

  function closeRouteModal() {
    if (saving) return;
    setRouteModalMode(null);
    setActiveRoute(null);
    setModalError("");
  }

  function openDeleteModal(route: KanPushRoute) {
    setDeleteRoute(route);
    setModalError("");
    setActionMessage("");
  }

  function closeDeleteModal() {
    if (saving) return;
    setDeleteRoute(null);
    setModalError("");
  }

  function toggleChannel(channelId: string) {
    const current = parseChannelInput(formChannelText);
    const next = current.includes(channelId)
      ? current.filter((id) => id !== channelId)
      : [...current, channelId];
    setFormChannelText(formatChannelInput(next));
  }

  async function saveRoute() {
    if (!overview || !routeModalMode) return;
    const channelIds = parseChannelInput(formChannelText);
    if (channelIds.length === 0) {
      setModalError("至少需要选择或填写一个 Kan 频道");
      return;
    }
    setSaving(true);
    setModalError("");
    try {
      const path =
        routeModalMode === "edit" && activeRoute
          ? `/api/kan-push/routes/${activeRoute.id}`
          : "/api/kan-push/routes";
      const res = await apiFetch<{ success: boolean; data: KanPushOverview }>(
        path,
        {
          method: routeModalMode === "edit" ? "PUT" : "POST",
          body: JSON.stringify({
            platform: formPlatform,
            baseUrl: formBaseUrl,
            botToken: formBotToken.trim() || undefined,
            channelIds,
          }),
        },
      );
      if (res.success) {
        setOverview(res.data);
        setActionMessage("Kan 推送路由已保存");
        setRouteModalMode(null);
        setActiveRoute(null);
        setFormBotToken("");
      }
    } catch (err) {
      setModalError(err instanceof Error ? err.message : "Kan 推送路由保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function confirmDeleteRoute() {
    if (!deleteRoute) return;
    setSaving(true);
    setModalError("");
    try {
      const res = await apiFetch<{ success: boolean; data: KanPushOverview }>(
        `/api/kan-push/routes/${deleteRoute.id}`,
        { method: "DELETE" },
      );
      if (res.success) {
        setOverview(res.data);
        setActionMessage("Kan 推送路由配置已清空");
        setDeleteRoute(null);
      }
    } catch (err) {
      setModalError(err instanceof Error ? err.message : "Kan 推送路由删除失败");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <LoadingState message="正在加载 Kan 推送配置..." />;
  }

  if (error && !overview) {
    return <EmptyState title="Kan 推送配置加载失败" description={error} />;
  }

  if (!overview) {
    return <EmptyState description="暂无 Kan 推送配置。" />;
  }

  return (
    <div className="max-w-[1500px]">
      <PageHeader
        title="kan推送配置"
        subtitle="统一管理各爬虫平台推送到 Kan 频道的配置和状态"
        count={overview.summary.routeCount}
        actions={
          <Button
            variant="secondary"
            onClick={() => {
              setRefreshing(true);
              loadConfig();
            }}
            loading={refreshing}
          >
            <RefreshCw size={16} />
            刷新配置
          </Button>
        }
      />

      {error && (
        <div className="bg-danger-subtle border border-danger/20 rounded-lg px-4 py-3 text-danger text-sm mb-5">
          {error}
        </div>
      )}

      {actionMessage && (
        <div className="bg-success-subtle border border-success/20 rounded-lg px-4 py-3 text-success text-sm mb-5">
          {actionMessage}
        </div>
      )}

      <div className="grid grid-cols-4 max-xl:grid-cols-2 max-sm:grid-cols-1 gap-3 mb-6">
        <SummaryCard
          label="平台路由"
          value={`${overview.summary.readyRouteCount}/${overview.summary.routeCount}`}
          note="已就绪 / 总数量"
          icon={<Route size={18} />}
        />
        <SummaryCard
          label="Kan 频道"
          value={overview.summary.channelCount}
          note={`已解析 ${overview.summary.teamCount} 个团队`}
          icon={<Send size={18} />}
        />
        <SummaryCard
          label="令牌状态"
          value={overview.summary.configuredTokenCount}
          note="只显示是否配置，不展示密钥"
          icon={<ShieldCheck size={18} />}
        />
        <SummaryCard
          label="服务地址"
          value={overview.summary.baseUrls.length}
          note={overview.summary.baseUrls.join("，") || "未配置"}
          icon={<Database size={18} />}
        />
      </div>

      <SocialFusionRoutePanel
        route={socialFusionRoute}
        onEdit={openEditModal}
        onClear={openDeleteModal}
      />

      <div className="mb-5">
        <div className="max-w-md mb-4">
          <SearchBar
            value={search}
            onChange={setSearch}
            placeholder="搜索平台、频道、群名称..."
          />
        </div>
        <RouteTable
          routes={filteredRoutes}
          onAdd={openCreateModal}
          onEdit={openEditModal}
          onDelete={openDeleteModal}
        />
      </div>

      <ChannelTable channels={overview.channels} />

      <RouteConfigModal
        mode={routeModalMode ?? "create"}
        open={Boolean(routeModalMode)}
        route={activeRoute}
        overview={overview}
        platformOptions={platformOptions}
        platform={formPlatform}
        baseUrl={formBaseUrl}
        botToken={formBotToken}
        channelText={formChannelText}
        teamKey={formTeamKey}
        saving={saving}
        error={routeModalMode ? modalError : ""}
        onClose={closeRouteModal}
        onPlatformChange={setFormPlatform}
        onBaseUrlChange={setFormBaseUrl}
        onBotTokenChange={setFormBotToken}
        onChannelTextChange={setFormChannelText}
        onTeamKeyChange={setFormTeamKey}
        onToggleChannel={toggleChannel}
        onSubmit={() => void saveRoute()}
      />

      <DeleteRouteModal
        open={Boolean(deleteRoute)}
        route={deleteRoute}
        saving={saving}
        error={deleteRoute ? modalError : ""}
        onClose={closeDeleteModal}
        onConfirm={() => void confirmDeleteRoute()}
      />
    </div>
  );
}
