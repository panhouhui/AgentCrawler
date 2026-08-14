# AgentHub

AgentHub 是一个多平台社交信息智能体系统，把各平台爬虫工具接入智能体调度流程，用于自主发现事件、复核跨平台证据、判断传播路径，并在达到阈值后进入统一的 Kan 推送队列。

## 项目能做什么

- 让 X、Telegram、LIHKG、Facebook、GitHub、Instagram、Lien、NetLight、PTT、YouTube 等平台智能体自主巡检公开信息。
- 对候选事件进行中国相关性、政治安全风险和不当言论风险判断。
- 通知其他平台智能体复核同一事件是否也在传播。
- 结构化整理 URL、频道、帖子、评论、发布时间、内容摘要和传播指标。
- 由 Social Fusion Agent 融合同一事件的跨平台证据，输出关系链、传播路径、核心节点、影响等级和趋势。
- 对相同事件做去重，减少重复进入推送队列。
- 在 AgentHub 前端查看爬虫配置、智能体运行状态、平台证据、融合结果和 Kan 推送配置。

## 项目目录

```text
AgentHub/
  AgentHub/                 # 控制台、智能体调度、前端页面、后端 API、数据库迁移和系统文档
  Crawler/                  # 各平台爬虫工具与 AgentHub 工具适配代码
  README.md                 # 项目总说明
```

## AgentHub 应用目录

```text
AgentHub/
  src/
    agent/                  # 模型调用、会话和智能体执行
    agents/                 # 智能体定义、注册和运行器
    config/                 # 配置加载、项目根目录识别、模型环境读取
    integrations/
      crawlers/             # 爬虫平台配置读取和配置接口
      kan/                  # Kan 推送路由、频道配置和投递客户端
    pipelines/
      social/               # 社交监控流程、风险判断、融合、去重和队列
    store/                  # 数据访问、迁移和运行状态
    tools/                  # 智能体工具，包括爬虫工具封装
    web/                    # API 路由和 React 前端
  scripts/                  # 验证、预览和辅助脚本
  docs/                     # 设计说明和扩展文档
```

## Crawler 目录

```text
Crawler/
  X/
  Telegram/
  Lihkg/
  Facebook/
  GitHub/
  instagram/
  Lien/
  NetLight/
  PTT/
  YouTube/
  kan_push_bridge.py
```

## 基础启动

进入 AgentHub 应用目录：

```bash
cd AgentHub
```

安装依赖：

```bash
bun install
```

类型检查：

```bash
bun run typecheck
```

启动核心服务：

```bash
bun run start
```

启动前端服务：

```bash
bun run start:web
```

默认前端地址：

```text
http://127.0.0.1:48086
```

## 技术栈

- Bun
- TypeScript
- Hono
- React
- PostgreSQL
- Python 爬虫工具
- MiniMax / Anthropic-compatible API
- 多智能体调度
