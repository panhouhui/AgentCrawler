import { AlertTriangle, Database, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { apiFetch } from "../../api";
import { Button } from "../../components";
import { useToast } from "../../components/Toast";

/**
 * Embeddings & Memory settings section.
 *
 * Covers two controls that the existing embeddings UI does NOT:
 *  - Memory backend (config/memory) — qdrant | mem0. Restart required.
 *  - Guarded embeddings-dimensions change — changing the vector size requires a
 *    full Qdrant re-index, so we warn loudly and require explicit confirmation
 *    before persisting. The 409 the route returns is surfaced as the confirm
 *    prompt; the user must opt in (confirmReindex) to actually apply it.
 *
 * The general embeddings form (provider/model/batch size) stays in the existing
 * Settings.tsx EmbeddingsSection — this section is additive.
 */

type MemoryBackend = "qdrant" | "mem0";

interface DomainState {
  readonly memory: { readonly backend: MemoryBackend; readonly source: string };
  readonly embeddings: { readonly dimensions: number };
}

const BASE = "/api/config/embeddings-memory";

function RestartNotice() {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-medium text-warning bg-warning-subtle px-1.5 py-0.5 rounded-full">
      <RotateCcw className="w-2.5 h-2.5" />
      重启后生效
    </span>
  );
}

function MemoryBackendField({
  value,
  onChange,
  disabled,
}: {
  readonly value: MemoryBackend;
  readonly onChange: (v: MemoryBackend) => void;
  readonly disabled: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <div className="text-xs font-medium text-foreground flex items-center gap-2">
          记忆后端
          <RestartNotice />
        </div>
        <div className="text-xs text-muted mt-0.5">
          用于保存爬虫信号记忆的存储后端。qdrant 是当前默认后端，mem0 用于后续阶段。
        </div>
      </div>
      <select
        className="w-40 shrink-0 bg-bg-2 border border-border rounded-md px-2 py-1 text-xs text-foreground focus:outline-none focus:border-accent disabled:opacity-50"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as MemoryBackend)}
      >
        <option value="qdrant">qdrant</option>
        <option value="mem0">mem0</option>
      </select>
    </div>
  );
}

function DimensionsField({
  value,
  onChange,
  disabled,
}: {
  readonly value: number;
  readonly onChange: (v: number) => void;
  readonly disabled: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <div className="text-xs font-medium text-foreground flex items-center gap-2">
          向量维度
          <RestartNotice />
        </div>
        <div className="text-xs text-muted mt-0.5">
          向量维度必须与 Qdrant 集合一致；修改后需要完整重建所有向量索引。
        </div>
      </div>
      <input
        type="number"
        min={32}
        max={4096}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-24 shrink-0 bg-bg-2 border border-border rounded-md px-2 py-1 text-xs text-foreground text-right focus:outline-none focus:border-accent disabled:opacity-50"
      />
    </div>
  );
}

export default function EmbeddingsMemorySettings() {
  const { success, error: toastError } = useToast();
  const [state, setState] = useState<DomainState | null>(null);
  const [loading, setLoading] = useState(true);

  const [backendDraft, setBackendDraft] = useState<MemoryBackend>("qdrant");
  const [dimsDraft, setDimsDraft] = useState<number>(512);

  const [savingBackend, setSavingBackend] = useState(false);
  const [savingDims, setSavingDims] = useState(false);
  const [confirmReindex, setConfirmReindex] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch<{ data: DomainState }>(BASE);
        if (cancelled) return;
        setState(res.data);
        setBackendDraft(res.data.memory.backend);
        setDimsDraft(res.data.embeddings.dimensions);
      } catch {
        if (!cancelled) toastError("向量与记忆配置加载失败。");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [toastError]);

  const backendDirty = state !== null && backendDraft !== state.memory.backend;
  const dimsDirty = state !== null && dimsDraft !== state.embeddings.dimensions;

  async function saveBackend() {
    setSavingBackend(true);
    try {
      await apiFetch(`${BASE}/memory`, {
        method: "PUT",
        body: JSON.stringify({ backend: backendDraft }),
      });
      setState((prev) =>
        prev ? { ...prev, memory: { backend: backendDraft, source: "override" } } : prev,
      );
      success("记忆后端已保存，重启后生效。");
    } catch {
      toastError("记忆后端保存失败。");
    } finally {
      setSavingBackend(false);
    }
  }

  async function saveDimensions() {
    setSavingDims(true);
    try {
      await apiFetch(`${BASE}/embeddings/dimensions`, {
        method: "PUT",
        body: JSON.stringify({ dimensions: dimsDraft, confirmReindex }),
      });
      setState((prev) => (prev ? { ...prev, embeddings: { dimensions: dimsDraft } } : prev));
      setConfirmReindex(false);
      success("向量维度已修改，需要重建索引。");
    } catch (err) {
      // 409 = needs confirmation; any other = generic failure.
      const status = (err as { status?: number }).status;
      if (status === 409) {
        toastError("请先确认需要重建索引后再修改维度。");
      } else {
        toastError("向量维度修改失败。");
      }
    } finally {
      setSavingDims(false);
    }
  }

  if (loading || state === null) {
    return <p className="text-xs text-muted py-2">正在加载向量与记忆配置...</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Database className="w-4 h-4 text-muted" />
        <h3 className="text-sm font-semibold text-foreground">向量与记忆</h3>
      </div>

      <div className="bg-bg-2 border border-border rounded-lg p-3 flex flex-col gap-3">
        <MemoryBackendField
          value={backendDraft}
          onChange={setBackendDraft}
          disabled={savingBackend}
        />
        {backendDirty && (
          <div className="flex justify-end gap-2 pt-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setBackendDraft(state.memory.backend)}
              disabled={savingBackend}
            >
              取消
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={saveBackend}
              disabled={savingBackend}
              loading={savingBackend}
            >
              保存
            </Button>
          </div>
        )}
      </div>

      <div className="bg-bg-2 border border-border rounded-lg p-3 flex flex-col gap-3">
        <DimensionsField value={dimsDraft} onChange={setDimsDraft} disabled={savingDims} />

        {dimsDirty && (
          <div className="flex flex-col gap-3 border-t border-border pt-3">
            <div className="flex items-start gap-2 text-xs text-warning bg-warning-subtle rounded-md p-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                将维度从 <strong>{state.embeddings.dimensions}</strong> 改为{" "}
                <strong>{dimsDraft}</strong> 会让已有向量失效。必须重建 Qdrant 集合并重新索引后，
                检索才能恢复正常。
              </span>
            </div>
            <label className="flex items-center gap-2 text-xs text-foreground cursor-pointer">
              <input
                type="checkbox"
                checked={confirmReindex}
                onChange={(e) => setConfirmReindex(e.target.checked)}
                className="accent-accent"
              />
              我已确认需要完整重建 Qdrant 索引。
            </label>
            <div className="flex justify-end gap-2 pt-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setDimsDraft(state.embeddings.dimensions);
                  setConfirmReindex(false);
                }}
                disabled={savingDims}
              >
                取消
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={saveDimensions}
                disabled={savingDims || !confirmReindex}
                loading={savingDims}
              >
                修改并标记需要重建索引
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
