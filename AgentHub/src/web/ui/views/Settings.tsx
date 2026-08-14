import { useState, useEffect, useId } from "react";
import { apiFetch } from "../api";
import { LoadingState, PageHeader, Toggle, Button } from "../components";
import { useToast } from "../components/Toast";
import {
  Database,
  ChevronRight,
  ChevronDown,
  Circle,
  Settings as SettingsIcon,
} from "lucide-react";
import SignalsSettings from "./settings/SignalsSettings";
import SigeSettings from "./settings/SigeSettings";
import IdeasSettings from "./settings/IdeasSettings";
import GraphSettings from "./settings/GraphSettings";
import EmbeddingsMemorySettings from "./settings/Embeddings-memorySettings";
import RuntimeSettings from "./settings/RuntimeSettings";

/* ── Settings sub-tabs ──
 * The app-level Sidebar routes a single "settings" tab to this view; rather
 * than add many top-level nav entries we expose a grouped "Configuration" area
 * as in-view tabs. "Features" covers infra switches; the rest are
 * the config-as-data sections (each self-contained, persisting a partial
 * config_overrides row the loader deep-merges over env + schema defaults).
 */
const SETTINGS_TABS = [
  { id: "features", label: "功能开关" },
  { id: "signals", label: "信号" },
  { id: "ideas", label: "创意" },
  { id: "sige", label: "SIGE" },
  { id: "graph", label: "图谱" },
  { id: "embeddings-memory", label: "向量与记忆" },
  { id: "runtime", label: "运行时" },
] as const;

type SettingsTabId = (typeof SETTINGS_TABS)[number]["id"];

interface EmbeddingsConfig {
  readonly provider: "openrouter";
  readonly dimensions: number;
  readonly openrouterModel: string;
  readonly batchSize: number;
}

interface FeaturesResponse {
  readonly qdrant: { readonly enabled: boolean };
  readonly embeddings: EmbeddingsConfig;
}

