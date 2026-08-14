import { test, expect, describe } from "bun:test";
import { extractKeywords, expandQuery } from "./query-expansion";

describe("extractKeywords", () => {
  test("removes stop words", () => {
    const keywords = extractKeywords("what is the best way to do this");
    expect(keywords).not.toContain("what");
    expect(keywords).not.toContain("is");
    expect(keywords).not.toContain("the");
    expect(keywords).not.toContain("to");
    expect(keywords).not.toContain("this");
  });

  test("keeps meaningful keywords", () => {
    const keywords = extractKeywords(
      "how to implement authentication with JWT tokens",
    );
    expect(keywords).toContain("implement");
    expect(keywords).toContain("authentication");
    expect(keywords).toContain("jwt");
    expect(keywords).toContain("tokens");
  });

  test("filters words shorter than 3 characters", () => {
    const keywords = extractKeywords("go db io api");
    expect(keywords).not.toContain("go");
    expect(keywords).not.toContain("db");
    expect(keywords).not.toContain("io");
    // 'api' is 3 chars but > 2 so it should be kept
    expect(keywords).toContain("api");
  });

  test("deduplicates keywords", () => {
    const keywords = extractKeywords("memory memory memory search search");
    const memoryCount = keywords.filter((k) => k === "memory").length;
    expect(memoryCount).toBe(1);
  });

  test("handles empty string", () => {
    expect(extractKeywords("")).toEqual([]);
  });

  test("lowercases keywords", () => {
    const keywords = extractKeywords("Authentication JWT Security");
    expect(keywords).toContain("authentication");
    expect(keywords).toContain("jwt");
    expect(keywords).toContain("security");
  });

  test("strips punctuation", () => {
    const keywords = extractKeywords("Hello, world! How are you?");
    expect(keywords).toContain("hello");
    expect(keywords).toContain("world");
  });
});

describe("expandQuery", () => {
  test("returns original query unchanged", () => {
    const result = expandQuery("search for documents about authentication");
    expect(result.original).toBe("search for documents about authentication");
  });

  test("returns trimmed query as ftsQuery for websearch_to_tsquery", () => {
    const result = expandQuery("implement authentication tokens");
    expect(result.ftsQuery).toBe("implement authentication tokens");
  });

  test("handles single meaningful word", () => {
    const result = expandQuery("authentication");
    expect(result.ftsQuery).toBe("authentication");
  });

  test("uses fallback for all-stop-word query", () => {
    const result = expandQuery("is it the");
    // keywords will be empty, fallback to whole query
    expect(result.ftsQuery.length).toBeGreaterThan(0);
  });
});
