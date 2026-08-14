import { Controller } from "react-hook-form";
import { Input } from "../../../components";
import { SELECT_CLS } from "./constants";
import type { UseAgentFormReturn } from "./useAgentForm";
import {
  ANTHROPIC_MODELS,
  AGENT_SDK_MODELS,
  ALIBABA_MODEL_GROUPS,
  MINIMAX_MODELS,
  OPENCODE_MODELS,
} from "../../../lib/model-lists";

/** Model tab: provider/model config, thinking & effort controls, system prompt. */
export function ModelTab({ form }: { form: UseAgentFormReturn }) {
  const { provider, thinkingMode, isOpus } = form;
  const { register, control } = form.form;

  return (
    <>
      {/* Section: Model */}
      <fieldset className="border-none p-0 m-0">
        <legend className="font-heading text-xs font-semibold uppercase tracking-widest text-accent mb-4 pb-2 border-b border-border w-full flex items-center justify-between">
          模型配置
        </legend>
        <div className="grid grid-cols-2 gap-4 max-md:grid-cols-1">
          <div className="mb-5">
            <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-2">
              服务商
            </label>
            <Controller
              control={control}
              name="provider"
              render={({ field }) => (
                <select className={SELECT_CLS} {...field}>
                  <option value="agent-sdk">Agent SDK</option>
                  <option value="anthropic">Anthropic（OAuth）</option>
                  <option value="openrouter">OpenRouter</option>
                  <option value="alibaba">阿里云 ModelStudio</option>
                  <option value="minimax">MiniMax</option>
                  <option value="opencode">OpenCode Zen</option>
                </select>
              )}
            />
          </div>
          <div className="mb-5">
            <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-2">
              模型
            </label>
            {provider === "agent-sdk" ? (
              <select className={SELECT_CLS} {...register("model")}>
                {AGENT_SDK_MODELS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            ) : provider === "anthropic" ? (
              <select className={SELECT_CLS} {...register("model")}>
                {ANTHROPIC_MODELS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            ) : provider === "alibaba" ? (
              <select className={SELECT_CLS} {...register("model")}>
                {ALIBABA_MODEL_GROUPS.map((group) => (
                  <optgroup key={group.label} label={group.label}>
                    {group.models.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            ) : provider === "opencode" ? (
              <select className={SELECT_CLS} {...register("model")}>
                {OPENCODE_MODELS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            ) : provider === "minimax" ? (
              <select className={SELECT_CLS} {...register("model")}>
                {MINIMAX_MODELS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            ) : (
              <Input
                type="text"
                placeholder="例如：stepfun/step-3.5-flash:free"
                {...register("model")}
              />
            )}
          </div>
          <div className="mb-5">
            <Input
              label="最大迭代次数"
              type="number"
              min={1}
              max={500}
              {...register("maxIterations", { valueAsNumber: true })}
            />
          </div>
          <div className="mb-5">
            <Input
              label="最大输入长度（0 表示不限）"
              type="number"
              min={0}
              placeholder="0"
              {...register("maxInputLength", { valueAsNumber: true })}
            />
          </div>
          {/* -- Agent SDK-specific: Thinking & Effort Controls -- */}
          {provider === "agent-sdk" && (
            <>
              <div className="flex items-center mb-5">
                <label className="flex items-center gap-2 cursor-pointer text-sm text-foreground">
                  <input
                    type="checkbox"
                    className="w-4 h-4 accent-accent cursor-pointer"
                    {...register("reasoning")}
                  />
                  <span className="select-none">扩展思考</span>
                </label>
              </div>
              <div className="mb-5">
                <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-2">
                  思考模式
                </label>
                <Controller
                  control={control}
                  name="thinkingMode"
                  render={({ field }) => (
                    <select className={SELECT_CLS} {...field}>
                      <option value="adaptive">自适应（由模型决定）</option>
                      <option value="enabled">固定预算</option>
                      <option value="disabled">禁用</option>
                    </select>
                  )}
                />
              </div>
              {thinkingMode === "enabled" && (
                <div className="mb-5">
                  <Input
                    label="思考预算（tokens）"
                    type="number"
                    min={1024}
                    max={128000}
                    step={1024}
                    {...register("thinkingBudget", { valueAsNumber: true })}
                  />
                </div>
              )}
              <div className="mb-5">
                <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-2">
                  推理强度
                </label>
                <Controller
                  control={control}
                  name="effort"
                  render={({ field }) => (
                    <select className={SELECT_CLS} {...field}>
                      <option value="low">低（快速，少量思考）</option>
                      <option value="medium">中</option>
                      <option value="high">高（深度推理）</option>
                      <option value="max" disabled={!isOpus}>
                        最大（仅 Opus）
                      </option>
                    </select>
                  )}
                />
              </div>
              <div className="flex items-center mb-5">
                <label className="flex items-center gap-2 cursor-pointer text-sm text-foreground">
                  <input
                    type="checkbox"
                    className="w-4 h-4 accent-accent cursor-pointer"
                    {...register("extendedContext")}
                  />
                  <span className="select-none">1M 上下文窗口（测试版）</span>
                </label>
              </div>
            </>
          )}
          <div className="flex items-center mb-5">
            <label className="flex items-center gap-2 cursor-pointer text-sm text-foreground">
              <input
                type="checkbox"
                className="w-4 h-4 accent-accent cursor-pointer"
                {...register("stateless")}
              />
              <span className="select-none">无状态</span>
            </label>
          </div>
        </div>
      </fieldset>

      {/* Section: System Prompt */}
      <fieldset className="border-none p-0 m-0">
        <legend className="font-heading text-xs font-semibold uppercase tracking-widest text-accent mb-4 pb-2 border-b border-border w-full flex items-center justify-between">
          系统提示词
        </legend>
        <textarea
          rows={6}
          className="w-full px-4 py-3 bg-bg border border-border rounded-lg text-foreground font-mono text-sm leading-relaxed outline-none transition-colors duration-150 resize-y min-h-[120px] focus:border-accent"
          placeholder="留空则使用全局默认值"
          {...register("systemPrompt")}
        />
      </fieldset>
    </>
  );
}
