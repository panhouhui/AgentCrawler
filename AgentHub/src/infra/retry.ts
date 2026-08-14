export interface RetryConfig {
  readonly attempts: number;
  readonly minDelayMs: number;
  readonly maxDelayMs: number;
  readonly jitter: number;
}

export interface RetryInfo {
  readonly attempt: number;
  readonly error: unknown;
  readonly delayMs: number;
}

export interface RetryOptions extends Partial<RetryConfig> {
  readonly label?: string;
  readonly shouldRetry?: (err: unknown, attempt: number) => boolean;
  readonly retryAfterMs?: (err: unknown) => number | undefined;
  readonly onRetry?: (info: RetryInfo) => void;
  readonly signal?: AbortSignal;
}

const DEFAULT_CONFIG: RetryConfig = {
  attempts: 3,
  minDelayMs: 500,
  maxDelayMs: 30_000,
  jitter: 0.15,
};

function computeDelay(
  attempt: number,
  config: RetryConfig,
  retryAfterOverride?: number,
): number {
  if (retryAfterOverride !== undefined) {
    return Math.min(retryAfterOverride, config.maxDelayMs);
  }
  const base = config.minDelayMs * Math.pow(2, attempt - 1);
  const clamped = Math.min(base, config.maxDelayMs);
  const jitterRange = clamped * config.jitter;
  return clamped + (Math.random() * 2 - 1) * jitterRange;
}

export async function retryAsync<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const config: RetryConfig = {
    attempts: options.attempts ?? DEFAULT_CONFIG.attempts,
    minDelayMs: options.minDelayMs ?? DEFAULT_CONFIG.minDelayMs,
    maxDelayMs: options.maxDelayMs ?? DEFAULT_CONFIG.maxDelayMs,
    jitter: options.jitter ?? DEFAULT_CONFIG.jitter,
  };

  let lastError: unknown;
  for (let attempt = 1; attempt <= config.attempts; attempt++) {
    if (options.signal?.aborted) {
      throw new Error(`${options.label ?? "retryAsync"}: aborted`);
    }

    try {
      return await fn();
    } catch (err) {
      lastError = err;

      if (attempt === config.attempts) break;
      if (options.shouldRetry && !options.shouldRetry(err, attempt)) break;

      const retryAfterOverride = options.retryAfterMs?.(err);
      const delayMs = computeDelay(attempt, config, retryAfterOverride);

      options.onRetry?.({ attempt, error: err, delayMs });

      await new Promise<void>((resolve, reject) => {
        const onAbort = () => {
          clearTimeout(timer);
          reject(
            new Error(`${options.label ?? "retryAsync"}: aborted during delay`),
          );
        };
        const timer = setTimeout(() => {
          options.signal?.removeEventListener("abort", onAbort);
          resolve();
        }, delayMs);
        options.signal?.addEventListener("abort", onAbort, { once: true });
      });
    }
  }

  throw lastError;
}
