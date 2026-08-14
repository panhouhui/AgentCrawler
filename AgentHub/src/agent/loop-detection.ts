/**
 * Tool loop detection — detects when an agent is stuck calling the
 * same tool with the same args repeatedly. Injects a warning, then
 * circuit-breaks after too many repeats.
 *
 * Simplified from OpenClaw's tool-loop-detection.ts
 */

export interface LoopDetectorConfig {
  readonly historySize: number;
  readonly warningThreshold: number;
  readonly criticalThreshold: number;
}

export const DEFAULT_LOOP_CONFIG: LoopDetectorConfig = {
  historySize: 20,
  warningThreshold: 5,
  criticalThreshold: 10,
};

interface ToolCallRecord {
  readonly toolName: string;
  readonly argsHash: string;
}

export interface LoopDetectionResult {
  readonly stuck: boolean;
  readonly level?: "warning" | "critical";
  readonly message?: string;
}

function sanitizeToolName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
}

function sortedStringify(value: unknown): string {
  return JSON.stringify(value, (_, v) => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const sorted: Record<string, unknown> = {};
      for (const key of Object.keys(v).sort()) {
        sorted[key] = v[key];
      }
      return sorted;
    }
    return v;
  });
}

function hashArgs(params: unknown): string {
  try {
    const stable = sortedStringify(params);
    // Simple FNV-1a-like hash for speed (no crypto needed)
    let h = 0x811c9dc5;
    for (let i = 0; i < stable.length; i++) {
      h ^= stable.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(36);
  } catch {
    // Random fallback prevents false-positive collisions when serialization fails
    return `fb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }
}

export function createLoopDetector(
  config: LoopDetectorConfig = DEFAULT_LOOP_CONFIG,
) {
  const history: ToolCallRecord[] = [];

  /**
   * Check for a loop and record the call in a single pass.
   * Hashes args exactly once to avoid non-deterministic fallback divergence.
   */
  function check(toolName: string, params: unknown): LoopDetectionResult {
    const argsHash = hashArgs(params);

    // Count identical calls (same tool + same args) in recent history
    let repeatCount = 0;
    for (const entry of history) {
      if (entry.toolName === toolName && entry.argsHash === argsHash) {
        repeatCount++;
      }
    }

    // Record this call
    history.push({ toolName, argsHash });
    if (history.length > config.historySize) {
      history.shift();
    }

    const safeName = sanitizeToolName(toolName);

    if (repeatCount >= config.criticalThreshold) {
      return {
        stuck: true,
        level: "critical",
        message: `STOP: You have called "${safeName}" with the same arguments ${repeatCount} times. You are stuck in a loop. Change your approach or ask the user for help.`,
      };
    }

    if (repeatCount >= config.warningThreshold) {
      return {
        stuck: false,
        level: "warning",
        message: `WARNING: You have called "${safeName}" with the same arguments ${repeatCount} times. Consider a different approach.`,
      };
    }

    return { stuck: false };
  }

  return { check };
}
