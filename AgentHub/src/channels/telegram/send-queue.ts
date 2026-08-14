import { createLogger } from "../../logger";

const log = createLogger("telegram:send-queue");

const MIN_SEND_INTERVAL_MS = 50;
const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 1_000;

interface QueueEntry<T> {
  readonly fn: () => Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (error: unknown) => void;
}

/**
 * Serial send queue with rate limiting and 429 retry.
 * All outbound Telegram API calls should go through this queue
 * to stay under the 30 msg/sec global limit.
 */
export function createSendQueue() {
  const queue: QueueEntry<unknown>[] = [];
  let processing = false;
  let lastSendAt = 0;

  async function process(): Promise<void> {
    if (processing) return;
    processing = true;

    try {
      while (queue.length > 0) {
        const entry = queue.shift()!;
        const elapsed = Date.now() - lastSendAt;
        if (elapsed < MIN_SEND_INTERVAL_MS) {
          await sleep(MIN_SEND_INTERVAL_MS - elapsed);
        }

        try {
          const result = await executeWithRetry(entry.fn);
          lastSendAt = Date.now();
          entry.resolve(result);
        } catch (err) {
          lastSendAt = Date.now();
          entry.reject(err);
        }
      }
    } finally {
      processing = false;
    }
  }

  function enqueue<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      queue.push({ fn, resolve, reject } as QueueEntry<unknown>);
      process().catch((err) =>
        log.error("Send queue process error", { error: err }),
      );
    });
  }

  return { enqueue };
}

function is429(err: unknown): { retryAfter: number } | null {
  if (!(err instanceof Error)) return null;
  const msg = err.message;
  if (!msg.includes("429")) return null;

  const match = msg.match(/retry after (\d+)/i);
  const retryAfter = match ? Number(match[1]) * 1_000 : BASE_BACKOFF_MS;
  return { retryAfter };
}

async function executeWithRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const rateLimit = is429(err);
      if (!rateLimit || attempt === MAX_RETRIES) throw err;

      const backoff = Math.max(
        rateLimit.retryAfter,
        BASE_BACKOFF_MS * 2 ** attempt,
      );
      log.warn("Rate limited, retrying", { attempt: attempt + 1, backoffMs: backoff });
      await sleep(backoff);
    }
  }
  throw new Error("unreachable");
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
