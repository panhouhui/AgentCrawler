export interface AutolikeJob {
  id: string;
  account_id: string;
  interval_minutes: number;
  max_likes_per_run: number;
  languages: string | null;
  status: "running" | "stopped";
  next_run_at: number | null;
  total_scraped: number;
  total_liked: number;
  total_errors: number;
  last_run_at: number | null;
  last_error: string | null;
  created_at: number;
  updated_at: number;
}

export interface ScrapedTweet {
  id: string;
  account_id: string;
  tweet_id: string;
  author_username: string;
  author_display_name: string;
  author_verified: boolean;
  author_followers: number;
  text: string;
  likes: number;
  retweets: number;
  replies: number;
  views: number;
  bookmarks: number;
  quotes: number;
  has_media: boolean;
  tweet_created_at: number | null;
  scraped_at: number;
}

export interface LikedTweet {
  id: string;
  account_id: string;
  tweet_id: string;
  author_username: string;
  text: string;
  likes: number;
  retweets: number;
  views: number;
  liked_at: number;
}

export interface ScrapedTweetFromPython {
  tweet_id: string;
  author_username: string;
  author_display_name: string;
  author_verified: boolean;
  author_followers: number;
  text: string;
  likes: number;
  retweets: number;
  replies: number;
  views: number;
  bookmarks: number;
  quotes: number;
  has_media: boolean;
  tweet_created_at: number | null;
}

export interface LikedTweetFromPython {
  tweet_id: string;
  author_username: string;
  text: string;
  likes: number;
  retweets: number;
  views: number;
}

export type AutolikeOutcome =
  | {
      ok: true;
      scraped: ScrapedTweetFromPython[];
      liked: LikedTweetFromPython[];
    }
  | {
      ok: false;
      reason: string;
      detail?: string;
    };
