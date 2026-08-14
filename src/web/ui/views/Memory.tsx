import { useState, useEffect, useCallback, useRef } from "react";
import { useLocalStorage } from "../lib/useLocalStorage";
import { apiFetch } from "../api";
import { LoadingState, EmptyState, PageHeader, ModelRoutePicker } from "../components";
import { cn } from "../lib/cn";
import { relativeTime, formatNumber } from "../lib/format";

interface KindStat {
  readonly kind: string;
  readonly count: number;
}

interface AgentStat {
  readonly agentId: string;
  readonly chunkCount: number;
  readonly sourceCount: number;
  readonly totalTokens: number;
}

interface DebugStats {
  readonly totalSources: number;
  readonly totalChunks: number;
  readonly totalTokens: number;
  readonly agentsWithMemory: number;
  readonly byKind: readonly KindStat[];
  readonly byAgent: readonly AgentStat[];
}

interface ChunkEntry {
  readonly id: string;
  readonly sourceId: string;
  readonly content: string;
  readonly chunkIndex: number;
  readonly tokenCount: number;
  readonly createdAt: number;
  readonly kind: string;
  readonly agentId: string;
  readonly channel: string | null;
}

interface SearchResultEntry {
  readonly score: number;
  readonly content: string;
  readonly chunkId: string;
  readonly chunkIndex: number;
  readonly tokenCount: number;
  readonly createdAt: number;
  readonly source: {
    readonly id: string;
    readonly kind: string;
    readonly agentId: string;
    readonly channel: string | null;
    readonly createdAt: number;
  };
}

interface AgentMemoryEntry {
  readonly agentId: string;
  readonly key: string;
  readonly value: string;
  readonly updatedAt: number;
}

type ActiveTab = "search" | "chunks" | "kv";

const KIND_COLORS: Record<string, string> = {
  conversation: "bg-accent-subtle text-accent",
  observation: "bg-warning-subtle text-warning",
  note: "bg-success-subtle text-success",
  idea: "bg-[#7928ca]/10 text-[#7928ca]",
  hackernews_story: "bg-[#f97316]/10 text-[#f97316]",
  reuters_news: "bg-[#0ea5e9]/10 text-[#0ea5e9]",
  cointelegraph_news: "bg-[#0ea5e9]/10 text-[#0ea5e9]",
  cryptopanic_news: "bg-[#0ea5e9]/10 text-[#0ea5e9]",
  investingnews_news: "bg-[#0ea5e9]/10 text-[#0ea5e9]",
  x_post: "bg-[#1da1f2]/10 text-[#1da1f2]",
  reddit_post: "bg-[#ff4500]/10 text-[#ff4500]",
  github_repo: "bg-[#6e5494]/10 text-[#6e5494]",
  producthunt_product: "bg-[#da552f]/10 text-[#da552f]",
  appstore_review: "bg-[#007aff]/10 text-[#007aff]",
  appstore_ranking: "bg-[#007aff]/10 text-[#007aff]",
  playstore_review: "bg-[#34a853]/10 text-[#34a853]",
  playstore_ranking: "bg-[#34a853]/10 text-[#34a853]",
};

const KIND_LABELS: Record<string, string> = {
  conversation: "会话",
  observation: "观察",
  note: "笔记",
  idea: "创意",
  hackernews_story: "Hacker News 文章",
  reuters_news: "Reuters 新闻",
  cointelegraph_news: "Cointelegraph 新闻",
  cryptopanic_news: "CryptoPanic 新闻",
  investingnews_news: "Investing 新闻",
  x_post: "X 推文",
  reddit_post: "Reddit 帖子",
  github_repo: "GitHub 仓库",
  producthunt_product: "Product Hunt 产品",
  appstore_review: "App Store 评论",
  appstore_ranking: "App Store 榜单",
  playstore_review: "Play Store 评论",
  playstore_ranking: "Play Store 榜单",
  social_event: "社交事件",
  kan_route: "Kan 路由",
};

function KindBadge({ kind }: { readonly kind: string }) {
  return (
    <span
      className={cn(
        "inline-flex px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap",
        KIND_COLORS[kind] ?? "bg-bg-3 text-muted",
      )}
    >
      {KIND_LABELS[kind] ?? kind}
    </span>
  );
}

