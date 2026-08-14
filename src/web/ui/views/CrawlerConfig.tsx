import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Edit3,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  XCircle,
} from "lucide-react";
import { apiFetch } from "../api";
import { Button, EmptyState, LoadingState, Modal, PageHeader } from "../components";
import { cn } from "../lib/cn";
import type {
  CrawlerConfigField,
  CrawlerConfigGroup,
  CrawlerConfigOverview,
  CrawlerPlatformConfig,
  CrawlerConfigStatus,
} from "../../../integrations/crawlers/config";

interface ApiResponse<T> {
  readonly success: boolean;
  readonly data: T;
  readonly error?: string;
}

interface TelegramDialogInfo {
  readonly id: string;
  readonly title: string;
  readonly username: string;
  readonly type: string;
}

interface TelegramDialogResponse {
  readonly dialogs: readonly TelegramDialogInfo[];
  readonly selectedIds: readonly string[];
}

interface CrawlerConfigProps {
  readonly platformId: string;
}

const statusClasses: Record<CrawlerConfigStatus, string> = {
  ready: "bg-success-subtle text-success",
  partial: "bg-warning-subtle text-warning",
  "missing-env": "bg-danger-subtle text-danger",
};

function groupStatusText(group: CrawlerConfigGroup): string {
  if (group.status === "ok") return "已配置";
  if (group.status === "partial") return "部分配置";
  return "缺少配置";
}

function groupStatusClass(group: CrawlerConfigGroup): string {
  if (group.status === "ok") return "bg-success-subtle text-success";
  if (group.status === "partial") return "bg-warning-subtle text-warning";
  return "bg-danger-subtle text-danger";
}

function StatusIcon({ status }: { readonly status: CrawlerConfigStatus }) {
  if (status === "ready") return <CheckCircle2 size={17} />;
  if (status === "partial") return <AlertTriangle size={17} />;
  return <XCircle size={17} />;
}

