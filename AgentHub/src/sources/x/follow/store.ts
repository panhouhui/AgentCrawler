import { getDb } from "../../../store/db";
import type {
  AutofollowJob,
  FollowedUser,
  FollowedUserFromPython,
} from "./types";

export function getAutofollowJob(
  accountId: string,
): Promise<AutofollowJob | null> {
  const db = getDb();
  return db`
    SELECT * FROM x_autofollow_jobs WHERE account_id = ${accountId}
  `.then((rows) => (rows[0] as AutofollowJob) ?? null);
}

export function upsertAutofollowJob(
  accountId: string,
  intervalMinutes: number,
  maxFollowsPerRun: number,
  status: "running" | "stopped",
  nextRunAt: number | null,
  languages: string | null = null,
): Promise<AutofollowJob> {
  const db = getDb();
  const id = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);

  return db`
    INSERT INTO x_autofollow_jobs (id, account_id, interval_minutes, max_follows_per_run, languages, status, next_run_at, created_at, updated_at)
    VALUES (${id}, ${accountId}, ${intervalMinutes}, ${maxFollowsPerRun}, ${languages}, ${status}, ${nextRunAt}, ${now}, ${now})
    ON CONFLICT (account_id) DO UPDATE SET
      interval_minutes = ${intervalMinutes},
      max_follows_per_run = ${maxFollowsPerRun},
      languages = ${languages},
      status = ${status},
      next_run_at = ${nextRunAt},
      updated_at = ${now}
    RETURNING *
  `.then((rows) => rows[0] as AutofollowJob);
}

export function updateFollowJobAfterSuccess(
  accountId: string,
  followedCount: number,
  nextRunAt: number,
): Promise<void> {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  return db`
    UPDATE x_autofollow_jobs SET
      total_followed = total_followed + ${followedCount},
      last_run_at = ${now},
      last_error = NULL,
      next_run_at = ${nextRunAt},
      updated_at = ${now}
    WHERE account_id = ${accountId}
  `.then(() => undefined);
}

export function updateFollowJobAfterError(
  accountId: string,
  errorMsg: string,
  nextRunAt: number,
): Promise<void> {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  return db`
    UPDATE x_autofollow_jobs SET
      total_errors = total_errors + 1,
      last_run_at = ${now},
      last_error = ${errorMsg},
      next_run_at = ${nextRunAt},
      updated_at = ${now}
    WHERE account_id = ${accountId}
  `.then(() => undefined);
}

export function stopAutofollowJob(accountId: string): Promise<void> {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  return db`
    UPDATE x_autofollow_jobs SET
      status = 'stopped',
      next_run_at = NULL,
      updated_at = ${now}
    WHERE account_id = ${accountId}
  `.then(() => undefined);
}

export function getDueAutofollowJobs(): Promise<AutofollowJob[]> {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  return db`
    SELECT * FROM x_autofollow_jobs
    WHERE status = 'running' AND next_run_at <= ${now}
  `.then((rows) => rows as AutofollowJob[]);
}

export function getFollowCandidates(
  accountId: string,
  limit: number,
): Promise<string[]> {
  const db = getDb();

  return db`
    SELECT author_username FROM (
      SELECT author_username, MAX(liked_at) AS latest
      FROM x_liked_tweets
      WHERE account_id = ${accountId}
        AND author_username != ''
        AND author_username NOT IN (
          SELECT username FROM x_followed_users WHERE account_id = ${accountId}
        )
      GROUP BY author_username
    ) t
    ORDER BY latest DESC
    LIMIT ${limit}
  `.then((rows) =>
    rows.map((r: any) => (r as { author_username: string }).author_username),
  );
}

export function getAlreadyFollowedUsernames(
  accountId: string,
): Promise<string[]> {
  const db = getDb();

  return db`
    SELECT username FROM x_followed_users WHERE account_id = ${accountId}
  `.then((rows) => rows.map((r: any) => (r as { username: string }).username));
}

export async function insertFollowedUsers(
  accountId: string,
  users: FollowedUserFromPython[],
): Promise<void> {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  for (const u of users) {
    await db`
      INSERT INTO x_followed_users (
        id, account_id, user_id, username, display_name,
        followers_count, following_count, verified, followed_at
      ) VALUES (
        ${crypto.randomUUID()}, ${accountId}, ${u.user_id},
        ${u.username}, ${u.display_name}, ${u.followers_count},
        ${u.following_count}, ${u.verified}, ${now}
      )
      ON CONFLICT (account_id, username) DO NOTHING
    `;
  }
}

export function getFollowedUsers(
  accountId: string,
  limit: number = 100,
): Promise<FollowedUser[]> {
  const db = getDb();

  return db`
    SELECT * FROM x_followed_users
    WHERE account_id = ${accountId}
    ORDER BY followed_at DESC
    LIMIT ${limit}
  `.then((rows) => rows as FollowedUser[]);
}

export function getAccountCredentials(
  accountId: string,
): Promise<{ auth_token: string; ct0: string } | null> {
  const db = getDb();

  return db`
    SELECT auth_token, ct0 FROM x_accounts
    WHERE id = ${accountId} AND status = 'active'
  `.then((rows) =>
    rows[0] ? (rows[0] as { auth_token: string; ct0: string }) : null,
  );
}
