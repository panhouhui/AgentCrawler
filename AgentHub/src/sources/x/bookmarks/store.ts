import { getDb } from "../../../store/db";
import type { BookmarkJob, SharedVideo } from "./types";

export function getBookmarkJob(
  accountId: string,
): Promise<BookmarkJob | null> {
  const db = getDb();
  return db`
    SELECT * FROM x_bookmark_jobs WHERE account_id = ${accountId}
  `.then((rows) => (rows[0] as BookmarkJob) ?? null);
}

export function upsertBookmarkJob(
  accountId: string,
  intervalMinutes: number,
  status: "running" | "stopped",
  nextRunAt: number | null,
): Promise<BookmarkJob> {
  const db = getDb();
  const id = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);

  return db`
    INSERT INTO x_bookmark_jobs (id, account_id, interval_minutes, status, next_run_at, created_at, updated_at)
    VALUES (${id}, ${accountId}, ${intervalMinutes}, ${status}, ${nextRunAt}, ${now}, ${now})
    ON CONFLICT (account_id) DO UPDATE SET
      interval_minutes = ${intervalMinutes},
      status = ${status},
      next_run_at = ${nextRunAt},
      updated_at = ${now}
    RETURNING *
  `.then((rows) => rows[0] as BookmarkJob);
}

export function updateJobAfterSuccess(
  accountId: string,
  nextRunAt: number,
): Promise<void> {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  return db`
    UPDATE x_bookmark_jobs SET
      total_shared = total_shared + 1,
      last_run_at = ${now},
      last_error = NULL,
      next_run_at = ${nextRunAt},
      updated_at = ${now}
    WHERE account_id = ${accountId}
  `.then(() => undefined);
}

export function updateJobAfterError(
  accountId: string,
  errorMsg: string,
  nextRunAt: number,
): Promise<void> {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  return db`
    UPDATE x_bookmark_jobs SET
      total_errors = total_errors + 1,
      last_run_at = ${now},
      last_error = ${errorMsg},
      next_run_at = ${nextRunAt},
      updated_at = ${now}
    WHERE account_id = ${accountId}
  `.then(() => undefined);
}

export function stopJob(accountId: string): Promise<void> {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  return db`
    UPDATE x_bookmark_jobs SET
      status = 'stopped',
      next_run_at = NULL,
      updated_at = ${now}
    WHERE account_id = ${accountId}
  `.then(() => undefined);
}

export function getDueJobs(): Promise<BookmarkJob[]> {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  return db`
    SELECT * FROM x_bookmark_jobs
    WHERE status = 'running' AND next_run_at <= ${now}
  `.then((rows) => rows as BookmarkJob[]);
}

export function insertSharedVideo(
  accountId: string,
  tweetId: string,
  author: string,
  url: string,
): Promise<void> {
  const db = getDb();
  const id = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);

  return db`
    INSERT INTO x_shared_videos (id, account_id, source_tweet_id, source_author, source_url, shared_at, created_at)
    VALUES (${id}, ${accountId}, ${tweetId}, ${author}, ${url}, ${now}, ${now})
    ON CONFLICT (account_id, source_tweet_id) DO NOTHING
  `.then(() => undefined);
}

export function getSharedVideoIds(accountId: string): Promise<string[]> {
  const db = getDb();

  return db`
    SELECT source_tweet_id FROM x_shared_videos WHERE account_id = ${accountId}
  `.then((rows) => rows.map((r: any) => (r as { source_tweet_id: string }).source_tweet_id));
}

export function getSharedVideos(
  accountId: string,
  limit: number = 50,
): Promise<SharedVideo[]> {
  const db = getDb();

  return db`
    SELECT * FROM x_shared_videos
    WHERE account_id = ${accountId}
    ORDER BY shared_at DESC
    LIMIT ${limit}
  `.then((rows) => rows as SharedVideo[]);
}

export function getAccountCredentials(
  accountId: string,
): Promise<{ auth_token: string; ct0: string } | null> {
  const db = getDb();

  return db`
    SELECT auth_token, ct0 FROM x_accounts
    WHERE id = ${accountId} AND status = 'active'
  `.then((rows) =>
    rows[0]
      ? (rows[0] as { auth_token: string; ct0: string })
      : null,
  );
}