/* ── Status pill ── */
function StatusPill({ enabled }: { readonly enabled: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full ${
        enabled
          ? "bg-success-subtle text-success"
          : "bg-bg-3 text-muted"
      }`}
    >
      <Circle
        className={`w-1.5 h-1.5 ${enabled ? "fill-success" : "fill-muted"}`}
        strokeWidth={0}
      />
      {enabled ? "已启用" : "关闭"}
    </span>
  );
}

/* ── Config field ── */
function ConfigField({
  label,
  description,
  value,
  min,
  max,
  onChange,
}: {
  readonly label: string;
  readonly description: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly onChange: (v: number) => void;
}) {
  const baseId = useId();
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <div id={`${baseId}-label`} className="text-xs font-medium text-foreground">{label}</div>
        <div id={`${baseId}-desc`} className="text-xs text-muted mt-0.5">{description}</div>
      </div>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        aria-labelledby={`${baseId}-label`}
        aria-describedby={`${baseId}-desc`}
        onChange={(e) => {
          const n = parseInt(e.target.value, 10);
          if (!isNaN(n)) onChange(n);
        }}
        className="w-20 shrink-0 bg-bg-2 border border-border rounded-md px-2 py-1 text-xs text-foreground text-right focus:outline-none focus:border-accent"
      />
    </div>
  );
}

/* ── Text config field ── */
function TextConfigField({
  label,
  description,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  readonly label: string;
  readonly description: string;
  readonly value: string;
  readonly onChange: (v: string) => void;
  readonly placeholder?: string;
  readonly type?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <div className="text-xs font-medium text-foreground">{label}</div>
        <div className="text-xs text-muted mt-0.5">{description}</div>
      </div>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-56 shrink-0 bg-bg-2 border border-border rounded-md px-2 py-1 text-xs text-foreground focus:outline-none focus:border-accent"
      />
    </div>
  );
}


/* ── Embeddings config section (shown under Qdrant card when expanded) ── */
function EmbeddingsSection({
  config,
  onSave,
}: {
  readonly config: EmbeddingsConfig;
  readonly onSave: (config: EmbeddingsConfig) => void;
}) {
  const { success, error: toastError } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState<EmbeddingsConfig>(config);
  const [saving, setSaving] = useState(false);

  const isDirty = JSON.stringify(draft) !== JSON.stringify(config);

  function update<K extends keyof EmbeddingsConfig>(
    key: K,
    value: EmbeddingsConfig[K],
  ) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    setSaving(true);
    try {
      await apiFetch("/api/features/embeddings", {
        method: "PUT",
        body: JSON.stringify(draft),
      });
      onSave(draft);
      window.dispatchEvent(new Event("features-changed"));
      success("向量配置已保存。");
    } catch {
      toastError("向量配置保存失败。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-3 ml-[50px]">
      <button
        type="button"
        className="flex items-center gap-1.5 text-xs text-muted hover:text-foreground bg-transparent border-none cursor-pointer p-0"
        onClick={() => setExpanded((p) => !p)}
      >
        {expanded ? (
          <ChevronDown className="w-3 h-3" />
        ) : (
          <ChevronRight className="w-3 h-3" />
        )}
        <span>向量配置</span>
        {isDirty && (
          <span className="text-xs font-medium text-warning bg-warning-subtle px-1.5 py-0.5 rounded-full ml-1">
            未保存
          </span>
        )}
      </button>

      {expanded && (
        <div className="mt-2 bg-bg-2 border border-border rounded-lg p-3 flex flex-col gap-3">
          <TextConfigField
            label="OpenRouter 模型"
            description="OpenRouter 上的模型 ID"
            value={draft.openrouterModel}
            onChange={(v) => update("openrouterModel", v)}
            placeholder="openai/text-embedding-3-small"
          />

          <ConfigField
            label="向量维度"
            description="向量嵌入维度，需要与 Qdrant collection 保持一致"
            value={draft.dimensions}
            min={32}
            max={4096}
            onChange={(v) => update("dimensions", v)}
          />

          <ConfigField
            label="批量大小"
            description="每批 API 请求最多处理的文本数"
            value={draft.batchSize}
            min={1}
            max={256}
            onChange={(v) => update("batchSize", v)}
          />

          {isDirty && (
            <div className="flex justify-end gap-2 pt-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDraft(config)}
                disabled={saving}
              >
                取消
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleSave}
                disabled={saving}
                loading={saving}
              >
                保存
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Features section ── */
function FeaturesSettings() {
  const { success, error: toastError } = useToast();

  const [features, setFeatures] = useState<FeaturesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [qdrantSaving, setQdrantSaving] = useState(false);
  const [embeddingsConfig, setEmbeddingsConfig] =
    useState<EmbeddingsConfig | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch<{ data: FeaturesResponse }>("/api/features");
        if (cancelled) return;
        setFeatures(res.data);
        setEmbeddingsConfig(res.data.embeddings);
      } catch {
        if (!cancelled) toastError("功能设置加载失败。");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleQdrantToggle(checked: boolean) {
    if (!features) return;
    setQdrantSaving(true);
    try {
      await apiFetch("/api/features/qdrant", {
        method: "PUT",
        body: JSON.stringify({ enabled: checked }),
      });
      setFeatures((prev) =>
        prev ? { ...prev, qdrant: { enabled: checked } } : prev,
      );
      window.dispatchEvent(new Event("features-changed"));
      success(`Qdrant ${checked ? "已启用" : "已关闭"}。`);
    } catch {
      toastError("Qdrant 设置更新失败。");
    } finally {
      setQdrantSaving(false);
    }
  }

  if (loading) return <LoadingState message="正在加载设置..." />;
  if (!features) return null;

  return (
    <div>
      <div className="flex items-center justify-end mb-3 gap-2 text-xs text-muted">
        <SettingsIcon className="w-3.5 h-3.5" />
        <span>
          {features.qdrant.enabled ? "Qdrant" : "全部功能已关闭"}
        </span>
      </div>

      <div className="flex flex-col gap-3">
        {/* Qdrant + Embeddings */}
        <div className="bg-bg-1 border border-border rounded-xl p-5 transition-all duration-200 hover:border-border-hover">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3.5 min-w-0">
              <div className="shrink-0 w-9 h-9 rounded-lg flex items-center justify-center bg-accent-subtle text-accent">
                <Database className="w-[18px] h-[18px]" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2.5 mb-1">
                  <h3 className="text-sm font-semibold text-strong m-0">
                    Qdrant（RAG 记忆）
                  </h3>
                  <StatusPill enabled={features.qdrant.enabled} />
                </div>
                <p className="text-xs text-muted m-0 leading-relaxed">
                  用于智能体长期记忆和语义搜索的向量数据库。
                </p>
              </div>
            </div>
            <Toggle
              checked={features.qdrant.enabled}
              onChange={handleQdrantToggle}
              disabled={qdrantSaving}
            />
          </div>
          <div className="mt-3 ml-[50px] text-xs text-faint">
            {features.qdrant.enabled
              ? "智能体可以通过 RAG 检索读写长期记忆。"
              : "所有智能体暂时无法使用 RAG 记忆。"}
          </div>
          {features.qdrant.enabled && embeddingsConfig && (
            <EmbeddingsSection
              config={embeddingsConfig}
              onSave={setEmbeddingsConfig}
            />
          )}
        </div>

      </div>
    </div>
  );
}

/* ── Settings tab bar ── */
function SettingsTabs({
  active,
  onSelect,
}: {
  readonly active: SettingsTabId;
  readonly onSelect: (id: SettingsTabId) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1 border-b border-border mb-5">
      {SETTINGS_TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onSelect(t.id)}
          className={`px-3 py-2 text-xs font-medium border-b-2 -mb-px transition-colors ${
            active === t.id
              ? "border-accent text-foreground"
              : "border-transparent text-muted hover:text-foreground"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/* ── Main ──
 * Groups infrastructure (Features) and config-as-data sections under one
 * "Configuration" area via in-view tabs, keeping the app-level Sidebar simple.
 */
export default function Settings() {
  const [tab, setTab] = useState<SettingsTabId>("features");

  return (
    <div className="max-w-[760px]">
      <PageHeader
        title="设置"
        subtitle="管理基础设施、信号、创意、SIGE、图谱和运行时配置"
      />
      <SettingsTabs active={tab} onSelect={setTab} />
      {tab === "features" && <FeaturesSettings />}
      {tab === "signals" && <SignalsSettings />}
      {tab === "ideas" && <IdeasSettings />}
      {tab === "sige" && <SigeSettings />}
      {tab === "graph" && <GraphSettings />}
      {tab === "embeddings-memory" && <EmbeddingsMemorySettings />}
      {tab === "runtime" && <RuntimeSettings />}
    </div>
  );
}
