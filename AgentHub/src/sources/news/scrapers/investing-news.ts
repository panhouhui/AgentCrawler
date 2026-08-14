/** Investing.com news scraper — Chromium, Cloudflare bypass, article polling. */

import type { RawArticle } from "../types";
import { launchChromium, waitForChallengePage } from "./browser";
import { randomDelay } from "./delays";
import { INVESTING_NEWS_URL } from "./constants";
import { createLogger } from "../../../logger";

const log = createLogger("scraper-investing-news");
const MAX_ARTICLES = 50;

export async function scrapeInvestingNews(): Promise<readonly RawArticle[]> {
  const session = await launchChromium();
  try {
    const page = await session.context.newPage();
    try {
      return await scrapeArticles(page);
    } finally {
      await page.close();
    }
  } finally {
    await session.cleanup();
  }
}

async function scrapeArticles(
  page: import("playwright").Page,
): Promise<readonly RawArticle[]> {
  log.info("Navigating", { url: INVESTING_NEWS_URL });
  await page.goto(INVESTING_NEWS_URL, { waitUntil: "domcontentloaded" });
  await randomDelay(2.0, 3.0);

  const passed = await waitForChallengePage(page, "investing-news", [
    "moment",
  ]);
  if (!passed) return [];

  await randomDelay(3.0, 5.0);

  // Poll for article elements
  let articleCount = 0;
  for (let i = 0; i < 10; i++) {
    articleCount = await page.evaluate(
      "document.querySelectorAll('article').length",
    );
    if (articleCount > 0) break;
    await randomDelay(1.0, 2.0);
  }

  if (articleCount === 0) {
    log.warn("Articles not found", { url: INVESTING_NEWS_URL });
    return [];
  }

  await randomDelay(1.0, 2.0);

  const rawItems = await page.evaluate(`(() => {
    const articles = document.querySelectorAll('article');
    const results = [];

    for (const art of articles) {
      const linkEl = art.querySelector('a[data-test="article-title-link"]')
        || art.querySelector('a[href*="/news/"]')
        || art.querySelector('a[href]');
      if (!linkEl) continue;

      const url = linkEl.getAttribute('href') || '';

      const pTitle = art.querySelector('p[title]');
      const titleLink = art.querySelector('a[data-test="article-title-link"]');
      const title = pTitle
        ? (pTitle.getAttribute('title') || pTitle.textContent.trim())
        : titleLink
          ? titleLink.textContent.trim()
          : linkEl.textContent.trim();
      if (!title) continue;

      const allPs = art.querySelectorAll('p');
      let summary = '';
      for (const p of allPs) {
        if (!p.getAttribute('title') && p.textContent.trim().length > 20) {
          summary = p.textContent.trim();
          break;
        }
      }

      const categoryEl = art.querySelector('[class*="category"]')
        || art.querySelector('span a[href*="/news/"]');
      const category = categoryEl ? categoryEl.textContent.trim() : '';

      const timeEl = art.querySelector('time')
        || art.querySelector('[class*="date"]');
      const publishedAt = timeEl
        ? (timeEl.getAttribute('datetime') || timeEl.textContent.trim())
        : '';

      const imgEl = art.querySelector('img');
      let imageUrl = '';
      if (imgEl) {
        imageUrl = imgEl.getAttribute('src')
          || imgEl.getAttribute('data-src') || '';
      }
      if (!imageUrl) {
        const bgDiv = art.querySelector('[class*="image"]');
        if (bgDiv) {
          const style = bgDiv.getAttribute('style') || '';
          const match = style.match(/url\\(['"]?([^'"\\)]+)['"]?\\)/);
          if (match) imageUrl = match[1];
        }
      }

      results.push({
        title,
        url: url.startsWith('http') ? url : 'https://www.investing.com' + url,
        summary,
        category,
        image_url: imageUrl,
        published_at: publishedAt,
      });
    }

    return results;
  })()`);

  const items = rawItems as Array<{
    title: string;
    url: string;
    summary: string;
    category: string;
    image_url: string;
    published_at: string;
  }>;

  log.info("Scrape complete", {
    source: "investing_news",
    count: items.length,
  });

  return items.slice(0, MAX_ARTICLES).map(
    (item): RawArticle => ({
      source_name: "investing_news",
      title: item.title,
      url: item.url,
      summary: item.summary,
      category: item.category,
      image_url: item.image_url,
      published_at: item.published_at,
      source_domain: "investing.com",
    }),
  );
}
