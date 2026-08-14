import { useState } from "react";
import {
  enableChannel,
  disableChannel,
  restartChannel,
} from "../api";
import ChannelSetupForm from "./ChannelSetupForm";
import { LoadingState, EmptyState, Button, StatusBadge, Toggle } from "../components";
import { cn } from "../lib/cn";
import { usePolledFetch } from "../hooks/usePolledFetch";

interface ChannelMeta {
  id: string;
  label: string;
  icon: string;
  order: number;
}

interface ChannelSnapshot {
  enabled: boolean;
  configured: boolean;
  connected: boolean;
  lastError?: string | null;
  allowedUserIds?: number[];
  [key: string]: unknown;
}

interface ChannelEntry {
  id: string;
  meta: ChannelMeta;
  capabilities: { media: boolean; groups: boolean };
  snapshot: ChannelSnapshot;
}

interface ChannelsResponse {
  success: boolean;
  data: ChannelEntry[];
}

const channelStatusMap: Record<string, string> = {
  已连接: "green",
  已停用: "gray",
  未连接: "red",
  未配置: "yellow",
};

function getChannelStatus(snapshot: ChannelSnapshot): string {
  if (!snapshot.enabled) return "已停用";
  if (snapshot.connected) return "已连接";
  if (!snapshot.configured) return "未配置";
  return "未连接";
}

function ChannelCard({
  entry,
  onRefresh,
}: {
  entry: ChannelEntry;
  onRefresh: () => void;
}) {
  const [showSetup, setShowSetup] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  const { meta, snapshot } = entry;
  const statusLabel = getChannelStatus(snapshot);

  async function handleToggle() {
    setActionLoading(true);
    try {
      if (snapshot.enabled) {
        await disableChannel(meta.id);
      } else {
        await enableChannel(meta.id);
      }
      onRefresh();
    } catch {
      // error handled by refresh
    } finally {
      setActionLoading(false);
    }
  }

  async function handleRestart() {
    setActionLoading(true);
    try {
      await restartChannel(meta.id);
      onRefresh();
    } catch {
      // error handled by refresh
    } finally {
      setActionLoading(false);
    }
  }

  return (
    <div className="bg-bg-1 border border-border rounded-lg p-6 transition-colors hover:border-border-2">
      <div className="flex items-center gap-4 mb-5">
        <div className="text-2xl leading-none shrink-0">{meta.icon}</div>
        <div className="flex-1">
          <div className="text-base font-semibold text-strong mb-1">
            {meta.label}
          </div>
          <StatusBadge status={statusLabel} colorMap={channelStatusMap} />
        </div>
      </div>

      <div className="flex flex-col gap-3 mb-5 text-sm">
        <div className="flex items-center justify-between py-1 border-b border-border">
          <span className="text-faint text-sm font-medium">启用状态</span>
          <Toggle
            checked={snapshot.enabled}
            onChange={handleToggle}
            disabled={actionLoading}
          />
        </div>

        <div className="flex items-center justify-between py-1 border-b border-border">
          <span className="text-faint text-sm font-medium">连接状态</span>
          <span className="flex items-center gap-3 text-sm">
            <span
              className={cn(
                "inline-block w-2 h-2 rounded-full shrink-0",
                snapshot.connected ? "bg-success" : "bg-danger",
              )}
            />
            {snapshot.connected ? "是" : "否"}
          </span>
        </div>

        {snapshot.lastError && (
          <div className="flex items-center justify-between py-1 border-b border-border">
            <span className="text-faint text-sm font-medium">错误</span>
            <span className="text-danger text-sm">{snapshot.lastError}</span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-3">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setShowSetup((s) => !s)}
        >
          {showSetup ? "收起" : "配置"}
        </Button>
        {snapshot.enabled && snapshot.connected && (
          <Button
            variant="secondary"
            size="sm"
            onClick={handleRestart}
            disabled={actionLoading}
          >
            重启
          </Button>
        )}
      </div>

      {showSetup && (
        <div className="mt-4 pt-4 border-t border-border">
          <ChannelSetupForm
            channelId={meta.id}
            snapshot={snapshot as Record<string, unknown>}
            onSaved={() => {
              setShowSetup(false);
              onRefresh();
            }}
          />
        </div>
      )}
    </div>
  );
}

export default function Channels() {
  const { data, error, loading, refetch } = usePolledFetch<ChannelsResponse>(
    "/api/channels",
    { intervalMs: 5000 },
  );

  const channels = data?.data ?? null;

  if (error && !channels) {
    return (
      <EmptyState
        title="渠道加载失败"
        description={error}
      />
    );
  }

  if (loading && !channels) {
    return <LoadingState />;
  }

  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-widest text-faint mb-5">
        渠道状态
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4">
        {(channels ?? []).map((entry) => (
          <ChannelCard key={entry.id} entry={entry} onRefresh={refetch} />
        ))}
      </div>
    </div>
  );
}