function parseCsv(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function joinCsv(values: readonly string[]): string {
  return values.join(",");
}

function TelegramDialogPicker({
  value,
  onChange,
}: {
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  const [dialogs, setDialogs] = useState<readonly TelegramDialogInfo[]>([]);
  const [selectedIds, setSelectedIds] = useState<readonly string[]>([]);
  const [loadingDialogs, setLoadingDialogs] = useState(false);
  const [dialogError, setDialogError] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    let alive = true;
    async function loadDialogs() {
      setLoadingDialogs(true);
      setDialogError("");
      try {
        const res = await apiFetch<ApiResponse<TelegramDialogResponse>>(
          "/api/crawler-config/telegram/dialogs",
        );
        if (!alive) return;
        setDialogs(res.data.dialogs);
        setSelectedIds(res.data.selectedIds);
        if (!value.trim() && res.data.selectedIds.length > 0) {
          onChange(joinCsv(res.data.selectedIds));
        }
      } catch (err) {
        if (!alive) return;
        setDialogError(err instanceof Error ? err.message : String(err));
      } finally {
        if (alive) setLoadingDialogs(false);
      }
    }
    void loadDialogs();
    return () => {
      alive = false;
    };
  }, []);

  const selectedSet = useMemo(() => new Set(parseCsv(value)), [value]);
  const filteredDialogs = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return dialogs;
    return dialogs.filter((dialog) => {
      const title = dialog.title.toLowerCase();
      const username = dialog.username.toLowerCase();
      const id = dialog.id.toLowerCase();
      return title.includes(q) || username.includes(q) || id.includes(q);
    });
  }, [dialogs, search]);

  function toggle(id: string) {
    const next = new Set(selectedSet);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(joinCsv(Array.from(next)));
  }

  function selectAllVisible() {
    onChange(
      joinCsv(
        Array.from(
          new Set([...selectedSet, ...filteredDialogs.map((item) => item.id)]),
        ),
      ),
    );
  }

  function clearAll() {
    onChange("");
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 max-md:flex-col max-md:items-stretch">
        <div className="relative flex-1 min-w-0">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none"
          />
          <input
            className="w-full pl-9 pr-3 py-2.5 bg-bg border border-border-2 rounded-lg text-sm text-foreground outline-none transition-colors duration-150 focus:border-accent placeholder:text-faint"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索群名、频道名或 ID"
          />
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={selectAllVisible}
          disabled={loadingDialogs || filteredDialogs.length === 0}
        >
          全选当前
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={clearAll}
          disabled={loadingDialogs || selectedSet.size === 0}
        >
          清空选择
        </Button>
      </div>

      <div className="rounded-lg border border-border bg-bg-2 max-h-[320px] overflow-auto">
        {loadingDialogs ? (
          <div className="px-4 py-5 text-sm text-muted">
            正在读取 Telegram 会话...
          </div>
        ) : dialogError ? (
          <div className="px-4 py-5 text-sm text-danger">{dialogError}</div>
        ) : filteredDialogs.length === 0 ? (
          <div className="px-4 py-5 text-sm text-muted">没有匹配的会话</div>
        ) : (
          filteredDialogs.map((dialog) => {
            const checked = selectedSet.has(dialog.id);
            return (
              <label
                key={dialog.id}
                className="flex items-start gap-3 px-4 py-3 border-t border-border first:border-t-0 cursor-pointer hover:bg-bg-3/60"
              >
                <input
                  type="checkbox"
                  className="mt-1 accent-[var(--color-accent)]"
                  checked={checked}
                  onChange={() => toggle(dialog.id)}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-strong">
                      {dialog.title || dialog.username || dialog.id}
                    </span>
                    <span className="px-2 py-0.5 rounded-md text-xs bg-bg-3 text-muted">
                      {dialog.type === "channel" ? "频道" : "群组"}
                    </span>
                    {checked && (
                      <span className="px-2 py-0.5 rounded-md text-xs bg-success-subtle text-success">
                        已选中
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-xs text-muted break-all">
                    ID: {dialog.id}
                    {dialog.username ? ` · @${dialog.username}` : ""}
                  </div>
                </div>
              </label>
            );
          })
        )}
      </div>

      <div className="text-xs text-muted">
        已选择 {selectedSet.size} 个会话，保存后会写入 TELEGRAM_PUSH_DIALOGS。
      </div>
      {selectedIds.length > 0 && (
        <div className="text-xs text-muted">当前配置：{selectedIds.length} 个</div>
      )}
    </div>
  );
}

function FieldRow({
  field,
  clearing,
  onEdit,
  onClear,
}: {
  readonly field: CrawlerConfigField;
  readonly clearing: boolean;
  readonly onEdit: (field: CrawlerConfigField) => void;
  readonly onClear: (field: CrawlerConfigField) => void;
}) {
  return (
    <div className="grid grid-cols-[minmax(160px,1fr)_auto] max-md:grid-cols-1 gap-3 px-4 py-3 border-t border-border first:border-t-0">
      <div className="min-w-0">
        <div className="text-sm font-medium text-strong">{field.label}</div>
        <div className="text-xs text-muted mt-1">
          {field.valueType === "csv" && field.itemCount !== null
            ? `已选择 ${field.itemCount} 个`
            : field.required
              ? "必要配置"
              : "可选配置"}
        </div>
      </div>
      <div className="flex items-center justify-start md:justify-end gap-2">
        <span
          className={cn(
            "px-2 py-1 rounded-md text-xs font-medium",
            field.configured ? "bg-success-subtle text-success" : "bg-danger-subtle text-danger",
          )}
        >
          {field.configured ? "已填写" : "未填写"}
        </span>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => onEdit(field)}
          aria-label={`${field.configured ? "编辑" : "添加"}${field.label}`}
        >
          {field.configured ? <Edit3 size={14} /> : <Plus size={14} />}
          {field.configured ? "编辑" : "添加"}
        </Button>
        <Button
          type="button"
          variant="danger"
          size="sm"
          loading={clearing}
          disabled={!field.configured}
          onClick={() => onClear(field)}
          aria-label={`清空${field.label}`}
        >
          <Trash2 size={14} />
          清空
        </Button>
      </div>
    </div>
  );
}

function ConfigGroupCard({
  group,
  clearingFieldId,
  onEdit,
  onClear,
}: {
  readonly group: CrawlerConfigGroup;
  readonly clearingFieldId: string;
  readonly onEdit: (field: CrawlerConfigField) => void;
  readonly onClear: (field: CrawlerConfigField) => void;
}) {
  return (
    <section className="rounded-lg border border-border bg-bg-1 overflow-hidden">
      <div className="flex items-start justify-between gap-4 p-4 border-b border-border">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="m-0 text-base font-semibold text-strong">
              {group.label}
            </h3>
            {!group.required && (
              <span className="px-2 py-1 rounded-md bg-bg-3 text-muted text-xs font-medium">
                可选模块
              </span>
            )}
          </div>
          <p className="m-0 mt-1 text-sm text-muted leading-relaxed">
            {group.description}
          </p>
        </div>
        <span
          className={cn(
            "px-2.5 py-1 rounded-md text-sm font-medium whitespace-nowrap",
            groupStatusClass(group),
          )}
        >
          {groupStatusText(group)} {group.configuredCount}/{group.totalCount}
        </span>
      </div>
      <div>
        {group.fields.map((field) => (
          <FieldRow
            key={field.id}
            field={field}
            clearing={clearingFieldId === field.id}
            onEdit={onEdit}
            onClear={onClear}
          />
        ))}
      </div>
    </section>
  );
}

