/** Barrel export and scraper registry for news sources. */

import type { NewsSource, RawArticle, RawCalendarEvent } from "../types";

export { scrapeCointelegraph } from "./cointelegraph";
export { scrapeCryptopanic } from "./cryptopanic";
export { scrapeReuters } from "./reuters";
export { scrapeInvestingNews } from "./investing-news";
export { scrapeInvestingCalendar } from "./investing-calendar";

type ArticleScraper = () => Promise<readonly RawArticle[]>;
type CalendarScraper = () => Promise<readonly RawCalendarEvent[]>;

// Lazy imports to avoid loading all browser engines at startup
export async function getArticleScraper(
  source: Exclude<NewsSource, "investing_calendar">,
): Promise<ArticleScraper> {
  switch (source) {
    case "cointelegraph": {
      const m = await import("./cointelegraph");
      return m.scrapeCointelegraph;
    }
    case "cryptopanic": {
      const m = await import("./cryptopanic");
      return m.scrapeCryptopanic;
    }
    case "reuters": {
      const m = await import("./reuters");
      return m.scrapeReuters;
    }
    case "investing_news": {
      const m = await import("./investing-news");
      return m.scrapeInvestingNews;
    }
  }
}

export async function getCalendarScraper(): Promise<CalendarScraper> {
  const m = await import("./investing-calendar");
  return m.scrapeInvestingCalendar;
}
