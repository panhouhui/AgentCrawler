import { formatTime } from "../lib/format";
import { LoadingState, EmptyState, PageHeader } from "../components";
import { cn } from "../lib/cn";
import { usePolledFetch } from "../hooks/usePolledFetch";

interface Session {
  readonly id: string;
  readonly channel: string;
  readonly chatId: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

interface SessionsResponse {
  readonly success: boolean;
  readonly data: Session[];
}

const CHANNEL_LABELS: Record<string, string> = {
  telegram: "Telegram 渠道",
  whatsapp: "WhatsApp 渠道",
  "social-fusion": "社交融合",
};

function channelLabel(channel: string): string {
  return CHANNEL_LABELS[channel] ?? channel;
}

export default function Sessions() {
  const { data, loading, error } = usePolledFetch<SessionsResponse>(
    "/api/sessions",
    { intervalMs: 10000 },
  );

  const sessions = data?.data ?? [];

  if (loading && !data) {
    return <LoadingState />;
  }

  if (error) {
    return <EmptyState title="会话加载失败" />;
  }

  if (sessions.length === 0) {
    return <EmptyState description="暂无活跃会话" />;
  }

  return (
    <div>
      <PageHeader title="活跃会话" count={sessions.length} />
      <div className="bg-bg-1 border border-border rounded-lg overflow-hidden">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="text-left px-4 py-3 bg-bg-2 text-faint text-xs font-semibold uppercase tracking-[0.1em] border-b border-border">
                渠道
              </th>
              <th className="text-left px-4 py-3 bg-bg-2 text-faint text-xs font-semibold uppercase tracking-[0.1em] border-b border-border">
                聊天 ID
              </th>
              <th className="text-left px-4 py-3 bg-bg-2 text-faint text-xs font-semibold uppercase tracking-[0.1em] border-b border-border">
                最近活跃
              </th>
              <th className="text-left px-4 py-3 bg-bg-2 text-faint text-xs font-semibold uppercase tracking-[0.1em] border-b border-border">
                创建时间
              </th>
              <th className="text-left px-4 py-3 bg-bg-2 text-faint text-xs font-semibold uppercase tracking-[0.1em] border-b border-border" />
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => (
              <tr key={s.id} className="group">
                <td className="px-4 py-3 border-t border-border text-sm text-foreground group-hover:bg-bg-2">
                  <span
                    className={cn(
                      "inline-flex items-center px-3 py-0.5 rounded-full text-xs font-semibold tracking-wide",
                      s.channel === "telegram"
                        ? "bg-accent-subtle text-accent"
                        : "bg-bg-3 text-muted",
                    )}
                  >
                    {channelLabel(s.channel)}
                  </span>
                </td>
                <td className="px-4 py-3 border-t border-border text-sm text-foreground font-mono group-hover:bg-bg-2">
                  {s.chatId.length > 30
                    ? `${s.chatId.slice(0, 30)}\u2026`
                    : s.chatId}
                </td>
                <td className="px-4 py-3 border-t border-border text-sm text-foreground group-hover:bg-bg-2">
                  {formatTime(s.updatedAt)}
                </td>
                <td className="px-4 py-3 border-t border-border text-sm text-foreground group-hover:bg-bg-2">
                  {formatTime(s.createdAt)}
                </td>
                <td className="px-4 py-3 border-t border-border text-sm text-foreground group-hover:bg-bg-2">
                  <a
                    className="bg-transparent border-none text-accent cursor-pointer text-sm p-0 hover:text-accent-hover"
                    href={`/chat/${encodeURIComponent(s.channel)}/${encodeURIComponent(s.chatId)}`}
                  >
                    打开
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