export default function CrawlerConfig({ platformId }: CrawlerConfigProps) {
  const [overview, setOverview] = useState<CrawlerConfigOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [editingField, setEditingField] = useState<CrawlerConfigField | null>(null);
  const [clearingField, setClearingField] = useState<CrawlerConfigField | null>(null);
  const [draftValue, setDraftValue] = useState("");
  const [savingFieldId, setSavingFieldId] = useState("");
  const [clearingFieldId, setClearingFieldId] = useState("");

  const platform = useMemo(
    () => overview?.platforms.find((item) => item.id === platformId) ?? null,
    [overview, platformId],
  );

  function replacePlatform(nextPlatform: CrawlerPlatformConfig) {
    setOverview((current) => {
      if (!current) return current;
      return {
        ...current,
        platforms: current.platforms.map((item) =>
          item.id === nextPlatform.id ? nextPlatform : item,
        ),
      };
    });
  }

  async function load() {
    setLoading(true);
    setError("");
    setActionError("");
    try {
      const res = await apiFetch<ApiResponse<CrawlerConfigOverview>>("/api/crawler-config");
      setOverview(res.data);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message || "爬虫配置读取失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [platformId]);

  function beginEdit(field: CrawlerConfigField) {
    setActionError("");
    setActionMessage("");
    setEditingField(field);
    setDraftValue("");
  }

  const editingTelegramDialogs =
    platform?.id === "telegram" && editingField?.id === "dialogs";

  async function saveField() {
    if (!platform || !editingField) return;
    setSavingFieldId(editingField.id);
    setActionError("");
    setActionMessage("");
    try {
      const res = await apiFetch<ApiResponse<CrawlerPlatformConfig>>(
        `/api/crawler-config/${platform.id}/fields/${editingField.id}`,
        {
          method: "PUT",
          body: JSON.stringify({ value: draftValue }),
        },
      );
      replacePlatform(res.data);
      setActionMessage(`${editingField.label} 已保存`);
      setEditingField(null);
      setDraftValue("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setActionError(message || "爬虫配置保存失败");
    } finally {
      setSavingFieldId("");
    }
  }

  async function clearField(field: CrawlerConfigField) {
    if (!platform || !field.configured) return;
    setClearingFieldId(field.id);
    setActionError("");
    setActionMessage("");
    try {
      const res = await apiFetch<ApiResponse<CrawlerPlatformConfig>>(
        `/api/crawler-config/${platform.id}/fields/${field.id}`,
        { method: "DELETE" },
      );
      replacePlatform(res.data);
      setActionMessage(`${field.label} 已清空`);
      setClearingField(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setActionError(message || "爬虫配置清空失败");
    } finally {
      setClearingFieldId("");
    }
  }

  if (loading) return <LoadingState message="正在读取爬虫配置..." />;

  if (error) {
    return (
      <EmptyState
        title="爬虫配置读取失败"
        description={error}
      >
        <Button className="mt-5" onClick={() => void load()}>
          重新读取
        </Button>
      </EmptyState>
    );
  }

  if (!overview || !platform) {
    return (
      <EmptyState
        title="未找到爬虫平台"
        description="当前路由没有匹配到 Crawler_env 中的爬虫平台配置。"
      />
    );
  }

  return (
    <div>
      <PageHeader
        title={`${platform.label} 爬虫配置`}
        subtitle="只展示当前爬虫自己的账号、Cookie 和抓取范围配置状态。"
        actions={
          <Button variant="secondary" onClick={() => void load()}>
            <RefreshCw size={16} />
            刷新配置
          </Button>
        }
      />

      <section className="mb-6">
        <div className="flex items-start justify-between gap-4 mb-4 max-md:flex-col">
          <div className="min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h3 className="m-0 text-xl font-semibold text-strong">
                当前平台：{platform.label}
              </h3>
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-sm font-medium",
                  statusClasses[platform.status],
                )}
              >
                <StatusIcon status={platform.status} />
                {platform.statusLabel}
              </span>
            </div>
            <p className="m-0 mt-2 text-base text-muted leading-relaxed">
              {platform.notes}
            </p>
            <p className="m-0 mt-2 text-sm text-muted">
              配置文件状态：{platform.envExists ? "已读取" : "未找到"}
            </p>
          </div>
        </div>

        {platform.missingRequiredGroups.length > 0 && (
          <div className="rounded-lg border border-warning/30 bg-warning-subtle px-4 py-3 text-warning mb-5">
            还需要补齐：{platform.missingRequiredGroups.join("、")}
          </div>
        )}

        {actionMessage && (
          <div className="rounded-lg border border-success/30 bg-success-subtle px-4 py-3 text-success mb-5">
            {actionMessage}
          </div>
        )}

        {actionError && (
          <div className="rounded-lg border border-danger/30 bg-danger-subtle px-4 py-3 text-danger mb-5">
            {actionError}
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {platform.groups.map((group) => (
          <ConfigGroupCard
            key={group.id}
            group={group}
            clearingFieldId={clearingFieldId}
            onEdit={beginEdit}
            onClear={setClearingField}
          />
        ))}
      </div>

      <Modal
        open={Boolean(editingField)}
        title={editingField ? `编辑 ${editingField.label}` : undefined}
        onClose={() => {
          if (savingFieldId) return;
          setEditingField(null);
          setDraftValue("");
          setActionError("");
        }}
        width={editingTelegramDialogs ? "720px" : undefined}
      >
        {editingField && (
          <form
            className="space-y-5"
            onSubmit={(event) => {
              event.preventDefault();
              void saveField();
            }}
          >
            <div>
              <label
                className="block text-sm font-semibold text-muted mb-2"
                htmlFor="crawler-config-value"
              >
                配置内容
              </label>
              {editingTelegramDialogs ? (
                <TelegramDialogPicker
                  value={draftValue}
                  onChange={setDraftValue}
                />
              ) : editingField.inputType === "textarea" ? (
                <textarea
                  id="crawler-config-value"
                  className="w-full min-h-[160px] px-4 py-3 bg-bg border border-border-2 rounded-lg text-foreground text-sm outline-none transition-colors duration-150 focus:border-accent placeholder:text-faint font-mono"
                  value={draftValue}
                  onChange={(event) => setDraftValue(event.target.value)}
                  placeholder={
                    editingField.configured
                      ? "已配置，输入新值可覆盖"
                      : "请输入新的配置内容"
                  }
                />
              ) : (
                <input
                  id="crawler-config-value"
                  className="w-full px-4 py-2.5 bg-bg border border-border-2 rounded-lg text-foreground text-base outline-none transition-colors duration-150 focus:border-accent placeholder:text-faint"
                  type={editingField.inputType === "password" ? "password" : "text"}
                  value={draftValue}
                  onChange={(event) => setDraftValue(event.target.value)}
                  placeholder={
                    editingField.configured
                      ? "已配置，输入新值可覆盖"
                      : "请输入新的配置内容"
                  }
                />
              )}
              <p className="m-0 mt-2 text-xs text-muted leading-relaxed">
                旧值不会在页面回显。保存后只更新当前平台允许管理的这个字段。
              </p>
            </div>

            {actionError && (
              <div className="rounded-lg border border-danger/30 bg-danger-subtle px-4 py-3 text-danger text-sm">
                {actionError}
              </div>
            )}

            <div className="flex justify-end gap-3">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setEditingField(null);
                  setDraftValue("");
                  setActionError("");
                }}
                disabled={Boolean(savingFieldId)}
              >
                取消
              </Button>
              <Button
                type="submit"
                loading={savingFieldId === editingField.id}
              >
                保存配置
              </Button>
            </div>
          </form>
        )}
      </Modal>

      <Modal
        open={Boolean(clearingField)}
        title="清空爬虫配置"
        onClose={() => {
          if (clearingFieldId) return;
          setClearingField(null);
          setActionError("");
        }}
        width="520px"
      >
        {clearingField && (
          <div className="space-y-5">
            <p className="m-0 text-sm text-muted leading-relaxed">
              确认清空“{clearingField.label}”吗？旧值不会在页面回显，清空后该平台可能需要重新补齐配置才能正常爬取。
            </p>

            {actionError && (
              <div className="rounded-lg border border-danger/30 bg-danger-subtle px-4 py-3 text-danger text-sm">
                {actionError}
              </div>
            )}

            <div className="flex justify-end gap-3">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setClearingField(null);
                  setActionError("");
                }}
                disabled={Boolean(clearingFieldId)}
              >
                取消
              </Button>
              <Button
                type="button"
                variant="danger"
                loading={clearingFieldId === clearingField.id}
                onClick={() => void clearField(clearingField)}
              >
                确认清空
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
