import { useState, useEffect, useCallback } from "react";
import { useLocalStorage } from "../../lib/useLocalStorage";
import { apiFetch, deleteAgent, updateAgent, setConfigHash } from "../../api";
import { agentsResponseSchema } from "../../lib/schemas";
import type {
  AgentInfo,
  AgentDetail,
  AgentsResponse,
  AgentDetailResponse,
  MutationResponse,
  ProviderFilter,
} from "./types";
import { AlibabaTokenPlan } from "./AlibabaTokenPlan";
import { AgentCard } from "./AgentCard";
import { AgentFormModal, DeleteDialog } from "./AgentFormModal";
import { DetailPanel } from "./DetailPanel";
import {
  Button,
  PageHeader,
  LoadingState,
  EmptyState,
  SearchBar,
  FilterTabs,
  ModelRoutePicker,
} from "../../components";
import { useToast } from "../../components/Toast";

/* ───── Constants ───── */
const PROVIDER_TABS = [
  { id: "all", label: "全部" },
  { id: "agent-sdk", label: "Agent SDK" },
  { id: "anthropic", label: "Anthropic" },
  { id: "openrouter", label: "OpenRouter" },
  { id: "alibaba", label: "阿里云" },
  { id: "minimax", label: "MiniMax" },
  { id: "opencode", label: "OpenCode Zen" },
] as const;

/* ===============================================
   Main Page Component
   =============================================== */
