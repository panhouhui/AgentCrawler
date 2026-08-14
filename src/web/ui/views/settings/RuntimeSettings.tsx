import { useEffect, useId, useState } from "react";
import { apiFetch } from "../../api";
import { Button, LoadingState, Toggle } from "../../components";
import { useToast } from "../../components/Toast";
import { AlertTriangle, RotateCcw, Server, ShieldAlert } from "lucide-react";

/* ── API response shapes ── */
interface ServerConfig {
  readonly webHost: string;
  readonly webPort: number;
  readonly logLevel: "debug" | "info" | "warn" | "error";
  readonly browserEnabled: boolean;
}

interface SandboxConfig {
  readonly toolsSandbox: "off" | "best-effort" | "required";
  readonly devToolsAllowNetwork: boolean;
  readonly allowUnsandboxedDevTools: boolean;
}

const LOG_LEVELS: readonly ServerConfig["logLevel"][] = [
  "debug",
  "info",
  "warn",
  "error",
];

const SANDBOX_MODES: readonly SandboxConfig["toolsSandbox"][] = [
  "off",
  "best-effort",
  "required",
];

const LOG_LEVEL_LABELS: Record<ServerConfig["logLevel"], string> = {
  debug: "调试",
  info: "信息",
  warn: "警告",
  error: "错误",
};

const SANDBOX_MODE_LABELS: Record<SandboxConfig["toolsSandbox"], string> = {
  off: "关闭",
  "best-effort": "优先启用",
  required: "必须启用",
};

/* ── Restart notice ── */
function RestartNotice() {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-warning">
      <RotateCcw className="w-3 h-3" />
      重启后生效
    </span>
  );
}