function ScoreBadge({ score }: { readonly score: number }) {
  const pct = Math.round(score * 100);
  const color =
    pct >= 70 ? "text-success" : pct >= 40 ? "text-warning" : "text-danger";
  return (
    <span className={cn("font-mono text-sm font-semibold", color)}>{pct}%</span>
  );
}

function StatCard({
  label,
  value,
  sub,
}: {
  readonly label: string;
  readonly value: string | number;
  readonly sub?: string;
}) {
  return (
    <div className="bg-bg-1 border border-border rounded-lg p-5">
      <div className="text-xs font-medium uppercase tracking-wide text-faint mb-2">
        {label}
      </div>
      <div className="font-heading text-2xl font-bold text-strong tracking-tight">
        {typeof value === "number" ? formatNumber(value) : value}
      </div>
      {sub && <div className="text-sm text-muted mt-1">{sub}</div>}
    </div>
  );
}

function ExpandableContent({
  content,
  maxLen = 120,
}: {
  readonly content: string;
  readonly maxLen?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const needsTruncation = content.length > maxLen;

  return (
    <div>
      <div className="text-sm text-muted leading-relaxed whitespace-pre-wrap break-words">
        {expanded || !needsTruncation
          ? content
          : `${content.slice(0, maxLen)}...`}
      </div>
      {needsTruncation && (
        <button
          type="button"
          className="text-xs text-accent mt-1 bg-transparent border-none cursor-pointer p-0 font-sans hover:underline"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "收起" : "展开更多"}
        </button>
      )}
    </div>
  );
}

