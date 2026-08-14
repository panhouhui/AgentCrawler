import { useState, useRef, useCallback } from "react";
import { Modal, Button } from "../../components";
import { getToken } from "../../api";
import { Sparkles, Wand2, StopCircle, Check } from "lucide-react";
import type { SkillFormData } from "./types";

interface AiSkillGeneratorProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onGenerated: (data: SkillFormData) => void;
}

type GeneratorState = "idle" | "generating" | "done" | "error";

const PROMPT_SUGGESTIONS = [
  "用于撰写兼顾 SEO 的技术博客文章",
  "用于系统化排查生产环境问题",
  "用于开展用户访谈并总结反馈",
  "用于根据需求设计数据库结构",
  "用于按照 TDD 方法编写单元测试",
  "用于创建社交媒体内容日历",
] as const;

function parseGeneratedSkill(text: string): SkillFormData | null {
  const trimmed = text.trim();

  const jsonStart = trimmed.indexOf("{");
  const jsonEnd = trimmed.lastIndexOf("}");
  if (jsonStart === -1 || jsonEnd === -1) return null;

  try {
    const parsed = JSON.parse(trimmed.slice(jsonStart, jsonEnd + 1));
    if (
      typeof parsed.name === "string" &&
      parsed.name.length > 0 &&
      parsed.name.length <= 100 &&
      typeof parsed.description === "string" &&
      parsed.description.length > 0 &&
      parsed.description.length <= 500 &&
      typeof parsed.content === "string"
    ) {
      return {
        name: parsed.name.trim(),
        description: parsed.description.trim(),
        content: parsed.content,
      };
    }
  } catch {
    // fall through
  }

  return null;
}

