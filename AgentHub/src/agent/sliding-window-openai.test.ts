import { test, expect, describe } from "bun:test";
import { compressOldIterationsOpenAI } from "./sliding-window-openai";
import type { OpenAIMessage } from "./types";

function makeIteration(
  toolNames: string[],
  toolResults: string[],
): OpenAIMessage[] {
  const assistant: OpenAIMessage = {
    role: "assistant",
    content: "Let me check that for you.",
    tool_calls: toolNames.map((name, i) => ({
      id: `call_${name}_${i}`,
      type: "function" as const,
      function: { name, arguments: JSON.stringify({ path: `/file${i}` }) },
    })),
  };
  const toolMsgs: OpenAIMessage[] = toolNames.map((name, i) => ({
    role: "tool" as const,
    tool_call_id: `call_${name}_${i}`,
    content: toolResults[i] ?? `result of ${name}`,
  }));
  return [assistant, ...toolMsgs];
}

const preLoop: OpenAIMessage[] = [
  { role: "system", content: "You are a helpful assistant." },
  { role: "user", content: "Read some files for me." },
];

describe("compressOldIterationsOpenAI", () => {
  test("returns unchanged when iterations <= keepRecent", () => {
    const iter1 = makeIteration(["bash"], ["ls output"]);
    const iter2 = makeIteration(["read_file"], ["file content"]);
    const messages = [...preLoop, ...iter1, ...iter2];
    const result = compressOldIterationsOpenAI(messages, preLoop.length, {
      keepRecentIterations: 4,
    });
    expect(result).toEqual([...messages]);
  });

  test("compresses old iterations beyond keepRecent", () => {
    const iters = Array.from({ length: 6 }, (_, i) =>
      makeIteration(["bash"], [`output ${i}`]),
    );
    const messages = [...preLoop, ...iters.flat()];
    const result = compressOldIterationsOpenAI(messages, preLoop.length, {
      keepRecentIterations: 4,
    });

    // Pre-loop preserved
    expect(result[0]).toEqual(preLoop[0]);
    expect(result[1]).toEqual(preLoop[1]);

    // First 2 iterations (old) should be compressed
    const firstOldAssistant = result[2]!;
    expect(firstOldAssistant.role).toBe("assistant");
    expect(firstOldAssistant.content).toBe("[Called: bash]");
    expect(firstOldAssistant.tool_calls).toBeDefined(); // preserved for API pairing

    const firstOldTool = result[3]!;
    expect(firstOldTool.role).toBe("tool");
    expect(firstOldTool.content).toContain("chars]");

    // Recent 4 iterations should be untouched
    const recentStart = 2 + 2 * 2; // preLoop + 2 compressed iterations (each 2 msgs)
    const recentMessages = result.slice(recentStart);
    const expectedRecent = iters.slice(2).flat();
    expect(recentMessages).toEqual(expectedRecent);
  });

  test("preserves pre-loop messages untouched", () => {
    const iters = Array.from({ length: 6 }, (_, i) =>
      makeIteration(["bash"], [`output ${i}`]),
    );
    const messages = [...preLoop, ...iters.flat()];
    const result = compressOldIterationsOpenAI(messages, preLoop.length);
    expect(result[0]).toEqual(preLoop[0]);
    expect(result[1]).toEqual(preLoop[1]);
  });

  test("keeps tool_calls array intact in compressed assistant messages", () => {
    const iters = Array.from({ length: 6 }, (_, i) =>
      makeIteration(["bash", "read_file"], [`bash ${i}`, `file ${i}`]),
    );
    const messages = [...preLoop, ...iters.flat()];
    const result = compressOldIterationsOpenAI(messages, preLoop.length);

    // First compressed assistant message
    const compressed = result[2]!;
    expect(compressed.content).toBe("[Called: bash, read_file]");
    expect(compressed.tool_calls).toHaveLength(2);
    expect(compressed.tool_calls![0]!.function.name).toBe("bash");
    expect(compressed.tool_calls![1]!.function.name).toBe("read_file");
  });

  test("does not mutate original messages", () => {
    const iters = Array.from({ length: 6 }, (_, i) =>
      makeIteration(["bash"], [`output ${i}`]),
    );
    const messages = [...preLoop, ...iters.flat()];
    const original = JSON.stringify(messages);
    compressOldIterationsOpenAI(messages, preLoop.length);
    expect(JSON.stringify(messages)).toBe(original);
  });

  test("handles empty loop messages", () => {
    const result = compressOldIterationsOpenAI(preLoop, preLoop.length);
    expect(result).toEqual([...preLoop]);
  });

  test("handles iterations with multiple tool calls", () => {
    // 6 iterations, each with 3 tool calls (1 assistant + 3 tool = 4 msgs each)
    const iters = Array.from({ length: 6 }, (_, i) =>
      makeIteration(
        ["bash", "read_file", "list_files"],
        [`bash ${i}`, `file ${i}`, `list ${i}`],
      ),
    );
    const messages = [...preLoop, ...iters.flat()];
    const result = compressOldIterationsOpenAI(messages, preLoop.length);

    // Total messages: preLoop(2) + compressed(2 iters * 4 msgs) + recent(4 iters * 4 msgs)
    expect(result.length).toBe(2 + 2 * 4 + 4 * 4);
    // All messages accounted for
    expect(result.length).toBe(messages.length);
  });

  test("configurable keepRecentIterations", () => {
    const iters = Array.from({ length: 6 }, (_, i) =>
      makeIteration(["bash"], [`output ${i}`]),
    );
    const messages = [...preLoop, ...iters.flat()];

    const result2 = compressOldIterationsOpenAI(messages, preLoop.length, {
      keepRecentIterations: 2,
    });
    // 4 old iterations compressed, 2 recent kept
    const compressedAssistant = result2[2]!;
    expect(compressedAssistant.content).toBe("[Called: bash]");

    // Recent 2 iterations (last 4 messages) should be original
    const recent = result2.slice(-4);
    expect(recent).toEqual(iters.slice(4).flat());
  });
});