export default function Agents() {
  const toast = useToast();
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [providerFilter, setProviderFilter] = useLocalStorage<ProviderFilter>("agents:providerFilter", "all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  /* Modal state */
  const [showCreate, setShowCreate] = useState(false);
  const [editingAgent, setEditingAgent] = useState<AgentDetail | null>(null);
  const [deletingAgent, setDeletingAgent] = useState<AgentInfo | null>(null);

  /* In-flight guard — prevents double-submit on delete / set-default */
  const [pendingId, setPendingId] = useState<string | null>(null);

  const loadAgents = useCallback(async () => {
    try {
      const parsed = await apiFetch("/api/agents", {}, {
        schema: agentsResponseSchema,
      });
      const res = parsed as unknown as AgentsResponse;
      if (res.success) {
        setAgents(res.data);
        if (res.configHash) setConfigHash(res.configHash);
      } else {
        setError("智能体加载失败");
      }
    } catch {
      setError("智能体加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAgents();
  }, [loadAgents]);

  async function handleDelete(agentId: string) {
    if (pendingId !== null) return;
    setPendingId(agentId);
    try {
      const res = (await deleteAgent(agentId)) as MutationResponse;
      if (res.configHash) setConfigHash(res.configHash);
      setDeletingAgent(null);
      setSelectedId(null);
      await loadAgents();
    } catch (err) {
      const apiErr = err as { status?: number };
      if (apiErr.status === 409) {
        await loadAgents();
      } else {
        toast.error("删除智能体失败");
      }
      setDeletingAgent(null);
    } finally {
      setPendingId(null);
    }
  }

  async function handleSetDefault(agentId: string) {
    if (pendingId !== null) return;
    setPendingId(agentId);
    try {
      const res = (await updateAgent(agentId, { default: true })) as MutationResponse;
      if (res.configHash) setConfigHash(res.configHash);
      toast.success("默认智能体已更新");
      await loadAgents();
    } catch (err) {
      const apiErr = err as { status?: number };
      if (apiErr.status === 409) {
        await loadAgents();
      } else {
        toast.error("设置默认智能体失败");
      }
    } finally {
      setPendingId(null);
    }
  }

  async function handleEditClick(agent: AgentInfo) {
    try {
      const res = await apiFetch<AgentDetailResponse>(
        `/api/agents/${agent.id}`,
      );
      if (res.success) {
        setEditingAgent(res.data);
        if (res.configHash) setConfigHash(res.configHash);
      }
    } catch {
      toast.error("智能体详情加载失败");
    }
  }

  /* Filtering */
  const filtered = agents.filter((a) => {
    const matchesSearch =
      a.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      a.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      a.description.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesProvider =
      providerFilter === "all" || a.provider === providerFilter;
    return matchesSearch && matchesProvider;
  });

  /* Provider counts for filter tabs */
  const providerCounts: Record<ProviderFilter, number> = {
    all: agents.length,
    "agent-sdk": agents.filter((a) => a.provider === "agent-sdk").length,
    anthropic: agents.filter((a) => a.provider === "anthropic").length,
    openrouter: agents.filter((a) => a.provider === "openrouter").length,
    alibaba: agents.filter((a) => a.provider === "alibaba").length,
    minimax: agents.filter((a) => a.provider === "minimax").length,
    opencode: agents.filter((a) => a.provider === "opencode").length,
  };

  const selectedAgent = selectedId
    ? agents.find((a) => a.id === selectedId)
    : null;

  /* ───── Loading ───── */
  if (loading) {
    return <LoadingState message="正在加载智能体..." />;
  }

  /* ───── Error ───── */
  if (error) {
    return (
      <div className="flex flex-col items-center gap-4 px-8 py-16 text-danger text-center">
        <p>{error}</p>
        <Button variant="primary" size="sm" onClick={loadAgents}>
          重试
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-0">
      {/* --- Header --- */}
      <PageHeader
        title="智能体"
        subtitle="查看和管理所有平台智能体、模型和工具配置"
        count={agents.length}
        actions={
          <Button onClick={() => setShowCreate(true)}>
            <svg
              width="13"
              height="13"
              viewBox="0 0 14 14"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <path d="M7 1v12M1 7h12" />
            </svg>
            新建智能体
          </Button>
        }
      />

      {/* --- Toolbar: Filter tabs + Search --- */}
      <div className="flex items-center justify-between gap-4 mb-6 pb-4 border-b border-border flex-wrap">
        <FilterTabs
          tabs={PROVIDER_TABS.map((t) => ({
            id: t.id,
            label: t.label,
            count: providerCounts[t.id],
          }))}
          active={providerFilter}
          onChange={(id) => setProviderFilter(id as ProviderFilter)}
        />
        <div className="min-w-[200px] max-w-[260px] shrink-0">
          <SearchBar
            value={searchTerm}
            onChange={setSearchTerm}
            placeholder="搜索智能体..."
          />
        </div>
      </div>

      {/* --- Alibaba Token Plan credentials --- */}
      <AlibabaTokenPlan />

      {/* --- Tool Template Model --- */}
      <div className="bg-bg-1 border border-border rounded-xl p-5 mb-6 transition-all duration-200 hover:border-border-hover">
        <div className="text-xs font-semibold uppercase tracking-widest text-accent mb-4 pb-2 border-b border-border">
          工具模板模型
        </div>
        <ModelRoutePicker processKey="agent-templates" label="智能体模板" />
      </div>

      {/* --- Main content area --- */}
      <div className="relative">
        {/* Cards Grid */}
        {filtered.length === 0 ? (
          <EmptyState
            title={
              searchTerm || providerFilter !== "all"
                ? "没有匹配的智能体"
                : "暂无智能体"
            }
            description={
              searchTerm || providerFilter !== "all"
                ? "请调整搜索词或筛选条件。"
                : "先创建第一个智能体。"
            }
          />
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-4">
            {filtered.map((agent) => (
              <AgentCard
                key={agent.id}
                agent={agent}
                isSelected={selectedId === agent.id}
                onSelect={() =>
                  setSelectedId(selectedId === agent.id ? null : agent.id)
                }
                onEdit={() => handleEditClick(agent)}
                onDelete={() => setDeletingAgent(agent)}
                onSetDefault={() => handleSetDefault(agent.id)}
                isPending={pendingId === agent.id}
              />
            ))}
          </div>
        )}

        {/* Detail Panel */}
        {selectedAgent && (
          <DetailPanel
            agent={selectedAgent}
            onClose={() => setSelectedId(null)}
            onEdit={() => handleEditClick(selectedAgent)}
            onDelete={() => setDeletingAgent(selectedAgent)}
            onSetDefault={() => handleSetDefault(selectedAgent.id)}
            isPending={pendingId === selectedAgent.id}
          />
        )}
      </div>

      {/* --- Modals --- */}
      {showCreate && (
        <AgentFormModal
          mode="create"
          onDone={() => {
            setShowCreate(false);
            loadAgents();
          }}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {editingAgent && (
        <AgentFormModal
          mode="edit"
          initial={editingAgent}
          onDone={() => {
            setEditingAgent(null);
            loadAgents();
          }}
          onCancel={() => setEditingAgent(null)}
        />
      )}

      {deletingAgent && (
        <DeleteDialog
          agentName={deletingAgent.name}
          onConfirm={() => handleDelete(deletingAgent.id)}
          onCancel={() => setDeletingAgent(null)}
          loading={pendingId === deletingAgent.id}
        />
      )}
    </div>
  );
}
