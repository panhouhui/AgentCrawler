import { useState, useEffect, useRef } from "react";
import { z } from "zod";
import { Controller } from "react-hook-form";
import { apiFetch } from "../api";
import {
  PageHeader,
  LoadingState,
  EmptyState,
  Button,
  Input,
  Toggle,
  FormField,
  ConfirmDelete,
} from "../components";
import { formatDuration } from "../lib/format";
import { useZodForm } from "../hooks/useZodForm";
import { usePolledFetch } from "../hooks/usePolledFetch";

interface CronJob {
  id: string;
  name: string;
  enabled: boolean;
  deleteAfterRun: boolean;
  priority: number;
  schedule: {
    kind: string;
    at?: string;
    everyMs?: number;
    expr?: string;
    tz?: string;
  };
  payload: {
    kind: string;
    message: string;
    agentId?: string;
    timeoutSeconds?: number;
  };
  delivery: { mode: string; channel?: string; chatId?: string };
  nextRunAt: number | null;
  lastRunAt: number | null;
  lastStatus: string | null;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
}

interface CronProgressEntry {
  type: string;
  text: string;
  ts: number;
}

interface CronRun {
  id: string;
  jobId: string;
  status: string;
  resultSummary: string | null;
  error: string | null;
  durationMs: number | null;
  startedAt: number;
  endedAt: number | null;
  progress: CronProgressEntry[] | null;
}

interface CronStatus {
  running: boolean;
  jobCount: number;
  nextDueAt: number | null;
}

interface AgentOption {
  id: string;
  name: string;
}

/* ─── Form Schema ─── */

const cronJobSchema = z.object({
  name: z.string().min(1, "名称必填"),
  scheduleKind: z.string(),
  at: z.string(),
  everyMs: z.string(),
  cronExpr: z.string(),
  tz: z.string(),
  message: z.string().min(1, "任务内容必填"),
  agentId: z.string(),
  deleteAfterRun: z.boolean(),
  priority: z.string(),
});

type CronJobFormValues = z.input<typeof cronJobSchema>;

/* ─── Helpers ─── */

function formatSchedule(s: CronJob["schedule"]): string {
  if (s.kind === "at") return `一次性：${s.at ?? "未知时间"}`;
  if (s.kind === "every") {
    const sec = Math.floor((s.everyMs ?? 0) / 1000);
    if (sec < 60) return `每 ${sec} 秒`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `每 ${min} 分钟`;
    const hr = Math.floor(min / 60);
    const rem = min % 60;
    return rem > 0 ? `每 ${hr} 小时 ${rem} 分钟` : `每 ${hr} 小时`;
  }
  if (s.kind === "cron") return `${s.expr ?? ""}${s.tz ? ` (${s.tz})` : ""}`;
  return "未知";
}

