import React from "react";
import { Play, Bot, Wrench, Zap, GitBranch, ArrowLeftRight, Square } from "lucide-react";
import type { WorkflowNodeData, WorkflowNodeType } from "./types";
import type { WorkflowAction } from "./useWorkflowReducer";
import type { Node } from "@xyflow/react";

interface PaletteItem {
  readonly type: WorkflowNodeType;
  readonly label: string;
  readonly description: string;
  readonly icon: React.ReactNode;
  readonly color: string;
  readonly defaultData: WorkflowNodeData;
}

const PALETTE_ITEMS: readonly PaletteItem[] = [
  {
    type: "trigger",
    label: "触发器",
    description: "启动工作流",
    icon: <Play size={14} />,
    color: "text-teal-500 bg-teal-500/10 border-teal-500/20",
    defaultData: {
      nodeType: "trigger",
      label: "触发器",
      triggerType: "manual",
    },
  },
  {
    type: "agent",
    label: "智能体",
    description: "运行 AI 智能体",
    icon: <Bot size={14} />,
    color: "text-purple-500 bg-purple-500/10 border-purple-500/20",
    defaultData: {
      nodeType: "agent",
      label: "智能体",
      agentId: "",
      agentName: "",
    },
  },
  {
    type: "tool",
    label: "工具",
    description: "执行工具",
    icon: <Wrench size={14} />,
    color: "text-blue-500 bg-blue-500/10 border-blue-500/20",
    defaultData: {
      nodeType: "tool",
      label: "工具",
      toolName: "",
    },
  },
  {
    type: "skill",
    label: "技能",
    description: "应用技能",
    icon: <Zap size={14} />,
    color: "text-green-500 bg-green-500/10 border-green-500/20",
    defaultData: {
      nodeType: "skill",
      label: "技能",
      skillId: "",
      skillName: "",
    },
  },
  {
    type: "condition",
    label: "条件",
    description: "按表达式分支",
    icon: <GitBranch size={14} />,
    color: "text-yellow-500 bg-yellow-500/10 border-yellow-500/20",
    defaultData: {
      nodeType: "condition",
      label: "条件",
      expression: "",
    },
  },
  {
    type: "transform",
    label: "转换",
    description: "映射或重组数据",
    icon: <ArrowLeftRight size={14} />,
    color: "text-orange-500 bg-orange-500/10 border-orange-500/20",
    defaultData: {
      nodeType: "transform",
      label: "转换",
      template: "",
    },
  },
  {
    type: "output",
    label: "输出",
    description: "返回或发送结果",
    icon: <Square size={14} />,
    color: "text-rose-500 bg-rose-500/10 border-rose-500/20",
    defaultData: {
      nodeType: "output",
      label: "输出",
      action: "return",
    },
  },
];

// Cascading offset so repeated keyboard-adds don't stack on top of each other
let addCounter = 0;

function generateId(): string {
  return `node-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createWorkflowNode(item: PaletteItem): Node<WorkflowNodeData> {
  const offset = (addCounter % 6) * 30;
  addCounter += 1;
  return {
    id: generateId(),
    type: item.type,
    position: { x: 200 + offset, y: 150 + offset },
    data: item.defaultData,
  };
}

interface NodePaletteProps {
  readonly dispatch: React.Dispatch<WorkflowAction>;
}

export function NodePalette({ dispatch }: NodePaletteProps) {
  function handleDragStart(
    e: React.DragEvent,
    item: PaletteItem,
  ) {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData(
      "application/workflow-node",
      JSON.stringify({ type: item.type, data: item.defaultData }),
    );
  }

  function handleAddNode(item: PaletteItem) {
    const node = createWorkflowNode(item);
    dispatch({ type: "ADD_NODE", node });
    dispatch({ type: "SELECT_NODE", id: node.id });
  }

  return (
    <aside className="w-56 shrink-0 bg-bg-1 border-r border-border flex flex-col overflow-y-auto">
      <div className="px-4 py-3 border-b border-border">
        <h3 className="text-xs font-semibold text-muted uppercase tracking-wider m-0">
          节点
        </h3>
      </div>
      <div className="p-3 flex flex-col gap-2">
        {PALETTE_ITEMS.map((item) => (
          <button
            key={item.type}
            type="button"
            aria-label={`添加${item.label}节点`}
            draggable
            onDragStart={(e) => handleDragStart(e, item)}
            onClick={() => handleAddNode(item)}
            className="w-full text-left bg-transparent appearance-none flex items-center gap-3 px-3 py-2.5 rounded-lg border border-border cursor-grab active:cursor-grabbing bg-bg hover:bg-bg-2 hover:border-border-hover transition-colors select-none"
          >
            <span
              className={`w-7 h-7 rounded-md border flex items-center justify-center shrink-0 ${item.color}`}
            >
              {item.icon}
            </span>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-strong leading-tight">
                {item.label}
              </div>
              <div className="text-[11px] text-muted leading-tight mt-0.5 truncate">
                {item.description}
              </div>
            </div>
          </button>
        ))}
      </div>
    </aside>
  );
}
