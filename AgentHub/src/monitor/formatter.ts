import type { AlertLevel, CheckCategory, CheckResult } from "./types";

const LEVEL_LABELS: Record<AlertLevel, string> = {
  critical: "CRITICAL",
  warning: "WARNING",
  info: "INFO",
};

export function formatAlertMessage(result: CheckResult): string {
  const label = LEVEL_LABELS[result.level];
  const lines = [`[${label}] ${result.title}`, "", result.detail];

  if (result.metric !== undefined && result.threshold !== undefined) {
    lines.push(`Metric: ${result.metric} (threshold: ${result.threshold})`);
  }

  return lines.join("\n");
}

export function formatResolvedMessage(
  _category: CheckCategory,
  title: string,
): string {
  return `[RESOLVED] ${title}\n\nCondition has returned to normal.`;
}

export function formatBatchAlert(
  results: readonly CheckResult[],
): string {
  if (results.length === 0) return "";

  if (results.length === 1) {
    return formatAlertMessage(results[0]!);
  }

  const header = `[MONITOR] ${results.length} issues detected`;
  const summary = results
    .map((r) => `• [${LEVEL_LABELS[r.level]}] ${r.title}`)
    .join("\n");

  const details = results
    .map((r) => `--- ${r.title} ---\n${r.detail}`)
    .join("\n\n");

  return `${header}\n\n${summary}\n\n${details}`;
}