function formatTs(ts: number | null): string {
  if (!ts) return "-";
  return new Date(ts * 1000).toLocaleString("zh-CN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatProgressTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

const PROGRESS_ICON: Record<string, string> = {
  thinking: "•",
  tool_start: "▶",
  tool_done: "✓",
  iteration: "→",
  subagent_start: "◆",
  subagent_done: "✔",
};

const PROGRESS_LABEL: Record<string, string> = {
  thinking: "思考",
  tool_start: "工具",
  tool_done: "结果",
  iteration: "步骤",
  subagent_start: "智能体",
  subagent_done: "完成",
};

const RUN_STATUS_LABEL: Record<string, string> = {
  ok: "成功",
  error: "错误",
  fail: "失败",
  running: "运行中",
  timeout: "超时",
};

function priorityLabel(priority: number): string {
  if (priority <= 3) return "高";
  if (priority <= 7) return "中";
  if (priority <= 12) return "普通";
  return "低";
}

const selectClass =
  "w-full px-4 py-2.5 bg-bg border border-border rounded-lg text-foreground text-sm outline-none transition-colors duration-150 focus:border-accent";

const POLL_INTERVAL_MS = 3000;

/* ─── Status Dot ─── */

function StatusDot({
  status,
  pulse,
}: {
  status: "ok" | "error" | "running" | "disabled" | "idle";
  pulse?: boolean;
}) {
  const colors: Record<string, string> = {
    ok: "bg-success",
    error: "bg-danger",
    running: "bg-accent",
    disabled: "bg-faint",
    idle: "bg-muted",
  };
  return (
    <span className="relative flex items-center justify-center w-2.5 h-2.5">
      {pulse && (
        <span
          className={`absolute inset-0 rounded-full ${colors[status] ?? colors.idle} opacity-40 animate-ping`}
        />
      )}
      <span
        className={`relative block w-2 h-2 rounded-full ${colors[status] ?? colors.idle}`}
      />
    </span>
  );
}

/* ─── Progress Panel (collapsible, fixed height) ─── */

function ProgressPanel({
  progress,
  expanded,
  onToggle,
}: {
  progress: CronProgressEntry[] | null;
  expanded: boolean;
  onToggle: () => void;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  const entries = progress ?? [];
  const latestEntry = entries[entries.length - 1];

  useEffect(() => {
    if (expanded) {
      endRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [entries.length, expanded]);

  return (
    <div className="cr-progress">
      <button
        type="button"
        onClick={onToggle}
        className="cr-progress-toggle"
        aria-expanded={expanded}
        aria-label={expanded ? "收起实时进度" : "展开实时进度"}
      >
        <span className="cr-progress-toggle-left">
          <span
            aria-hidden="true"
            className="w-3 h-3 border-2 border-faint border-t-accent rounded-full animate-spin inline-block"
          />
          <span className="cr-progress-label">实时</span>
          <span className="cr-progress-count">{entries.length}</span>
        </span>
        {!expanded && latestEntry && (
          <span className="cr-progress-preview">
            {PROGRESS_LABEL[latestEntry.type] ?? latestEntry.type}:{" "}
            {latestEntry.text.slice(0, 60)}
            {latestEntry.text.length > 60 ? "..." : ""}
          </span>
        )}
        <span aria-hidden="true" className="cr-progress-chevron" data-expanded={expanded}>
          {"▾"}
        </span>
      </button>
      {expanded && (
        <div className="cr-progress-body">
          {entries.length === 0 ? (
            <div className="cr-progress-empty">等待输出...</div>
          ) : (
            entries.map((entry, i) => (
              <div key={i} className="cr-progress-entry">
                <span className="cr-progress-time">
                  {formatProgressTime(entry.ts)}
                </span>
                <span className="cr-progress-icon">
                  {PROGRESS_ICON[entry.type] ?? "•"}
                </span>
                <span className="cr-progress-type">
                  {PROGRESS_LABEL[entry.type] ?? entry.type}
                </span>
                <span className="cr-progress-text">{entry.text}</span>
              </div>
            ))
          )}
          <div ref={endRef} />
        </div>
      )}
    </div>
  );
}

/* ─── Run Row ─── */

function RunRow({ run }: { run: CronRun }) {
  const isRunning = run.status === "running";
  const statusColor: Record<string, string> = {
    ok: "text-success",
    error: "text-danger",
    fail: "text-danger",
    running: "text-accent",
    timeout: "text-warning",
  };

  return (
    <div className="cr-run-row">
      <span className="cr-run-time">{formatTs(run.startedAt)}</span>
      <span className={statusColor[run.status] ?? "text-muted"}>
        <span className="cr-run-status">
          <StatusDot
            status={
              run.status === "ok"
                ? "ok"
                : run.status === "running"
                  ? "running"
                  : "error"
            }
            pulse={isRunning}
          />
          {RUN_STATUS_LABEL[run.status] ?? run.status}
        </span>
      </span>
      <span className="cr-run-duration">
        {isRunning ? "-" : formatDuration(run.durationMs ?? 0)}
      </span>
      <span className={`cr-run-result ${run.error ? "cr-run-error" : ""}`}>
        {isRunning
          ? "执行中..."
          : (run.error ?? run.resultSummary?.slice(0, 120) ?? "-")}
      </span>
    </div>
  );
}

/* ─── Job Card ─── */

function JobCard({
  job,
  activeRun,
  isExpanded,
  runs,
  runsLoading,
  onToggleExpand,
  onToggleEnabled,
  onRunNow,
  onDelete,
}: {
  job: CronJob;
  activeRun?: CronRun;
  isExpanded: boolean;
  runs: CronRun[];
  runsLoading: boolean;
  onToggleExpand: () => void;
  onToggleEnabled: () => void;
  onRunNow: () => void;
  onDelete: () => void;
}) {
  const [progressExpanded, setProgressExpanded] = useState(false);
  const isRunning = !!activeRun;

  const resolvedStatus = isRunning
    ? "running"
    : !job.enabled
      ? "disabled"
      : job.lastStatus === "ok"
        ? "ok"
        : job.lastStatus === "error" || job.lastStatus === "fail"
          ? "error"
          : "idle";

  return (
    <div
      className={`cr-card ${job.enabled ? "cr-enabled" : "cr-disabled"}`}
    >
      {/* Header */}
      <div className="cr-card-header">
        <div className="cr-card-name-row">
          <StatusDot status={resolvedStatus} pulse={isRunning} />
          <button
            type="button"
            className="cr-card-name"
            onClick={onToggleExpand}
          >
            {job.name}
          </button>
          {job.deleteAfterRun && (
            <span className="cr-badge-oneshot">一次</span>
          )}
        </div>
        <div className="cr-card-badges">
          <Toggle checked={job.enabled} onChange={onToggleEnabled} />
        </div>
      </div>

      {/* Details grid */}
      <div className="cr-card-details">
        <div className="cr-detail">
          <span className="cr-detail-label">调度</span>
          <span className="cr-detail-value">
            {formatSchedule(job.schedule)}
          </span>
        </div>
        <div className="cr-detail">
          <span className="cr-detail-label">下次运行</span>
          <span className="cr-detail-value">{formatTs(job.nextRunAt)}</span>
        </div>
        <div className="cr-detail">
          <span className="cr-detail-label">优先级</span>
          <span className="cr-detail-value">
            {priorityLabel(job.priority)}{" "}
            <span className="text-faint">({job.priority})</span>
          </span>
        </div>
        {job.payload.agentId && (
          <div className="cr-detail">
            <span className="cr-detail-label">智能体</span>
            <span className="cr-detail-value">{job.payload.agentId}</span>
          </div>
        )}
        <div className="cr-detail cr-message-preview">
          <span className="cr-detail-label">任务内容</span>
          <span className="cr-message-text">{job.payload.message}</span>
        </div>
      </div>

      {/* Live Progress — only when running */}
      {activeRun && (
        <div className="px-5 pt-3">
          <ProgressPanel
            progress={activeRun.progress}
            expanded={progressExpanded}
            onToggle={() => setProgressExpanded((v) => !v)}
          />
        </div>
      )}

      {/* Expanded: Recent Runs */}
      {isExpanded && (
        <div className="cr-runs-panel">
          <div className="cr-runs-title">最近运行</div>
          {runsLoading ? (
            <span className="w-4 h-4 border-2 border-border-2 border-t-accent rounded-full animate-spin inline-block" />
          ) : runs.length === 0 ? (
            <div className="cr-runs-empty">暂无运行记录</div>
          ) : (
            <div className="cr-runs-list">
              {runs.map((run) => (
                <RunRow key={run.id} run={run} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="cr-card-actions">
        <Button variant="secondary" size="sm" onClick={onToggleExpand}>
          {isExpanded ? "收起运行记录" : "运行记录"}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={onRunNow}
          disabled={isRunning}
        >
          {isRunning ? (
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 border-2 border-faint border-t-accent rounded-full animate-spin inline-block" />
              运行中
            </span>
          ) : (
            "立即运行"
          )}
        </Button>
        <ConfirmDelete
          confirmLabel="删除这个定时任务？"
          onConfirm={onDelete}
        />
      </div>
    </div>
  );
}

/* ─── Main Component ─── */

export default function Cron() {
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [status, setStatus] = useState<CronStatus | null>(null);
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null);
  const [runs, setRuns] = useState<CronRun[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);
  const [activeRuns, setActiveRuns] = useState<Record<string, CronRun>>({});
  // Use a ref for expandedJobId inside the active-runs completion detection
  // so the effect doesn't need expandedJobId as a dependency (which would
  // restart polling on every expansion/collapse).
  const expandedJobIdRef = useRef<string | null>(null);
  expandedJobIdRef.current = expandedJobId;
  const prevActiveJobIds = useRef<Set<string>>(new Set());

  const {
    register,
    handleSubmit,
    reset,
    control,
    watch,
    formState: { errors, isSubmitting: formSaving },
  } = useZodForm(cronJobSchema, {
    defaultValues: {
      name: "",
      scheduleKind: "every",
      at: "",
      everyMs: "3600000",
      cronExpr: "0 * * * *",
      tz: "",
      message: "",
      agentId: "",
      deleteAfterRun: false,
      priority: "10",
    },
  });
  const [formError, setFormError] = useState("");
  const scheduleKind = watch("scheduleKind");
  const everyMsValue = watch("everyMs");

  /* ─── Polled data ─── */

  const { data: jobsData, refetch: refetchJobs } = usePolledFetch<{
    success: boolean;
    data: CronJob[];
  }>("/api/cron/jobs", { intervalMs: POLL_INTERVAL_MS });

  const { data: statusData } = usePolledFetch<{
    success: boolean;
    data: CronStatus;
  }>("/api/cron/status", { intervalMs: POLL_INTERVAL_MS });

  const { data: activeRunsData, refetch: refetchActiveRuns } = usePolledFetch<{
    success: boolean;
    data: CronRun[];
  }>("/api/cron/active-runs", { intervalMs: POLL_INTERVAL_MS });

  /* ─── Sync polled data into local state ─── */

  useEffect(() => {
    if (jobsData?.success) {
      setJobs(jobsData.data);
      setLoading(false);
    }
  }, [jobsData]);

  useEffect(() => {
    if (statusData?.success) {
      setStatus(statusData.data);
      setLoading(false);
    }
  }, [statusData]);

  useEffect(() => {
    if (!activeRunsData?.success) return;

    const byJob: Record<string, CronRun> = {};
    for (const run of activeRunsData.data) {
      byJob[run.jobId] = run;
    }

    const currentActiveJobIds = new Set(Object.keys(byJob));
    const prevIds = prevActiveJobIds.current;

    // When a job finishes (drops from active), refresh runs for the expanded card.
    for (const jobId of prevIds) {
      if (!currentActiveJobIds.has(jobId) && expandedJobIdRef.current === jobId) {
        apiFetch<{ success: boolean; data: CronRun[] }>(
          `/api/cron/jobs/${jobId}/runs`,
        )
          .then((res) => {
            if (res.success) setRuns(res.data);
          })
          .catch(() => {
            // ignore — the card's run list will remain stale until next manual expand
          });
      }
    }
    prevActiveJobIds.current = currentActiveJobIds;
    setActiveRuns(byJob);
  }, [activeRunsData]);

  /* ─── Load agents (one-shot) ─── */

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ success: boolean; data: AgentOption[] }>("/api/agents")
      .then((res) => {
        if (!cancelled && res.success) setAgents(res.data);
      })
      .catch(() => {
        // agents list is optional — cron still works without it
      });
    return () => { cancelled = true; };
  }, []);

  /* ─── Mutations ─── */

  async function toggleJob(id: string) {
    await apiFetch(`/api/cron/jobs/${id}/toggle`, { method: "POST" }).catch(
      () => null,
    );
    refetchJobs();
  }

  async function runNow(id: string) {
    await apiFetch(`/api/cron/jobs/${id}/run`, { method: "POST" }).catch(
      () => null,
    );
    refetchActiveRuns();
  }

  async function deleteJob(id: string) {
    await apiFetch(`/api/cron/jobs/${id}`, { method: "DELETE" }).catch(
      () => null,
    );
    refetchJobs();
  }

  async function loadRuns(jobId: string) {
    if (expandedJobId === jobId) {
      setExpandedJobId(null);
      return;
    }
    setExpandedJobId(jobId);
    setRunsLoading(true);
    try {
      const res = await apiFetch<{ success: boolean; data: CronRun[] }>(
        `/api/cron/jobs/${jobId}/runs`,
      );
      if (res.success) setRuns(res.data);
    } catch {
      setRuns([]);
    } finally {
      setRunsLoading(false);
    }
  }

  async function onCreateJob(values: CronJobFormValues) {
    setFormError("");

    const schedule =
      values.scheduleKind === "at"
        ? { kind: "at" as const, at: values.at }
        : values.scheduleKind === "every"
          ? { kind: "every" as const, everyMs: Number(values.everyMs) }
          : {
              kind: "cron" as const,
              expr: values.cronExpr,
              tz: values.tz || undefined,
            };

    const body = {
      name: values.name,
      schedule,
      payload: {
        kind: "agentTurn" as const,
        message: values.message,
        agentId: values.agentId || undefined,
      },
      deleteAfterRun: values.deleteAfterRun,
      priority: Number(values.priority),
    };

    try {
      const res = await apiFetch<{ success: boolean; error?: string }>(
        "/api/cron/jobs",
        {
          method: "POST",
          body: JSON.stringify(body),
        },
      );
      if (res.success) {
        setShowForm(false);
        reset();
        setFormError("");
        refetchJobs();
      } else {
        setFormError(
          typeof res.error === "string" ? res.error : JSON.stringify(res.error),
        );
      }
    } catch {
      setFormError("创建任务失败");
    }
  }

  if (loading && jobs.length === 0 && status === null) {
    return <LoadingState message="正在加载定时任务..." />;
  }

  if (!loading && status === null) {
    return (
      <EmptyState
        title="定时任务不可用"
        description="暂时无法连接定时调度器，调度进程可能仍在启动。"
      />
    );
  }

  const activeCount = Object.keys(activeRuns).length;

  return (
    <div className="cr-page p-6">
      <PageHeader
        title="定时任务"
        subtitle={
          <>
            {status?.running ? "运行中" : "已停止"} | {status?.jobCount ?? 0} 个任务
            {activeCount > 0 ? ` | ${activeCount} 个活跃运行` : ""}
            {status?.nextDueAt ? ` | 下次：${formatTs(status.nextDueAt)}` : ""}
          </>
        }
        actions={
          <Button
            variant={showForm ? "secondary" : "primary"}
            size="sm"
            onClick={() => setShowForm(!showForm)}
          >
            {showForm ? "取消" : "新建任务"}
          </Button>
        }
      />

      {showForm && (
        <div className="cr-form-card">
          <div className="cr-form-title">创建任务</div>
          {formError && <div className="cr-error">{formError}</div>}
          <form onSubmit={handleSubmit(onCreateJob)}>
            <div className="cr-form-grid">
              <div>
                <FormField error={errors.name}>
                  <Input
                    label="名称"
                    type="text"
                    {...register("name")}
                  />
                </FormField>
              </div>
              <div>
                <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-2">
                  调度类型
                </label>
                <Controller
                  control={control}
                  name="scheduleKind"
                  render={({ field }) => (
                    <select className={selectClass} {...field}>
                      <option value="every">固定间隔</option>
                      <option value="cron">Cron 表达式</option>
                      <option value="at">一次性</option>
                    </select>
                  )}
                />
              </div>

              {scheduleKind === "at" && (
                <div>
                  <Input
                    label="日期/时间"
                    type="datetime-local"
                    {...register("at")}
                  />
                </div>
              )}
              {scheduleKind === "every" && (
                <div className="cr-form-row">
                  <div className="flex-1">
                    <Input
                      label="间隔（毫秒）"
                      type="number"
                      min={1000}
                      {...register("everyMs")}
                    />
                  </div>
                  <span className="cr-form-hint mt-5">
                    {Number(everyMsValue) >= 3600000
                      ? `${Math.floor(Number(everyMsValue) / 3600000)}h`
                      : Number(everyMsValue) >= 60000
                        ? `${Math.floor(Number(everyMsValue) / 60000)}m`
                        : `${Math.floor(Number(everyMsValue) / 1000)}s`}
                  </span>
                </div>
              )}
              {scheduleKind === "cron" && (
                <>
                  <div>
                    <Input
                      label="Cron 表达式"
                      type="text"
                      placeholder="0 * * * *"
                      {...register("cronExpr")}
                    />
                  </div>
                  <div>
                    <Input
                      label="时区"
                      type="text"
                      placeholder="Asia/Shanghai"
                      {...register("tz")}
                    />
                  </div>
                </>
              )}

              <div className="cr-form-full">
                <FormField error={errors.message}>
                  <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-2">
                    任务内容
                  </label>
                  <textarea
                    className="w-full px-4 py-2.5 bg-bg border border-border rounded-lg text-foreground text-sm outline-none transition-colors duration-150 focus:border-accent placeholder:text-faint resize-none"
                    rows={2}
                    placeholder="输入要交给智能体执行的任务..."
                    {...register("message")}
                  />
                </FormField>
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-2">
                  智能体
                </label>
                <Controller
                  control={control}
                  name="agentId"
                  render={({ field }) => (
                    <select className={selectClass} {...field}>
                      <option value="">默认智能体</option>
                      {agents.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name} ({a.id})
                        </option>
                      ))}
                    </select>
                  )}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-2">
                  优先级
                </label>
                <Controller
                  control={control}
                  name="priority"
                  render={({ field }) => (
                    <select className={selectClass} {...field}>
                      <option value="1">高 (1)</option>
                      <option value="3">中高 (3)</option>
                      <option value="5">中 (5)</option>
                      <option value="10">普通 (10)</option>
                      <option value="15">低 (15)</option>
                    </select>
                  )}
                />
              </div>
              <div className="flex items-end pb-1">
                <Controller
                  control={control}
                  name="deleteAfterRun"
                  render={({ field }) => (
                    <Toggle
                      label="首次运行后删除"
                      checked={field.value}
                      onChange={field.onChange}
                    />
                  )}
                />
              </div>
            </div>

            <div className="cr-form-actions">
              <Button type="submit" size="sm" loading={formSaving} disabled={formSaving}>
                创建
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setShowForm(false);
                  reset();
                  setFormError("");
                }}
              >
                取消
              </Button>
            </div>
          </form>
        </div>
      )}

      {jobs.length === 0 ? (
        <div className="cr-empty">
          <div className="cr-empty-icon">+</div>
          <div className="cr-empty-title">暂无定时任务</div>
          <div className="cr-empty-desc">
            可以在上方新建一个任务，或让智能体帮你安排任务。
          </div>
        </div>
      ) : (
        <div className="cr-grid">
          {jobs.map((job) => (
            <JobCard
              key={job.id}
              job={job}
              activeRun={activeRuns[job.id]}
              isExpanded={expandedJobId === job.id}
              runs={expandedJobId === job.id ? runs : []}
              runsLoading={runsLoading && expandedJobId === job.id}
              onToggleExpand={() => loadRuns(job.id)}
              onToggleEnabled={() => toggleJob(job.id)}
              onRunNow={() => runNow(job.id)}
              onDelete={() => deleteJob(job.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
