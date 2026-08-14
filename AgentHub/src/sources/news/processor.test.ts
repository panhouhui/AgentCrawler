import { test, expect, describe } from "bun:test";

// parsePublishedAt and toArticlesForIndex are not exported,
// so we replicate the pure logic for testing.

function parsePublishedAt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = new Date(raw).getTime();
  return isNaN(parsed) ? fallback : Math.floor(parsed / 1000);
}

interface RawArticle {
  readonly source_id?: string;
  readonly title: string;
  readonly url: string;
  readonly source_name: string;
  readonly category?: string;
  readonly summary?: string;
  readonly published_at?: string;
}

function toArticlesForIndex(articles: readonly RawArticle[]) {
  const now = Math.floor(Date.now() / 1000);
  return articles.map((a) => ({
    id: a.source_id ?? "fallback-id",
    title: a.title,
    url: a.url,
    sourceName: a.source_name,
    category: a.category ?? "",
    content: a.summary ?? null,
    publishedAt: parsePublishedAt(a.published_at, now),
  }));
}

describe("parsePublishedAt", () => {
  test("returns fallback for undefined", () => {
    expect(parsePublishedAt(undefined, 1000)).toBe(1000);
  });

  test("returns fallback for empty string", () => {
    expect(parsePublishedAt("", 1000)).toBe(1000);
  });

  test("parses valid ISO date string", () => {
    const result = parsePublishedAt("2024-01-15T10:30:00Z", 0);
    expect(result).toBe(Math.floor(new Date("2024-01-15T10:30:00Z").getTime() / 1000));
  });

  test("returns fallback for invalid date string", () => {
    expect(parsePublishedAt("not a date", 999)).toBe(999);
  });

  test("parses RFC 2822 date", () => {
    const result = parsePublishedAt("Mon, 15 Jan 2024 10:30:00 GMT", 0);
    expect(result).toBeGreaterThan(0);
  });

  test("returns epoch seconds not milliseconds", () => {
    const result = parsePublishedAt("2024-01-15T00:00:00Z", 0);
    // Should be ~1705276800, not 1705276800000
    expect(result).toBeLessThan(10_000_000_000);
  });
});

describe("toArticlesForIndex", () => {
  test("maps raw article to index format", () => {
    const articles: RawArticle[] = [
      {
        source_id: "abc123",
        title: "Test Article",
        url: "https://example.com",
        source_name: "Reuters",
        category: "tech",
        summary: "A summary",
        published_at: "2024-01-15T10:00:00Z",
      },
    ];

    const result = toArticlesForIndex(articles);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      id: "abc123",
      title: "Test Article",
      url: "https://example.com",
      sourceName: "Reuters",
      category: "tech",
      content: "A summary",
      publishedAt: Math.floor(new Date("2024-01-15T10:00:00Z").getTime() / 1000),
    });
  });

  test("uses fallback id when source_id missing", () => {
    const articles: RawArticle[] = [
      {
        title: "No ID",
        url: "https://example.com",
        source_name: "Test",
      },
    ];
    const result = toArticlesForIndex(articles);
    expect(result[0]!.id).toBe("fallback-id");
  });

  test("defaults category to empty string", () => {
    const articles: RawArticle[] = [
      {
        source_id: "1",
        title: "No Category",
        url: "https://example.com",
        source_name: "Test",
      },
    ];
    const result = toArticlesForIndex(articles);
    expect(result[0]!.category).toBe("");
  });

  test("defaults content to null when no summary", () => {
    const articles: RawArticle[] = [
      {
        source_id: "1",
        title: "No Summary",
        url: "https://example.com",
        source_name: "Test",
      },
    ];
    const result = toArticlesForIndex(articles);
    expect(result[0]!.content).toBeNull();
  });

  test("handles empty array", () => {
    expect(toArticlesForIndex([])).toEqual([]);
  });
});
