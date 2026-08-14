# AgentCrawler / AgentHub

AgentCrawler 是一套面向社交平台巡逻、跨平台证据聚合和 Kan 推送的多智能体系统。前端应用名称为 AgentHub，仓库保留部分 `OPENCROW_*` 环境变量名用于兼容原始底层框架。

本仓库只提交应用代码、数据库迁移、前端页面和智能体调度逻辑。真实账号、Cookie、Token、爬虫运行数据、数据库目录和日志不能提交到 GitHub。

## 能做什么

- 管理 X、Telegram、LIHKG、Facebook、GitHub、Instagram、Lien、NetLight、PTT、YouTube 等平台智能体。
- 每个平台智能体调用对应爬虫工具，发现最近事件、复核同一事件并返回结构化证据。
- 中国相关性门槛只允许“中国相关 + 政治安全/国家安全/领土主权/外部干预/社会稳定/政治谣言/不当政治言论”等风险进入深挖。
- Social Fusion Agent 合并跨平台证据，判断是否同一事件、传播路径、核心节点和影响等级。
- 达到阈值后进入 Kan 推送队列；同一事件会做 URL、节点、标题实体和事件指纹去重，避免重复推送。
- 前端提供爬虫配置、模型配置、Kan 推送配置、社交融合运行状态和日志验收页面。

## 目录边界

推荐部署结构：

```text
/opt/agenthub/
  AgentCrawler/              # 本仓库
  Crawler/                   # 外部爬虫脚本目录，不建议直接提交到本仓库
  env/
    model_env/
      minimax_env            # MiniMax 模型密钥
    Crawler_env/
      X_env                  # 各平台爬虫配置
      Telegram_env
      SocialFusion_env       # 社交融合 Kan 总推送配置
  test/                      # 工具测试输出，生产可单独挂载或清理
```

如果目录不是这个结构，请用环境变量显式指定：

```bash
export AGENT_HUB_ROOT=/opt/agenthub
export CRAWLER_ROOT=/opt/agenthub/Crawler
export MODEL_ENV_ROOT=/opt/agenthub/env/model_env
export CRAWLER_ENV_ROOT=/opt/agenthub/env/Crawler_env
```

## 不要提交的内容

已在 `.gitignore` 中忽略：

- `.env`
- `env/`
- `Crawler/`
- `.runtime/`
- `.tmp/`
- `node_modules/`
- `data/`
- `logs/`
- `*.log`
- `*.cookie`
- `cookies.json`
- `token.json`
- `tokens.json`
- `session.json`
- `sessions/`

上传前建议检查：

```bash
git status --short
git ls-files | grep -Ei '(\.env|cookie|token|secret|session|\.runtime|Crawler_env|model_env)'
```

第二条命令不应该输出真实敏感配置文件。

## 环境要求

Linux 推荐：

- Ubuntu 22.04/24.04 或 Debian 12
- Bun 1.1+
- PostgreSQL 15+
- Python 3.10+
- Git
- 可选：Qdrant、Ollama、Playwright Chromium

Windows 开发环境：

- Bun for Windows
- PostgreSQL
- Python 3.10+
- PowerShell

## Linux 快速部署

### 1. 安装基础依赖

```bash
sudo apt update
sudo apt install -y git curl unzip python3 python3-venv python3-pip postgresql postgresql-contrib
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc
bun --version
```

### 2. 拉取仓库

```bash
sudo mkdir -p /opt/agenthub
sudo chown -R "$USER":"$USER" /opt/agenthub
cd /opt/agenthub
git clone https://github.com/panhoohui/AgentCrawler.git
cd AgentCrawler
```

### 3. 安装依赖

```bash
bun install
```

依赖会安装在当前项目的 `node_modules/`，不会写入 C 盘或系统目录。

### 4. 创建数据库

```bash
sudo -u postgres psql
```

在 PostgreSQL shell 中执行：

