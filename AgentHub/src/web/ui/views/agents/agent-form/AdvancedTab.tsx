import { Input } from "../../../components";
import { MCP_SERVERS } from "./constants";
import type { UseAgentFormReturn } from "./useAgentForm";

/** Advanced tab: sub-agents, MCP servers, hooks, Telegram. */
export function AdvancedTab({ form }: { form: UseAgentFormReturn }) {
  const { register } = form.form;

  return (
    <div className="flex flex-col gap-6">
      {/* Sub-Agents */}
      <div className="flex flex-col gap-2.5">
        <h4 className="font-heading text-xs font-semibold uppercase tracking-widest text-accent mb-1 pb-2 border-b border-border">
          子智能体
        </h4>
        <div className="grid grid-cols-3 gap-4 max-md:grid-cols-1">
          <div className="mb-5">
            <Input
              label="允许的智能体"
              type="text"
              placeholder="* 表示全部，或填写指定 ID"
              {...register("allowAgents")}
            />
          </div>
          <div className="mb-5">
            <Input
              label="最大子智能体数"
              type="number"
              min={1}
              max={20}
              {...register("maxChildren", { valueAsNumber: true })}
            />
          </div>
        </div>
      </div>

      {/* MCP Servers */}
      <div className="flex flex-col gap-2.5">
        <h4 className="font-heading text-xs font-semibold uppercase tracking-widest text-accent mb-1 pb-2 border-b border-border">
          MCP 服务器
        </h4>
        <div className="grid grid-cols-2 gap-4 max-md:grid-cols-1">
          {MCP_SERVERS.map(({ name, label }) => (
            <div key={name} className="flex items-center mb-5">
              <label className="flex items-center gap-2 cursor-pointer text-sm text-foreground">
                <input
                  type="checkbox"
                  className="w-4 h-4 accent-accent cursor-pointer"
                  {...register(name)}
                />
                <span className="select-none">{label}</span>
              </label>
            </div>
          ))}
        </div>
      </div>

      {/* Hooks */}
      <div className="flex flex-col gap-2.5">
        <h4 className="font-heading text-xs font-semibold uppercase tracking-widest text-accent mb-1 pb-2 border-b border-border">
          钩子
        </h4>
        <p className="text-sm text-faint m-0 mb-2.5 leading-[1.4]">
          钩子会在智能体执行期间用于审计和通知。默认开启所有钩子。
        </p>
        <div className="ml-1">
          <div className="flex items-center mb-5">
            <label className="flex items-center gap-2 cursor-pointer text-sm text-foreground">
              <input
                type="checkbox"
                className="w-4 h-4 accent-accent cursor-pointer"
                {...register("hookAuditLog")}
              />
              <span className="select-none">审计日志（工具调用写入数据库）</span>
            </label>
          </div>
          <div className="flex items-center mb-5">
            <label className="flex items-center gap-2 cursor-pointer text-sm text-foreground">
              <input
                type="checkbox"
                className="w-4 h-4 accent-accent cursor-pointer"
                {...register("hookNotifications")}
              />
              <span className="select-none">通知转发</span>
            </label>
          </div>
        </div>
      </div>

      {/* Telegram */}
      <div className="flex flex-col gap-2.5">
        <h4 className="font-heading text-xs font-semibold uppercase tracking-widest text-accent mb-1 pb-2 border-b border-border">
          Telegram
        </h4>
        <div className="mb-5">
          <Input
            label="机器人令牌"
            type="password"
            placeholder="留空则禁用专用机器人"
            autoComplete="off"
            {...register("telegramBotToken")}
          />
        </div>
      </div>
    </div>
  );
}