async function consumeSseStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onDelta: (accumulated: string) => void,
): Promise<{ text: string } | { error: string }> {
  const decoder = new TextDecoder();
  let accumulated = "";
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

        try {
          const event = JSON.parse(trimmed.slice(6));

          if (event.type === "text_delta") {
            accumulated += event.text;
            onDelta(accumulated);
          }

          if (event.type === "error") {
            return { error: event.message ?? "生成失败" };
          }

          if (event.type === "done") {
            return { text: event.text ?? accumulated };
          }
        } catch {
          // skip malformed SSE
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return accumulated
    ? { text: accumulated }
    : { error: "未收到响应" };
}

export function AiSkillGenerator({
  open,
  onClose,
  onGenerated,
}: AiSkillGeneratorProps) {
  const [prompt, setPrompt] = useState("");
  const [state, setState] = useState<GeneratorState>("idle");
  const [streamedText, setStreamedText] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [parsedSkill, setParsedSkill] = useState<SkillFormData | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    setState("idle");
    setStreamedText("");
    setErrorMsg("");
    setParsedSkill(null);
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  }, []);

  function handleClose() {
    reset();
    setPrompt("");
    onClose();
  }

  function handleStop() {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setStreamedText("");
    setState("idle");
  }

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim()) return;

    reset();
    setState("generating");

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const token = getToken();
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }

      const res = await fetch("/api/skills/generate", {
        method: "POST",
        headers,
        body: JSON.stringify({ prompt: prompt.trim() }),
        signal: controller.signal,
      });

      if (!res.ok) {
        setErrorMsg("生成请求失败，请重试。");
        setState("error");
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        setErrorMsg("没有响应流");
        setState("error");
        return;
      }

      const result = await consumeSseStream(reader, setStreamedText);

      if ("error" in result) {
        setErrorMsg(result.error);
        setState("error");
        return;
      }

      setStreamedText(result.text);
      const parsed = parseGeneratedSkill(result.text);
      if (parsed) {
        setParsedSkill(parsed);
        setState("done");
      } else {
        setErrorMsg(
          "无法解析生成的技能。请换一个更具体的描述后重试。",
        );
        setState("error");
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        setStreamedText("");
        setState("idle");
        return;
      }
      setErrorMsg("生成失败，请重试。");
      setState("error");
    }
  }, [prompt, reset]);

  function handleUseSkill() {
    if (parsedSkill) {
      onGenerated(parsedSkill);
      handleClose();
    }
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="AI 技能生成器"
      width="680px"
    >
      <div className="flex flex-col gap-5">
        {/* Prompt Input */}
        <div>
          <label
            className="block text-sm font-semibold text-muted uppercase tracking-wide mb-2"
            htmlFor="ai-prompt"
          >
            描述你想要的技能
          </label>
          <textarea
            id="ai-prompt"
            className="w-full px-4 py-3 bg-bg border border-border-2 rounded-lg text-foreground text-sm outline-none transition-colors duration-150 focus:border-accent placeholder:text-faint resize-y leading-relaxed min-h-[80px]"
            placeholder="例如：一个专注安全和性能的 PR 审查技能..."
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={state === "generating"}
          />
        </div>

        {/* Suggestion chips */}
        {state === "idle" && !prompt && (
          <div>
            <p className="text-xs text-faint mb-2">可以试试这些：</p>
            <div className="flex flex-wrap gap-2">
              {PROMPT_SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  className="text-xs px-3 py-1.5 bg-bg-2 border border-border rounded-full text-muted hover:text-strong hover:border-border-hover transition-colors cursor-pointer"
                  onClick={() => setPrompt(s)}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Streaming output */}
        {(state === "generating" || state === "done") && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              {state === "generating" && (
                <>
                  <span className="w-4 h-4 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
                  <span className="text-sm text-accent font-medium">
                    正在生成技能...
                  </span>
                </>
              )}
              {state === "done" && parsedSkill && (
                <>
                  <Check size={16} className="text-success" />
                  <span className="text-sm text-success font-medium">
                    技能已生成
                  </span>
                </>
              )}
            </div>

            {state === "done" && parsedSkill ? (
              <div className="bg-bg rounded-lg border border-border-2 p-4 space-y-3">
                <div>
                  <span className="text-xs font-semibold text-muted uppercase tracking-wide">
                    名称
                  </span>
                  <p className="text-sm text-strong mt-0.5">{parsedSkill.name}</p>
                </div>
                <div>
                  <span className="text-xs font-semibold text-muted uppercase tracking-wide">
                    描述
                  </span>
                  <p className="text-sm text-muted mt-0.5">
                    {parsedSkill.description}
                  </p>
                </div>
                <div>
                  <span className="text-xs font-semibold text-muted uppercase tracking-wide">
                    内容预览
                  </span>
                  <div className="mt-1 bg-bg-2 rounded-md p-3 text-xs font-mono text-foreground whitespace-pre-wrap leading-relaxed max-h-[200px] overflow-y-auto">
                    {parsedSkill.content}
                  </div>
                </div>
              </div>
            ) : (
              <div className="bg-bg rounded-lg border border-border-2 p-4 text-xs font-mono text-foreground/70 whitespace-pre-wrap leading-relaxed max-h-[250px] overflow-y-auto">
                {streamedText || "等待响应..."}
              </div>
            )}
          </div>
        )}

        {/* Error */}
        {state === "error" && (
          <div className="bg-danger-subtle border border-danger/20 rounded-lg px-4 py-3 text-danger text-sm">
            {errorMsg}
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-between items-center pt-2 border-t border-border">
          <div>
            {(state === "done" || state === "error") && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => reset()}
              >
                <Wand2 size={14} />
                重试
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={handleClose}>
              取消
            </Button>
            {state === "generating" && (
              <Button variant="danger" onClick={handleStop}>
                <StopCircle size={14} />
                停止
              </Button>
            )}
            {state === "idle" && (
              <Button
                onClick={handleGenerate}
                disabled={!prompt.trim()}
              >
                <Sparkles size={14} />
                生成
              </Button>
            )}
            {state === "done" && parsedSkill && (
              <Button onClick={handleUseSkill}>
                <Check size={14} />
                使用这个技能
              </Button>
            )}
            {state === "error" && (
              <Button
                onClick={handleGenerate}
                disabled={!prompt.trim()}
              >
                <Sparkles size={14} />
                重试
              </Button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