```sql
CREATE USER agenthub WITH PASSWORD '请替换为强密码';
CREATE DATABASE agenthub OWNER agenthub;
\q
```

### 5. 准备 `.env`

```bash
cp .env.example .env
nano .env
```

至少配置：

```env
DATABASE_URL=postgres://agenthub:请替换为强密码@127.0.0.1:5432/agenthub
OPENCROW_WEB_TOKEN=请替换为后台访问令牌
OPENCROW_INTERNAL_TOKEN=请替换为内部服务令牌
OPENCROW_WEB_HOST=0.0.0.0
OPENCROW_WEB_PORT=48086

AGENT_HUB_ROOT=/opt/agenthub
CRAWLER_ROOT=/opt/agenthub/Crawler
MODEL_ENV_ROOT=/opt/agenthub/env/model_env
CRAWLER_ENV_ROOT=/opt/agenthub/env/Crawler_env
AGENTHUB_CRAWLER_PROXY_PORT=59217
```

`OPENCROW_*` 是历史兼容变量名，生产环境仍需要配置。

### 6. 配置 MiniMax 模型

```bash
mkdir -p /opt/agenthub/env/model_env
nano /opt/agenthub/env/model_env/minimax_env
chmod 600 /opt/agenthub/env/model_env/minimax_env
```

示例：

```env
MINIMAX_INTL_API_KEY=请填入MiniMax密钥
MINIMAX_BASE_URL=https://api.minimax.io/anthropic
```

也可以只写一行密钥，系统会默认使用 `https://api.minimax.io/anthropic`。

### 7. 配置爬虫环境

每个平台一个环境文件，放在 `CRAWLER_ENV_ROOT`：

```bash
mkdir -p /opt/agenthub/env/Crawler_env
touch /opt/agenthub/env/Crawler_env/X_env
touch /opt/agenthub/env/Crawler_env/Telegram_env
touch /opt/agenthub/env/Crawler_env/YouTube_env
chmod 600 /opt/agenthub/env/Crawler_env/*_env
```

常见平台：

- `X_env`
- `Telegram_env`
- `Lihkg_env`
- `Facebook_env`
- `GitHub_env`
- `Instagram_env`
- `Lien_env`
- `NetLight_env`
- `PTT_env`
- `YouTube_env`
- `SocialFusion_env`

这些文件可以包含账号、Cookie、Session、代理、频道等配置，不能提交到 GitHub。

### 8. 配置 Kan 总推送

社交融合总推送建议写入：

```bash
nano /opt/agenthub/env/Crawler_env/SocialFusion_env
chmod 600 /opt/agenthub/env/Crawler_env/SocialFusion_env
```

示例：

```env
SOCIAL_FUSION_KAN_BASE_URL=https://kan.example.com
SOCIAL_FUSION_KAN_BOT_TOKEN=请填入机器人访问令牌
SOCIAL_FUSION_KAN_CHANNEL_IDS=频道ID1,频道ID2
SOCIAL_FUSION_KAN_SOURCE_LABELS=社交融合监控
```

各平台也可以在前端“Kan 推送配置”页面维护频道映射。

### 9. 准备外部爬虫目录

爬虫脚本默认读取：

```text
/opt/agenthub/Crawler
```

如果爬虫目录在其他位置：

```bash
export CRAWLER_ROOT=/data/crawlers
```

生产环境建议让爬虫目录和配置目录分离，避免把账号配置混入代码仓库。

### 10. 启动

开发或手动启动：

```bash
bun run start
```

单独启动前端 Web：

```bash
bun run start:web
```

默认前端地址：

```text
http://127.0.0.1:48086
```

如果部署在服务器上，请用反向代理暴露 `48086`，并设置 `OPENCROW_WEB_HOST=0.0.0.0`。

## systemd 示例

创建服务：

```bash
sudo nano /etc/systemd/system/agenthub-web.service
```

示例内容：

