# AgentHub 启动说明

本文档说明 AgentHub 的用途、项目目录、运行环境和基础启动方式，适合在 Windows 或 Linux 服务器上部署时参考。

## 1. 项目用途

AgentHub 是一个多平台社交信息智能体系统，核心能力包括：

- 平台智能体自主巡检 X、Telegram、LIHKG、Facebook、GitHub、Instagram、Lien、NetLight、PTT、YouTube 等平台。
- 对候选事件进行中国相关性、政治安全风险和不当言论风险判断。
- 调度其他平台智能体复核同一事件是否也在传播。
- 收集 URL、频道、帖子、评论、发布时间、内容摘要和传播指标等结构化证据。
- 由 Social Fusion Agent 融合跨平台证据，输出传播路径、关系链、影响等级和趋势。
- 对同一事件做去重，达到阈值后进入 Kan 推送队列。
- 通过前端查看爬虫配置、智能体运行状态、平台证据、融合结果和 Kan 推送配置。

## 2. 项目目录

```text
AgentHub/
  AgentHub/                 # 控制台、智能体调度、前端页面、后端 API、数据库迁移和系统文档
  Crawler/                  # 各平台爬虫工具与 AgentHub 工具适配代码
  README.md                 # 项目总说明
  AgentHub启动说明.md        # 启动和部署说明
```

应用目录结构：

```text
AgentHub/AgentHub/
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

爬虫目录结构：

```text
AgentHub/Crawler/
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

## 3. 运行环境

基础组件：

- Bun：运行 TypeScript 服务和前端构建。
- Python：运行各平台爬虫工具。
- PostgreSQL：保存配置、运行记录、智能体状态、证据和 Kan 队列。
- Qdrant：用于向量记忆检索。
- MiniMax：通过 Anthropic-compatible API 调用模型。
- 混合代理：爬虫网络访问可按部署环境配置代理端口。

常用配置来源：

```text
AgentHub/AgentHub/.runtime/agenthub.env
AgentHub/env/model_env/
AgentHub/env/Crawler_env/
```

部分环境变量名称沿用历史运行框架，例如 `OPENCROW_WEB_PORT`、`OPENCROW_WEB_TOKEN`、`OPENCROW_INTERNAL_TOKEN`。这些变量名是运行兼容层的一部分，前端和项目文案仍统一显示为 AgentHub。

## 4. 安装依赖

进入应用目录：

```bash
cd AgentHub/AgentHub
```

安装依赖：

```bash
bun install
```

构建前端样式：

```bash
bun run tw:build
```

类型检查：

```bash
bun run typecheck
```

## 5. 启动服务

启动主服务：

```bash
bun run start
```

主服务会启动 AgentHub 的核心运行流程。需要单独调试前端/API 时，可以启动 Web 入口：

```bash
bun run start:web
```

默认访问地址：

```text
http://127.0.0.1:48086
```

内部健康检查地址：

```text
http://127.0.0.1:48085/internal/health
```

## 6. Linux 部署参考

克隆项目后进入应用目录：

```bash
cd AgentHub/AgentHub
bun install
bun run tw:build
bun run typecheck
```

准备运行环境：

```bash
export OPENCROW_WEB_HOST=0.0.0.0
export OPENCROW_WEB_PORT=48086
export OPENCROW_INTERNAL_API_PORT=48085
export AGENT_HUB_ROOT="$(cd .. && pwd)"
export CRAWLER_ROOT="$(cd ../Crawler && pwd)"
```

启动：

```bash
bun run start
```

如需长期运行，可使用 systemd、supervisor、pm2 或容器编排工具托管 `bun run start`。

## 7. 基础验收

启动后建议检查：

- 前端能打开并显示 AgentHub 总览。
- 爬虫配置页面能看到各平台配置状态。
- 智能体运行页能启动、停止并保持运行状态。
- 平台证据列表能展示 URL、频道、正文摘要和传播指标。
- Social Fusion Agent 能生成融合事件、传播路径、影响等级和趋势。
- Kan 推送配置能读取总体配置和平台路由。
