export interface BookmarkJob {
  readonly id: string;
  readonly account_id: string;
  readonly interval_minutes: number;
  readonly status: "running" | "stopped";
  readonly next_run_at: number | null;
  readonly total_shared: number;
  readonly total_errors: number;
  readonly last_run_at: number | null;
  readonly last_error: string | null;
  readonly created_at: number;
  readonly updated_at: number;
}

export interface SharedVideo {
  readonly id: string;
  readonly account_id: string;
  readonly source_tweet_id: string;
  readonly source_author: string;
  readonly source_url: string;
  readonly shared_at: number;
  readonly created_at: number;
}

export interface ShareResult {
  readonly ok: true;
  readonly tweet_id: string;
  readonly author: string;
  readonly url: string;
}

export interface ShareFailure {
  readonly ok: false;
  readonly reason: "no_video_bookmarks" | "error";
  readonly detail?: string;
}

export type ShareOutcome = ShareResult | ShareFailure;