```ini
[Unit]
Description=AgentHub Web
After=network.target postgresql.service

[Service]
Type=simple
WorkingDirectory=/opt/agenthub/AgentCrawler
EnvironmentFile=/opt/agenthub/AgentCrawler/.env
ExecStart=/home/agenthub/.bun/bin/bun run start:web
Restart=always
RestartSec=5
User=agenthub
Group=agenthub

[Install]
WantedBy=multi-user.target
```

启用：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now agenthub-web
sudo systemctl status agenthub-web
```

如果同时需要核心进程，可另建 `agenthub-core.service`，`ExecStart` 使用：

```ini
ExecStart=/home/agenthub/.bun/bin/bun run start
```

## Windows 启动

在项目目录执行：

```powershell
cd F:\AgentHub\AgentHub
.\node_modules\.bin\bun.cmd install
copy .env.example .env
.\node_modules\.bin\bun.cmd run start:web
```

Windows 推荐目录：

```text
F:\AgentHub\
  AgentHub\
  Crawler\
  env\
    model_env\
    Crawler_env\
```

## 验证命令

```bash
bun run typecheck
bun test src/pipelines/social/pipeline.test.ts src/pipelines/social/dedupe.test.ts
bun test src/integrations/kan/config.isolated.test.ts
```

Windows：

```powershell
.\node_modules\.bin\bun.cmd run typecheck
.\node_modules\.bin\bun.cmd test src\pipelines\social\pipeline.test.ts src\pipelines\social\dedupe.test.ts
.\node_modules\.bin\bun.cmd test src\integrations\kan\config.isolated.test.ts
```

## 社交智能体流程

```text
平台智能体自主发现事件
  -> 候选事件池
  -> 中国政治安全门槛判断
      -> 不相关或风险不足：跳过 / 低优先级观察
      -> 通过：社交总控 Agent
          -> 通知其他平台复核同一事件
          -> 平台爬虫工具返回 URL / 频道 / 内容 / 指标
          -> 平台证据报告
          -> Social Fusion Agent
          -> 事件融合、传播路径、关系链
          -> Kan 推送阈值和重复过滤
              -> 通过且非重复：Kan 推送队列
              -> 重复或不足：持续监控
```

## 推送规则

Kan 推送必须满足：

- 至少两个平台发现同一事件。
- 事件属于中国政治安全、国家安全、领土主权、外部干预、社会稳定、政治谣言或不当政治言论风险。
- 影响等级、同一事件置信度或趋势达到阈值。
- 最近窗口内没有相同事件已推送或已过滤。

系统不会因为普通中国新闻、经济信息、娱乐话题、一般商业事件直接推送。

## 常见问题

### 1. 前端能打开，但智能体不能运行

检查：

```bash
cat .env
ls -la /opt/agenthub/env/model_env
ls -la /opt/agenthub/env/Crawler_env
```

确认 `DATABASE_URL`、`OPENCROW_WEB_TOKEN`、`MINIMAX_INTL_API_KEY` 已配置。

### 2. 爬虫无数据

检查：

- `CRAWLER_ROOT` 是否指向真实爬虫目录。
- 平台 env 文件是否存在。
- 代理端口是否正确，默认 `59217`。
- 爬虫账号、Cookie 或 Session 是否过期。

### 3. Kan 不推送

检查：

- `SocialFusion_env` 是否有 `SOCIAL_FUSION_KAN_BOT_TOKEN`。
- `SOCIAL_FUSION_KAN_CHANNEL_IDS` 是否正确。
- 事件是否真的达到政治安全风险门槛。
- 是否被重复事件过滤。

### 4. 不要把哪些内容上传

不要上传：

- `.env`
- `env/`
- `Crawler/` 中带账号配置的内容
- `.runtime/`
- `.tmp/`
- `test/`
- Cookie、Token、Session、数据库文件、日志

## 许可证与来源

本项目基于 OpenCrow 代码底座改造，当前应用和部署文档面向 AgentHub / AgentCrawler 场景维护。