/* ── Labelled row wrapper ── */
function FieldRow({
  label,
  description,
  control,
  danger,
}: {
  readonly label: string;
  readonly description: string;
  readonly control: React.ReactNode;
  readonly danger?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          {danger && (
            <ShieldAlert className="w-3.5 h-3.5 text-danger shrink-0" />
          )}
          <span
            className={`text-xs font-medium ${danger ? "text-danger" : "text-foreground"}`}
          >
            {label}
          </span>
        </div>
        <div className="text-xs text-muted mt-0.5">{description}</div>
        <div className="mt-1">
          <RestartNotice />
        </div>
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

/* ── Text input control ── */
function TextControl({
  value,
  onChange,
  placeholder,
}: {
  readonly value: string;
  readonly onChange: (v: string) => void;
  readonly placeholder?: string;
}) {
  return (
    <input
      type="text"
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className="w-44 bg-bg-2 border border-border rounded-md px-2 py-1 text-xs text-foreground focus:outline-none focus:border-accent"
    />
  );
}

/* ── Number input control ── */
function NumberControl({
  value,
  min,
  max,
  onChange,
}: {
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly onChange: (v: number) => void;
}) {
  return (
    <input
      type="number"
      min={min}
      max={max}
      value={value}
      onChange={(e) => {
        const n = Number.parseInt(e.target.value, 10);
        if (!Number.isNaN(n)) onChange(n);
      }}
      className="w-24 bg-bg-2 border border-border rounded-md px-2 py-1 text-xs text-foreground text-right focus:outline-none focus:border-accent"
    />
  );
}

/* ── Enum select control ── */
function SelectControl<T extends string>({
  value,
  options,
  labels,
  onChange,
}: {
  readonly value: T;
  readonly options: readonly T[];
  readonly labels?: Partial<Record<T, string>>;
  readonly onChange: (v: T) => void;
}) {
  const id = useId();
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className="w-36 bg-bg-2 border border-border rounded-md px-2 py-1 text-xs text-foreground focus:outline-none focus:border-accent"
    >
      {options.map((opt) => (
        <option key={opt} value={opt}>
          {labels?.[opt] ?? opt}
        </option>
      ))}
    </select>
  );
}

/* ── Server section ── */
function ServerSection({
  config,
  onSaved,
}: {
  readonly config: ServerConfig;
  readonly onSaved: (next: ServerConfig) => void;
}) {
  const { success, error: toastError } = useToast();
  const [draft, setDraft] = useState<ServerConfig>(config);
  const [saving, setSaving] = useState(false);

  const isDirty = JSON.stringify(draft) !== JSON.stringify(config);

  function update<K extends keyof ServerConfig>(key: K, value: ServerConfig[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    setSaving(true);
    try {
      await apiFetch("/api/config/runtime/server", {
        method: "PUT",
        body: JSON.stringify(draft),
      });
      onSaved(draft);
      success("服务配置已保存，重启后生效。");
    } catch {
      toastError("服务配置保存失败。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-bg-1 border border-border rounded-xl p-5">
      <div className="flex items-center gap-3.5 mb-4">
        <div className="shrink-0 w-9 h-9 rounded-lg flex items-center justify-center bg-accent-subtle text-accent">
          <Server className="w-[18px] h-[18px]" />
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-strong m-0">服务</h3>
          <p className="text-xs text-muted m-0">
            配置控制台接口地址、端口、日志级别和浏览器工具开关。
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <FieldRow
          label="监听地址"
          description="控制台和 API 服务绑定的地址。"
          control={
            <TextControl
              value={draft.webHost}
              onChange={(v) => update("webHost", v)}
              placeholder="127.0.0.1"
            />
          }
        />
        <FieldRow
          label="监听端口"
          description="控制台和 API 服务使用的 TCP 端口。"
          control={
            <NumberControl
              value={draft.webPort}
              min={1}
              max={65535}
              onChange={(v) => update("webPort", v)}
            />
          }
        />
        <FieldRow
          label="日志级别"
          description="结构化日志输出的最低级别。"
          control={
            <SelectControl
              value={draft.logLevel}
              options={LOG_LEVELS}
              labels={LOG_LEVEL_LABELS}
              onChange={(v) => update("logLevel", v)}
            />
          }
        />
        <FieldRow
          label="浏览器工具"
          description="控制智能体是否可以使用浏览器类工具。"
          control={
            <Toggle
              checked={draft.browserEnabled}
              onChange={(v) => update("browserEnabled", v)}
            />
          }
        />
      </div>

      {isDirty && (
        <div className="flex justify-end gap-2 pt-4">
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
  );
}

/* ── Sandbox section ── */
function SandboxSection({
  config,
  onSaved,
}: {
  readonly config: SandboxConfig;
  readonly onSaved: (next: SandboxConfig) => void;
}) {
  const { success, error: toastError } = useToast();
  const [draft, setDraft] = useState<SandboxConfig>(config);
  const [saving, setSaving] = useState(false);

  const isDirty = JSON.stringify(draft) !== JSON.stringify(config);

  function update<K extends keyof SandboxConfig>(
    key: K,
    value: SandboxConfig[K],
  ) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    setSaving(true);
    try {
      await apiFetch("/api/config/runtime/sandbox", {
        method: "PUT",
        body: JSON.stringify(draft),
      });
      onSaved(draft);
      success("沙箱配置已保存，重启后生效。");
    } catch {
      toastError("沙箱配置保存失败。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-bg-1 border border-border rounded-xl p-5">
      <div className="flex items-center gap-3.5 mb-4">
        <div className="shrink-0 w-9 h-9 rounded-lg flex items-center justify-center bg-danger-subtle text-danger">
          <ShieldAlert className="w-[18px] h-[18px]" />
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-strong m-0">工具沙箱</h3>
          <p className="text-xs text-muted m-0">
            为智能体执行命令和开发工具提供系统级隔离。
          </p>
        </div>
      </div>

      <div className="rounded-lg bg-danger-subtle border border-danger p-3 mb-4 flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 text-danger shrink-0 mt-0.5" />
        <p className="text-xs text-danger m-0 leading-relaxed">
          下方两个危险开关会放宽沙箱边界，只建议在完全可信的运行环境中启用。
        </p>
      </div>

      <div className="flex flex-col gap-4">
        <FieldRow
          label="沙箱模式"
          description="关闭表示不包裹；优先启用表示可用时启用；必须启用表示不可用时拒绝执行。"
          control={
            <SelectControl
              value={draft.toolsSandbox}
              options={SANDBOX_MODES}
              labels={SANDBOX_MODE_LABELS}
              onChange={(v) => update("toolsSandbox", v)}
            />
          }
        />
        <FieldRow
          danger
          label="允许开发工具联网（危险）"
          description="允许测试和代码验证工具访问网络，可能扩大不可信代码的影响面。"
          control={
            <Toggle
              checked={draft.devToolsAllowNetwork}
              onChange={(v) => update("devToolsAllowNetwork", v)}
            />
          }
        />
        <FieldRow
          danger
          label="允许无沙箱开发工具（危险）"
          description="沙箱不可用时仍执行开发工具，可能直接在宿主机运行工作区代码。"
          control={
            <Toggle
              checked={draft.allowUnsandboxedDevTools}
              onChange={(v) => update("allowUnsandboxedDevTools", v)}
            />
          }
        />
      </div>

      {isDirty && (
        <div className="flex justify-end gap-2 pt-4">
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
  );
}

/* ── Main ── */
export default function RuntimeSettings() {
  const { error: toastError } = useToast();
  const [server, setServer] = useState<ServerConfig | null>(null);
  const [sandbox, setSandbox] = useState<SandboxConfig | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [serverRes, sandboxRes] = await Promise.all([
          apiFetch<{ data: ServerConfig }>("/api/config/runtime/server"),
          apiFetch<{ data: SandboxConfig }>("/api/config/runtime/sandbox"),
        ]);
        if (cancelled) return;
        setServer(serverRes.data);
        setSandbox(sandboxRes.data);
      } catch {
        if (!cancelled) toastError("运行时设置加载失败。");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <LoadingState message="正在加载运行时设置..." />;
  if (!server || !sandbox) return null;

  return (
    <div className="flex flex-col gap-3">
      <ServerSection config={server} onSaved={setServer} />
      <SandboxSection config={sandbox} onSaved={setSandbox} />
    </div>
  );
}
