/**
 * Shared formatting utilities for the AgentHub web UI.
 * Replaces ~20 locally-defined duplicates across view files.
 */

/** Format a unix epoch (seconds) to a locale string. Returns a Chinese empty-state label for falsy values. */
export function formatTime(epoch: number | null): string {
  if (!epoch) return "从未";
  return new Date(epoch * 1000).toLocaleString();
}

/** Format a large number with K/M suffixes. */
export function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

/** Format a unix epoch (seconds) to a relative time string (e.g. "5m ago"). */
export function relativeTime(epoch: number): string {
  const diff = Math.floor(Date.now() / 1000) - epoch;
  if (diff < 60) return "刚刚";
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  return `${Math.floor(diff / 86400)} 天前`;
}

/** Format seconds into a human-readable uptime (e.g. "2d 5h 3m"). */
export function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (d > 0) return `${d}天 ${h}小时 ${m}分钟`;
  if (h > 0) return `${h}小时 ${m}分钟 ${s}秒`;
  if (m > 0) return `${m}分钟 ${s}秒`;
  return `${s}秒`;
}

/** Format a unix epoch (seconds) to HH:MM:SS time-only string. */
export function formatTimestamp(epoch: number): string {
  if (!epoch) return "—";
  return new Date(epoch * 1000).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** Format an ISO timestamp string to HH:MM:SS.mmm. */
export function formatLogTimestamp(ts: string): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return `${hh}:${mm}:${ss}.${ms}`;
}

/** Format a unix epoch (seconds) to a short relative string (e.g. "5m", "3h", "2d"). */
export function formatAge(epoch: number): string {
  if (!epoch) return "";
  const diff = Math.floor(Date.now() / 1000) - epoch;
  if (diff < 3600) return `${Math.floor(diff / 60)}分钟`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}小时`;
  return `${Math.floor(diff / 86400)}天`;
}

/** Format an ISO date string to YYYY-MM-DD. */
export function formatDate(dateStr: string): string {
  if (!dateStr) return "";
  return dateStr.slice(0, 10);
}

/** Format an ISO timestamp string to "Mon DD" style. */
export function formatShortDate(ts: string): string {
  const d = new Date(ts);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

/** Like relativeTime but includes "yesterday" for 1-day-old epochs. */
export function timeAgo(epoch: number): string {
  const diff = Math.floor(Date.now() / 1000) - epoch;
  if (diff < 60) return "刚刚";
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  const days = Math.floor(diff / 86400);
  if (days === 1) return "昨天";
  return `${days} 天前`;
}

/** Format a future epoch (seconds) as a countdown string. */
export function formatCountdown(targetEpoch: number): string {
  const diff = targetEpoch - Math.floor(Date.now() / 1000);
  if (diff <= 0) return "现在";
  const hrs = Math.floor(diff / 3600);
  const mins = Math.floor((diff % 3600) / 60);
  const secs = diff % 60;
  if (hrs > 0) return `${hrs}小时 ${mins}分钟`;
  if (mins > 0) return `${mins}分钟 ${secs}秒`;
  return `${secs}秒`;
}

/** Format a minute interval as a human label (e.g. "Every 30 min", "Every 2h"). */
export function intervalLabel(minutes: number): string {
  if (minutes < 60) return `每 ${minutes} 分钟`;
  const hrs = Math.floor(minutes / 60);
  const rem = minutes % 60;
  if (rem === 0) return `每 ${hrs} 小时`;
  return `每 ${hrs} 小时 ${rem} 分钟`;
}

/** Format USD cost with appropriate precision. */
export function formatCost(usd: number): string {
  if (usd === 0) return "$0.00";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

/** Format milliseconds as a human-readable duration (e.g. "2.3s", "1m 30s"). */
export function formatDuration(ms: number): string {
  if (!ms) return "\u2014";
  if (ms < 1000) return `${ms}毫秒`;
  const sec = ms / 1000;
  return sec < 60
    ? `${sec.toFixed(1)}秒`
    : `${Math.floor(sec / 60)}分钟 ${Math.round(sec % 60)}秒`;
}

/** Parse a JSON array string, returning [] on failure. */
export function parseJsonArray<T = string>(json: string): readonly T[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