export default function Memory() {
  const [stats, setStats] = useState<DebugStats | null>(null);
  const [chunks, setChunks] = useState<readonly ChunkEntry[]>([]);
  const [searchResults, setSearchResults] = useState<
    readonly SearchResultEntry[]
  >([]);
  const [agentMemory, setAgentMemory] = useState<readonly AgentMemoryEntry[]>(
    [],
  );
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useLocalStorage<ActiveTab>("memory:tab", "search");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchAgent, setSearchAgent] = useState("");
  const [searching, setSearching] = useState(false);
  const [chunkAgent, setChunkAgent] = useState("");
  const [kvAgent, setKvAgent] = useState("");
  const [deletingChunks, setDeletingChunks] = useState<ReadonlySet<string>>(new Set());

  const fetchStats = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await apiFetch<{ success: boolean; data: DebugStats }>(
        "/api/memory/debug/stats",
        signal ? { signal } : undefined,
      );
      if (signal?.aborted) return;
      if (res.success) setStats(res.data);
    } catch {
      // ignore
    }
  }, []);

  const chunkAbortRef = useRef<AbortController | null>(null);

  const fetchChunks = useCallback(async () => {
    chunkAbortRef.current?.abort();
    const controller = new AbortController();
    chunkAbortRef.current = controller;
    try {
      const qs = chunkAgent
        ? `?agentId=${encodeURIComponent(chunkAgent)}&limit=50`
        : "?limit=50";
      const res = await apiFetch<{
        success: boolean;
        data: readonly ChunkEntry[];
      }>(`/api/memory/debug/chunks${qs}`, { signal: controller.signal });
      if (controller.signal.aborted) return;
      if (res.success) setChunks(res.data);
    } catch {
      // ignore (includes abort)
    }
  }, [chunkAgent]);

  const kvAbortRef = useRef<AbortController | null>(null);

  const fetchAgentMemory = useCallback(async () => {
    kvAbortRef.current?.abort();
    const controller = new AbortController();
    kvAbortRef.current = controller;
    try {
      const qs = kvAgent ? `?agentId=${encodeURIComponent(kvAgent)}` : "";
      const res = await apiFetch<{
        success: boolean;
        data: readonly AgentMemoryEntry[];
      }>(`/api/memory/debug/agent-memory${qs}`, { signal: controller.signal });
      if (controller.signal.aborted) return;
      if (res.success) setAgentMemory(res.data);
    } catch {
      // ignore (includes abort)
    }
  }, [kvAgent]);

  useEffect(() => {
    const statsController = new AbortController();
    Promise.all([
      fetchStats(statsController.signal),
      fetchChunks(),
      fetchAgentMemory(),
    ]).finally(() => setLoading(false));
    const interval = setInterval(() => void fetchStats(), 30_000);
    return () => {
      clearInterval(interval);
      statsController.abort();
      chunkAbortRef.current?.abort();
      kvAbortRef.current?.abort();
    };
  }, [fetchStats, fetchChunks, fetchAgentMemory]);

  useEffect(() => {
    if (!loading) void fetchChunks();
  }, [chunkAgent, fetchChunks, loading]);

  useEffect(() => {
    if (!loading) void fetchAgentMemory();
  }, [kvAgent, fetchAgentMemory, loading]);

  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const params = new URLSearchParams({
        query: searchQuery.trim(),
        limit: "15",
      });
      if (searchAgent) params.set("agentId", searchAgent);
      const res = await apiFetch<{
        success: boolean;
        data: readonly SearchResultEntry[];
      }>(`/api/memory/debug/search?${params}`);
      if (res.success) setSearchResults(res.data);
    } catch {
      // ignore
    } finally {
      setSearching(false);
    }
  }, [searchQuery, searchAgent]);

  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") handleSearch();
    },
    [handleSearch],
  );

  const handleDeleteChunk = useCallback(async (chunkId: string, sourceId: string) => {
    setDeletingChunks((prev) => new Set([...prev, chunkId]));
    try {
      const res = await apiFetch<{ success: boolean; deletedSourceId?: string }>(
        `/api/memory/debug/chunks/${chunkId}`,
        { method: "DELETE" },
      );
      if (res.success) {
        // Remove all chunks from this source (cascade deletes siblings)
        setChunks((prev) => prev.filter((c) => c.sourceId !== sourceId));
        fetchStats();
      }
    } catch {
      // Chunk may already be gone (sibling cascade) — remove from UI
      setChunks((prev) => prev.filter((c) => c.id !== chunkId));
    } finally {
      setDeletingChunks((prev) => {
        const next = new Set([...prev]);
        next.delete(chunkId);
        return next;
      });
    }
  }, [fetchStats]);

  const agentIds = stats?.byAgent.map((a) => a.agentId) ?? [];

  if (loading) return <LoadingState message="正在加载记忆调试数据..." />;

  return (
    <div className="max-w-[1200px]">
      <PageHeader
        title="记忆"
        subtitle="调试 RAG 系统的切片、搜索和智能体键值记忆"
      />

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-4 gap-3 mb-6 max-md:grid-cols-2 max-sm:grid-cols-2">
          <StatCard label="切片总数" value={stats.totalChunks} />
          <StatCard label="来源总数" value={stats.totalSources} />
          <StatCard
            label="Token 总数"
            value={stats.totalTokens}
            sub={`约 ${formatNumber(Math.round(stats.totalTokens / 250))} 页`}
          />
          <StatCard
            label="有键值记忆的智能体"
            value={stats.agentsWithMemory}
          />
        </div>
      )}

      {/* Kind breakdown */}
      {stats && stats.byKind.length > 0 && (
        <div className="flex gap-2 flex-wrap mb-6">
          {stats.byKind.map((k) => (
            <div
              key={k.kind}
              className="flex items-center gap-2 bg-bg-1 border border-border rounded-md px-3 py-1.5"
            >
              <KindBadge kind={k.kind} />
              <span className="font-mono text-sm text-muted">
                {formatNumber(k.count)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Model Configuration */}
      <div className="bg-bg-1 border border-border rounded-xl p-5 mb-6 transition-all duration-200 hover:border-border-hover">
        <div className="text-xs font-semibold uppercase tracking-widest text-accent mb-4 pb-2 border-b border-border">
          模型配置
        </div>
        <ModelRoutePicker processKey="signal.facets" label="信号切面" />
        <ModelRoutePicker processKey="signal.observations" label="观察提取" />
      </div>

      {/* Tab Bar */}
      <div className="flex gap-1 mb-5 p-1 bg-bg-1 border border-border rounded-lg w-fit">
        {(
          [
            { id: "search" as const, label: "搜索测试" },
            { id: "chunks" as const, label: "最近切片" },
            { id: "kv" as const, label: "智能体记忆" },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            className={cn(
              "px-4 py-2 rounded-md text-sm font-medium cursor-pointer border-none font-sans transition-colors",
              activeTab === t.id
                ? "bg-accent-subtle text-accent"
                : "bg-transparent text-muted hover:text-strong hover:bg-bg-2",
            )}
            onClick={() => setActiveTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Search Test Panel */}
      {activeTab === "search" && (
        <div>
          <div className="flex gap-3 mb-5 max-sm:flex-col">
            <div className="flex-1 relative">
              <input
                type="text"
                className="w-full py-2.5 px-4 rounded-lg border border-border-2 bg-bg text-foreground text-base outline-none transition-colors focus:border-accent placeholder:text-faint"
                placeholder="输入查询内容，测试记忆检索..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={handleSearchKeyDown}
              />
            </div>
            <select
              className="py-2 px-3 rounded-lg border border-border bg-bg-1 text-muted font-sans text-sm cursor-pointer outline-none h-[42px] min-w-[140px] focus:border-accent"
              value={searchAgent}
              onChange={(e) => setSearchAgent(e.target.value)}
            >
              <option value="">全部智能体</option>
              {agentIds.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
            <button
              type="button"
              className={cn(
                "px-5 py-2 rounded-lg border-none text-sm font-semibold cursor-pointer transition-colors h-[42px] shrink-0",
                searching
                  ? "bg-bg-3 text-faint cursor-not-allowed"
                  : "bg-accent text-white hover:bg-accent-hover",
              )}
              disabled={searching || !searchQuery.trim()}
              onClick={handleSearch}
            >
              {searching ? "搜索中..." : "搜索"}
            </button>
          </div>

          {searchResults.length > 0 ? (
            <div className="flex flex-col gap-2">
              {searchResults.map((r, i) => (
                <div
                  key={`${r.chunkId}-${i}`}
                  className="bg-bg-1 border border-border rounded-lg p-4 hover:border-border-2 transition-colors"
                >
                  <div className="flex items-center gap-3 mb-2 flex-wrap">
                    <span className="font-mono text-xs text-faint">
                      #{i + 1}
                    </span>
                    <ScoreBadge score={r.score} />
                    <KindBadge kind={r.source.kind} />
                    <span className="text-xs text-faint font-mono">
                      {r.source.agentId}
                    </span>
                    <span className="text-xs text-faint ml-auto">
                      {relativeTime(r.createdAt)}
                    </span>
                  </div>
                  <ExpandableContent content={r.content} maxLen={200} />
                  <div className="flex items-center gap-3 mt-2 text-xs text-faint">
                    <span>{r.tokenCount} tokens</span>
                    {r.source.channel && <span>来自 {r.source.channel}</span>}
                  </div>
                </div>
              ))}
            </div>
          ) : searchQuery && !searching ? (
            <EmptyState
              title="没有结果"
              description="没有记忆切片匹配当前查询，可以换一个关键词或智能体。"
            />
          ) : (
            <EmptyState
              title="测试记忆搜索"
              description="在上方输入查询内容，查看智能体会从 RAG 系统获得哪些结果。"
            />
          )}
        </div>
      )}

      {/* Recent Chunks */}
      {activeTab === "chunks" && (
        <div>
          <div className="mb-4 max-w-xs">
            <select
              className="w-full py-2 px-3 rounded-lg border border-border bg-bg-1 text-muted font-sans text-sm cursor-pointer outline-none focus:border-accent"
              value={chunkAgent}
              onChange={(e) => setChunkAgent(e.target.value)}
            >
              <option value="">全部智能体</option>
              {agentIds.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </div>

          {chunks.length === 0 ? (
            <EmptyState
              title="暂无切片"
              description="当前没有找到记忆切片。"
            />
          ) : (
            <div className="border border-border rounded-lg overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-border bg-bg-1">
                      <th className="text-left py-2.5 px-3 text-xs font-semibold uppercase tracking-wide text-faint">
                        智能体
                      </th>
                      <th className="text-left py-2.5 px-3 text-xs font-semibold uppercase tracking-wide text-faint">
                        类型
                      </th>
                      <th className="text-left py-2.5 px-3 text-xs font-semibold uppercase tracking-wide text-faint min-w-[300px]">
                        内容
                      </th>
                      <th className="text-left py-2.5 px-3 text-xs font-semibold uppercase tracking-wide text-faint">
                        Tokens
                      </th>
                      <th className="text-left py-2.5 px-3 text-xs font-semibold uppercase tracking-wide text-faint">
                        时间
                      </th>
                      <th className="py-2.5 px-3 w-[50px]" />
                    </tr>
                  </thead>
                  <tbody>
                    {chunks.map((chunk) => (
                      <tr
                        key={chunk.id}
                        className="border-b border-border last:border-b-0 hover:bg-bg-1/50 transition-colors"
                      >
                        <td className="py-2.5 px-3 font-mono text-xs text-muted whitespace-nowrap">
                          {chunk.agentId}
                        </td>
                        <td className="py-2.5 px-3">
                          <KindBadge kind={chunk.kind} />
                        </td>
                        <td className="py-2.5 px-3">
                          <ExpandableContent
                            content={chunk.content}
                            maxLen={100}
                          />
                        </td>
                        <td className="py-2.5 px-3 font-mono text-xs text-faint whitespace-nowrap">
                          {chunk.tokenCount}
                        </td>
                        <td className="py-2.5 px-3 text-xs text-faint whitespace-nowrap">
                          {relativeTime(chunk.createdAt)}
                        </td>
                        <td className="py-2.5 px-3">
                          <button
                            type="button"
                            className={cn(
                              "px-2 py-1 rounded text-xs font-medium border-none cursor-pointer transition-colors",
                              deletingChunks.has(chunk.id)
                                ? "bg-bg-3 text-faint cursor-not-allowed"
                                : "bg-transparent text-faint hover:text-danger hover:bg-danger/10",
                            )}
                            disabled={deletingChunks.has(chunk.id)}
                            onClick={() => handleDeleteChunk(chunk.id, chunk.sourceId)}
                            title="删除这个记忆切片"
                          >
                            {deletingChunks.has(chunk.id) ? "..." : "\u2715"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Agent Memory (KV) */}
      {activeTab === "kv" && (
        <div>
          <div className="mb-4 max-w-xs">
            <select
              className="w-full py-2 px-3 rounded-lg border border-border bg-bg-1 text-muted font-sans text-sm cursor-pointer outline-none focus:border-accent"
              value={kvAgent}
              onChange={(e) => setKvAgent(e.target.value)}
            >
              <option value="">全部智能体</option>
              {agentIds.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </div>

          {agentMemory.length === 0 ? (
            <EmptyState
              title="暂无智能体记忆"
              description="当前没有找到键值记忆条目。"
            />
          ) : (
            <div className="border border-border rounded-lg overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-border bg-bg-1">
                      <th className="text-left py-2.5 px-3 text-xs font-semibold uppercase tracking-wide text-faint">
                        智能体
                      </th>
                      <th className="text-left py-2.5 px-3 text-xs font-semibold uppercase tracking-wide text-faint">
                        键
                      </th>
                      <th className="text-left py-2.5 px-3 text-xs font-semibold uppercase tracking-wide text-faint min-w-[300px]">
                        值
                      </th>
                      <th className="text-left py-2.5 px-3 text-xs font-semibold uppercase tracking-wide text-faint">
                        更新时间
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {agentMemory.map((entry) => (
                      <tr
                        key={`${entry.agentId}-${entry.key}`}
                        className="border-b border-border last:border-b-0 hover:bg-bg-1/50 transition-colors"
                      >
                        <td className="py-2.5 px-3 font-mono text-xs text-muted whitespace-nowrap">
                          {entry.agentId}
                        </td>
                        <td className="py-2.5 px-3 font-mono text-xs text-accent whitespace-nowrap">
                          {entry.key}
                        </td>
                        <td className="py-2.5 px-3">
                          <ExpandableContent
                            content={entry.value}
                            maxLen={120}
                          />
                        </td>
                        <td className="py-2.5 px-3 text-xs text-faint whitespace-nowrap">
                          {relativeTime(entry.updatedAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
