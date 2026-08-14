export interface AutofollowJob {
  id: string;
  account_id: string;
  max_follows_per_run: number;
  interval_minutes: number;
  languages: string | null;
  status: "running" | "stopped";
  next_run_at: number | null;
  total_followed: number;
  total_errors: number;
  last_run_at: number | null;
  last_error: string | null;
  created_at: number;
  updated_at: number;
}

export interface FollowedUser {
  id: string;
  account_id: string;
  user_id: string;
  username: string;
  display_name: string;
  followers_count: number;
  following_count: number;
  verified: boolean;
  source_tweet_id: string | null;
  followed_at: number;
  follow_back: boolean;
  follow_back_checked_at: number | null;
  unfollowed_at: number | null;
  created_at: number;
}

export interface FollowedUserFromPython {
  username: string;
  user_id: string;
  display_name: string;
  followers_count: number;
  following_count: number;
  verified: boolean;
}

export type AutofollowOutcome =
  | {
      ok: true;
      followed: FollowedUserFromPython[];
    }
  | {
      ok: false;
      reason: string;
      detail?: string;
    };
