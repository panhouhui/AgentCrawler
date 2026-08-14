import type {
  AgentOptions,
  ConversationMessage,
  StreamEvent,
  OpenAIMessage,
  OpenAIToolCall,
} from "./types";
import type { ToolRegistry } from "../tools/registry";
import {
  computeToolResultBudget,
  truncateToolResult as truncateToolResultToBudget,
} from "./tool-result-budget";
import { createLoopDetector } from "./loop-detection";
import { compressOldIterationsOpenAI } from "./sliding-window-openai";
import { pruneToolResultsOpenAI } from "./context-pruning-openai";
import { createLogger } from "../logger";

const log = createLogger("stream");

const DEFAULT_CONTEXT_WINDOW = 180_000;

// ─── OpenRouter streaming (SSE) ─────────────────────────────────────────────

async function getOpenRouterApiKey(): Promise<string> {
  const { getSecret } = await import("../config/secrets");
  const key = await getSecret("OPENROUTER_API_KEY");
  if (!key) throw new Error("OPENROUTER_API_KEY is not set");
  return key;
}

async function* parseSSE(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<Record<string, unknown>> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data: ")) continue;
        const data = trimmed.slice(6);
        if (data === "[DONE]") return;
        try {
          yield JSON.parse(data);
        } catch {
          // skip malformed chunks
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

const MAX_AGENTIC_HISTORY_OPENROUTER = 15;

function agenticChatStreamOpenRouter(
  messages: readonly ConversationMessage[],
  options: AgentOptions,
  registry: ToolRegistry,
  maxIterations: number,
): ReadableStream<StreamEvent> {
  return new ReadableStream<StreamEvent>({
    async start(controller) {
      const tools = registry.getOpenAITools();
      const apiKey = await getOpenRouterApiKey();
      const budget = computeToolResultBudget(DEFAULT_CONTEXT_WINDOW);
      const loopDetector = createLoopDetector();

      // Cap pre-loop history — pin first message (user constraints) + recent
      const recentMessages =
        messages.length > MAX_AGENTIC_HISTORY_OPENROUTER
          ? [
              messages[0]!,
              ...messages.slice(-(MAX_AGENTIC_HISTORY_OPENROUTER - 1)),
            ]
          : messages;

      let loopMessages: OpenAIMessage[] = [
        { role: "system", content: options.systemPrompt },
        ...recentMessages.map((m) => ({
          role: m.role as OpenAIMessage["role"],
          content: m.content,
        })),
      ];
      const preLoopCount = loopMessages.length;

      let totalInputTokens = 0;
      let totalOutputTokens = 0;
      let toolUseCount = 0;

      try {
        for (let iteration = 0; iteration < maxIterations; iteration++) {
          log.debug(
            `OpenRouter stream iteration ${iteration + 1}/${maxIterations}`,
          );

          const res = await fetch(
            "https://openrouter.ai/api/v1/chat/completions",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`,
                "HTTP-Referer": "https://github.com/gokhantos/opencrow",
                "X-Title": "OpenCrow AI Assistant",
              },
              body: JSON.stringify({
                model: options.model,
                max_tokens: 16384,
                messages: loopMessages,
                tools,
                tool_choice: "auto",
                stream: true,
              }),
            },
          );

          if (!res.ok) {
            const text = await res.text();
            throw new Error(`OpenRouter API error (${res.status}): ${text}`);
          }

          // Accumulate the streamed response
          let contentAccum = "";
          const toolCallAccum = new Map<
            number,
            { id: string; name: string; args: string }
          >();
          let finishReason = "";
          let usageChunk: {
            prompt_tokens?: number;
            completion_tokens?: number;
          } | null = null;

          for await (const chunk of parseSSE(
            res.body as ReadableStream<Uint8Array>,
          )) {
            const choices = chunk.choices as
              | Array<{
                  delta?: {
                    content?: string;
                    tool_calls?: Array<{
                      index: number;
                      id?: string;
                      function?: { name?: string; arguments?: string };
                    }>;
                  };
                  finish_reason?: string;
                }>
              | undefined;

            if (chunk.usage) {
              usageChunk = chunk.usage as {
                prompt_tokens?: number;
                completion_tokens?: number;
              };
            }

            const choice = choices?.[0];
            if (!choice) continue;

            if (choice.finish_reason) {
              finishReason = choice.finish_reason;
            }

            const delta = choice.delta;
            if (!delta) continue;

            if (delta.content) {
              contentAccum += delta.content;
              controller.enqueue({
                type: "text_delta",
                text: delta.content,
              });
            }

            if (delta.tool_calls) {
              for (const tc of delta.tool_calls) {
                const existing = toolCallAccum.get(tc.index);
                if (!existing) {
                  toolCallAccum.set(tc.index, {
                    id: tc.id ?? "",
                    name: tc.function?.name ?? "",
                    args: tc.function?.arguments ?? "",
                  });
                  if (tc.function?.name) {
                    controller.enqueue({
                      type: "tool_use_start",
                      name: tc.function.name,
                      id: tc.id ?? "",
                    });
                  }
                } else {
                  toolCallAccum.set(tc.index, {
                    ...existing,
                    args: existing.args + (tc.function?.arguments ?? ""),
                  });
                }
              }
            }
          }

          if (usageChunk) {
            totalInputTokens += usageChunk.prompt_tokens ?? 0;
            totalOutputTokens += usageChunk.completion_tokens ?? 0;
          }

          log.info("OpenRouter stream iteration", {
            iteration: iteration + 1,
            inputTokens: usageChunk?.prompt_tokens ?? 0,
            outputTokens: usageChunk?.completion_tokens ?? 0,
            messageCount: loopMessages.length,
          });

          controller.enqueue({
            type: "turn_complete",
            usage: {
              inputTokens: usageChunk?.prompt_tokens ?? 0,
              outputTokens: usageChunk?.completion_tokens ?? 0,
            },
          });

          if (finishReason !== "tool_calls") break;
          if (iteration === maxIterations - 1) {
            log.warn("OpenRouter stream hit max iterations", { maxIterations });
            break;
          }

          // Build tool calls from accumulated chunks
          const toolCalls: OpenAIToolCall[] = Array.from(
            toolCallAccum.values(),
          ).map((tc) => ({
            id: tc.id,
            type: "function" as const,
            function: { name: tc.name, arguments: tc.args },
          }));

          // Loop detection — check and record in a single pass
          for (const tc of toolCalls) {
            let parsedInput: unknown;
            try {
              parsedInput = JSON.parse(tc.function.arguments);
            } catch {
              parsedInput = { __raw: tc.function.arguments };
            }
            const detection = loopDetector.check(tc.function.name, parsedInput);
            if (detection.stuck) {
              log.warn("Tool loop detected — breaking OpenRouter stream", {
                tool: tc.function.name,
              });
              controller.enqueue({
                type: "text_delta",
                text: `\n\n[Stopped: agent stuck in loop calling ${tc.function.name}]`,
              });
              controller.enqueue({
                type: "done",
                totalUsage: {
                  inputTokens: totalInputTokens,
                  outputTokens: totalOutputTokens,
                },
                toolUseCount,
              });
              controller.close();
              return;
            }
          }

          toolUseCount += toolCalls.length;

          const toolResultMessages: OpenAIMessage[] = await Promise.all(
            toolCalls.map(async (tc) => {
              let input: Record<string, unknown>;
              try {
                input = JSON.parse(tc.function.arguments);
              } catch {
                input = {};
              }

              const result = await registry.executeTool(
                tc.function.name,
                input,
              );
              const truncatedOutput = truncateToolResultToBudget(
                result.output,
                budget.maxSingleResultChars,
              );
              controller.enqueue({
                type: "tool_result",
                name: tc.function.name,
                id: tc.id,
                output: truncatedOutput,
                isError: result.isError,
              });
              return {
                role: "tool" as const,
                tool_call_id: tc.id,
                content: truncatedOutput,
              };
            }),
          );

          const newMessages: OpenAIMessage[] = [
            ...loopMessages,
            {
              role: "assistant" as const,
              content: contentAccum || null,
              tool_calls: toolCalls,
            },
            ...toolResultMessages,
          ];
          // 1) Compress old iterations (strip reasoning, summarize results)
          const windowed = compressOldIterationsOpenAI(
            newMessages,
            preLoopCount,
          );
          // 2) Prune remaining large tool results progressively
          loopMessages = pruneToolResultsOpenAI(
            windowed,
            DEFAULT_CONTEXT_WINDOW,
          );
        }

        log.info("OpenRouter stream loop complete", {
          totalInputTokens,
          totalOutputTokens,
          toolUseCount,
        });

        controller.enqueue({
          type: "done",
          totalUsage: {
            inputTokens: totalInputTokens,
            outputTokens: totalOutputTokens,
          },
          toolUseCount,
        });
        controller.close();
      } catch (err) {
        log.error("OpenRouter stream error", err);
        controller.enqueue({
          type: "error",
          message: "An internal error occurred. Please try again.",
        });
        controller.close();
      }
    },
  });
}

function simpleStreamOpenRouter(
  messages: readonly ConversationMessage[],
  options: AgentOptions,
): ReadableStream<StreamEvent> {
  return new ReadableStream<StreamEvent>({
    async start(controller) {
      try {
        const apiKey = await getOpenRouterApiKey();

        const res = await fetch(
          "https://openrouter.ai/api/v1/chat/completions",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
              "HTTP-Referer": "https://github.com/gokhantos/opencrow",
              "X-Title": "OpenCrow AI Assistant",
            },
            body: JSON.stringify({
              model: options.model,
              max_tokens: 16384,
              messages: [
                { role: "system", content: options.systemPrompt },
                ...messages.map((m) => ({ role: m.role, content: m.content })),
              ],
              stream: true,
            }),
          },
        );

        if (!res.ok) {
          const text = await res.text();
          throw new Error(`OpenRouter API error (${res.status}): ${text}`);
        }

        let totalInputTokens = 0;
        let totalOutputTokens = 0;

        for await (const chunk of parseSSE(
          res.body as ReadableStream<Uint8Array>,
        )) {
          if (chunk.usage) {
            const usage = chunk.usage as {
              prompt_tokens?: number;
              completion_tokens?: number;
            };
            totalInputTokens += usage.prompt_tokens ?? 0;
            totalOutputTokens += usage.completion_tokens ?? 0;
          }

          const choices = chunk.choices as
            | Array<{ delta?: { content?: string } }>
            | undefined;
          const content = choices?.[0]?.delta?.content;
          if (content) {
            controller.enqueue({ type: "text_delta", text: content });
          }
        }

        controller.enqueue({
          type: "done",
          totalUsage: {
            inputTokens: totalInputTokens,
            outputTokens: totalOutputTokens,
          },
          toolUseCount: 0,
        });
        controller.close();
      } catch (err) {
        log.error("OpenRouter stream error", err);
        controller.enqueue({
          type: "error",
          message: "An internal error occurred. Please try again.",
        });
        controller.close();
      }
    },
  });
}

// ─── Public API ─────────────────────────────────────────────────────────────

export function chatStream(
  messages: readonly ConversationMessage[],
  options: AgentOptions,
  registry?: ToolRegistry,
): ReadableStream<StreamEvent> {
  const provider = options.provider ?? "agent-sdk";
  const effectiveRegistry = options.toolRegistry ?? registry;
  const hasTools = (options.toolsEnabled && options.toolRegistry) || registry;

  if (provider === "openrouter") {
    if (hasTools && effectiveRegistry) {
      return agenticChatStreamOpenRouter(
        messages,
        options,
        effectiveRegistry,
        options.maxToolIterations ?? 100,
      );
    }
    return simpleStreamOpenRouter(messages, options);
  }

  throw new Error(`Streaming not supported for provider: ${provider}`);
}
