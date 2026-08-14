import { test, expect, describe } from "bun:test";
import { chunkMessage } from "./chunk";

describe("chunkMessage", () => {
  test("returns single chunk for short text", () => {
    const text = "Hello world";
    const chunks = chunkMessage(text);
    expect(chunks).toEqual(["Hello world"]);
  });

  test("returns single chunk for text at exact limit", () => {
    const text = "a".repeat(4000);
    const chunks = chunkMessage(text);
    expect(chunks).toEqual([text]);
  });

  test("splits on double newline (paragraph boundary)", () => {
    const part1 = "A".repeat(2000);
    const part2 = "B".repeat(2000);
    const text = `${part1}\n\n${part2}`;
    const chunks = chunkMessage(text, 4000);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0]).toContain("A");
  });

  test("splits on single newline when no paragraph break", () => {
    const part1 = "A".repeat(2000);
    const part2 = "B".repeat(2000);
    const text = `${part1}\n${part2}`;
    const chunks = chunkMessage(text, 4000);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
  });

  test("splits on space when no newlines", () => {
    const word = "abcdefghij "; // 11 chars per word+space
    const text = word.repeat(500); // 5500 chars
    const chunks = chunkMessage(text, 4000);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    // Each chunk should end cleanly (no mid-word split)
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(4000);
    }
  });

  test("hard splits when no whitespace found", () => {
    const text = "X".repeat(10000);
    const chunks = chunkMessage(text, 4000);
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    expect(chunks[0]!.length).toBe(4000);
  });

  test("handles empty text", () => {
    const chunks = chunkMessage("");
    expect(chunks).toEqual([""]);
  });

  test("respects custom maxLength", () => {
    const text = "Hello world. This is a test message with some content.";
    const chunks = chunkMessage(text, 20);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(20);
    }
  });

  test("does not produce empty chunks from trimming", () => {
    const text = "Word ".repeat(1000);
    const chunks = chunkMessage(text, 100);
    for (const chunk of chunks) {
      expect(chunk.length).toBeGreaterThan(0);
    }
  });

  test("prefers paragraph breaks over line breaks", () => {
    // Build text where a paragraph break exists before the limit
    const lines = [
      "A".repeat(1500),
      "",
      "B".repeat(1500),
      "C".repeat(1500),
    ];
    const text = lines.join("\n");
    const chunks = chunkMessage(text, 4000);
    // First chunk should split at the paragraph break
    expect(chunks[0]!.endsWith("A".repeat(1500))).toBe(true);
  });
});
