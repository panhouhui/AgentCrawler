import { useState, useCallback } from "react";
import { Play, Circle } from "lucide-react";
import { Button } from "../../components";
import { apiFetch } from "../../api";
import { cn } from "../../lib/cn";
import type { ExecutionStatus, ExecutionStepMap } from "./types";

interface RunResponse {
  readonly executionId: string;
}

interface RunControlsProps {
  readonly workflowId: string | null;
  readonly isDirty: boolean;
  readonly executionStatus: ExecutionStatus | null;
  readonly stepStatuses: ExecutionStepMap;
  readonly onExecutionStart: (executionId: string) => void;
  readonly onTogglePanel: () => void;
  readonly panelOpen: boolean;
}

const statusConfig: Record<ExecutionStatus, { label: string; color: string; bg: string }> = {
  pending: { label: "等待中", color: "text-zinc-400", bg: "bg-zinc-500/10" },
  running: { label: "运行中", color: "text-blue-400", bg: "bg-blue-500/15" },
  completed: { label: "已完成", color: "text-emerald-400", bg: "bg-emerald-500/15" },
  failed: { label: "失败", color: "text-red-400", bg: "bg-red-500/15" },
  cancelled: { label: "已取消", color: "text-zinc-400", bg: "bg-zinc-500/10" },
};

export function RunControls({
  workflowId,
  isDirty,
  executionStatus,
  stepStatuses,
  onExecutionStart,
  onTogglePanel,
  panelOpen,
}: RunControlsProps) {
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  const handleRun = useCallback(async () => {
    if (!workflowId || isDirty) return;

    setRunning(true);
    setRunError(null);

    try {
      const res = await apiFetch<{ success: boolean; data: RunResponse }>(
        `/api/workflows/${workflowId}/run`,
        { method: "POST" },
      );
      onExecutionStart(res.data.executionId);
    } catch (err) {
      const message =
        err && typeof err === "object" && "message" in err
          ? String((err as { message: unknown }).message)
          : "启动工作流失败";
      setRunError(message);
    } finally {
      setRunning(false);
    }
  }, [workflowId, isDirty, onExecutionStart]);

  const isDisabled = !workflowId || isDirty;
  const disabledTitle = !workflowId
    ? "请先保存工作流"
    : isDirty
      ? "运行前请先保存修改"
      : undefined;

  const steps = [...stepStatuses.values()];
  const hasSteps = steps.length > 0;
  const config = executionStatus ? statusConfig[executionStatus] : null;

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="primary"
        size="sm"
        disabled={isDisabled}
        loading={running}
        onClick={handleRun}
        title={disabledTitle}
        className={cn(
          !isDisabled && "bg-green-600 hover:bg-green-500",
        )}
      >
        <Play size={13} />
        运行
      </Button>

      {executionStatus && config && (
        <button
          type="button"
          onClick={onTogglePanel}
          className={cn(
            "inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px] font-semibold transition-all cursor-pointer border",
            config.bg,
            config.color,
            panelOpen
              ? "border-current/20"
              : "border-transparent hover:border-current/20",
          )}
          title={panelOpen ? "隐藏执行面板" : "显示执行面板"}
        >
          {executionStatus === "running" && (
            <Circle size={6} className="fill-current animate-pulse" />
          )}
          {config.label}
          {hasSteps && (
            <span className="text-[10px] opacity-70">
              {steps.filter((s) => s.status === "completed").length}/{steps.length}
            </span>
          )}
        </button>
      )}

      {runError && (
        <span className="text-xs text-danger">{runError}</span>
      )}
    </div>
  );
}
