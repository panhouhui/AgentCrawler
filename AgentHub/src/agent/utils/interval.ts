/**
 * Convert a time window string to hours for safe SQL parameterization.
 *
 * Supports fixed values ("1h", "24h", "7d", "30d") and
 * arbitrary patterns like "3d", "2w", "1m".
 *
 * Usage with Bun.sql:
 *   const hours = windowToHours(window);
 *   db`WHERE created_at >= NOW() - (${hours} * INTERVAL '1 hour')`
 */
export function windowToHours(window: string): number {
  // Try parsing arbitrary pattern first: "<number><unit>"
  const match = window.match(/^(\d+)([hdwm])$/);
  if (match) {
    const value = parseInt(match[1]!, 10);
    const unit = match[2]!;
    switch (unit) {
      case "h":
        return value;
      case "d":
        return value * 24;
      case "w":
        return value * 24 * 7;
      case "m":
        return value * 24 * 30;
    }
  }

  // Fallback for known fixed values
  switch (window) {
    case "1h":
      return 1;
    case "24h":
      return 24;
    case "7d":
      return 7 * 24;
    case "30d":
      return 30 * 24;
    default:
      return 24;
  }
}
