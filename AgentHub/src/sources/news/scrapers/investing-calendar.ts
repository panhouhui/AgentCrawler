/** Investing.com economic calendar scraper — Chromium, Cloudflare bypass, table parsing. */

import type { RawCalendarEvent } from "../types";
import { launchChromium, waitForChallengePage } from "./browser";
import { randomDelay } from "./delays";
import { INVESTING_CALENDAR_URL } from "./constants";
import { createLogger } from "../../../logger";

const log = createLogger("scraper-investing-calendar");
const MAX_EVENTS = 50;

export async function scrapeInvestingCalendar(): Promise<
  readonly RawCalendarEvent[]
> {
  const session = await launchChromium();
  try {
    const page = await session.context.newPage();
    try {
      return await scrapeCalendar(page);
    } finally {
      await page.close();
    }
  } finally {
    await session.cleanup();
  }
}

async function scrapeCalendar(
  page: import("playwright").Page,
): Promise<readonly RawCalendarEvent[]> {
  log.info("Navigating", { url: INVESTING_CALENDAR_URL });
  await page.goto(INVESTING_CALENDAR_URL, { waitUntil: "domcontentloaded" });
  await randomDelay(2.0, 3.0);

  const passed = await waitForChallengePage(page, "investing-calendar", [
    "moment",
  ]);
  if (!passed) return [];

  await randomDelay(3.0, 5.0);

  try {
    await page.waitForSelector("tr.datatable-v2_row__hkEus", {
      timeout: 20_000,
    });
  } catch {
    log.warn("Calendar rows not found", { url: INVESTING_CALENDAR_URL });
    return [];
  }

  await randomDelay(1.0, 2.0);

  const rawEvents = await page.evaluate(`(() => {
    const rows = document.querySelectorAll('tr.datatable-v2_row__hkEus');
    const results = [];

    for (const row of rows) {
      const tds = row.querySelectorAll('td');
      if (tds.length < 6) continue;

      const eventLink = row.querySelector('a[href*="economic-calendar"]');
      const eventName = eventLink ? eventLink.textContent.trim() : '';
      if (!eventName) continue;

      const timeText = tds[1] ? tds[1].textContent.trim() : '';
      const currencyText = tds[2] ? tds[2].textContent.trim() : '';

      const flagEl = row.querySelector('[data-test*="flag-"]');
      const country = flagEl
        ? flagEl.getAttribute('data-test').replace('flag-', '')
        : '';

      const stars = tds[4]
        ? tds[4].querySelectorAll('svg')
        : [];
      let filledCount = 0;
      for (const star of stars) {
        if (star.getAttribute('class')
          && star.getAttribute('class').includes('opacity-60')) {
          filledCount++;
        }
      }
      let importance = 'medium';
      if (filledCount >= 3) importance = 'high';
      else if (filledCount <= 1) importance = 'low';

      const actual = tds[5] ? tds[5].textContent.trim() : '';
      const forecast = tds[6] ? tds[6].textContent.trim() : '';
      const previous = tds[7] ? tds[7].textContent.trim() : '';

      const sourceUrl = eventLink
        ? eventLink.getAttribute('href') || ''
        : '';

      results.push({
        event_name: eventName,
        country,
        currency: currencyText,
        importance,
        event_datetime: timeText,
        actual,
        forecast,
        previous,
        source_url: sourceUrl.startsWith('http')
          ? sourceUrl
          : 'https://www.investing.com' + sourceUrl,
      });
    }

    return results;
  })()`);

  const events = rawEvents as Array<{
    event_name: string;
    country: string;
    currency: string;
    importance: string;
    event_datetime: string;
    actual: string;
    forecast: string;
    previous: string;
    source_url: string;
  }>;

  log.info("Scrape complete", {
    source: "investing_calendar",
    count: events.length,
  });

  return events.slice(0, MAX_EVENTS).map(
    (item): RawCalendarEvent => ({
      event_name: item.event_name,
      country: item.country,
      currency: item.currency,
      importance: item.importance,
      event_datetime: item.event_datetime,
      actual: item.actual,
      forecast: item.forecast,
      previous: item.previous,
      source_url: item.source_url,
    }),
  );
}
