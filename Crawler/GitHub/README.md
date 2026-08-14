# GitHub 事件发现与复核采集器

使用 GitHub REST API 和 Personal Access Token（PAT）采集公开或令牌有权访问的数据。AgentHub 自主发现使用 `--discover-latest`，不会读取旧的默认词表文件。

支持以下搜索类型：

- `repositories`：仓库
- `code`：代码
- `issues`：Issue 和 Pull Request
- `users`：用户

## 1. 配置 PAT

复制 `.env.example` 为 `.env`，将令牌填入：

```powershell
Copy-Item .env.example .env
notepad .env
```

也可以只在当前 PowerShell 会话中设置：

```powershell
$env:GITHUB_TOKEN = "你的_PAT"
```

不要把 PAT 写入 Python 文件，也不要提交 `.env`。GitHub 推荐优先使用 fine-grained PAT，并只授予采集所需的最小读取权限。

## 2. 验证 PAT

```powershell
python .\github_crawler.py --check-token
```

## 3. 采集数据

尽可能多地采集仓库：

```powershell
python .\github_crawler.py --event-query "python crawler"
```

仓库搜索默认启用大批量模式。以下写法含义相同，可以显式写出 `--exhaustive`：

```powershell
python .\github_crawler.py `
  --event-query "python crawler" `
  --type repositories `
  --exhaustive `
  --output .\output\python-crawler-all.jsonl
```

`--exhaustive` 会从 `2008-01-01` 到今天按仓库创建日期自动拆分查询，并根据仓库 ID 去重。此模式不受 `--max-results` 控制，但仍受 GitHub API 速率限制，匹配数量较大时需要耐心等待。

快速试跑前 100 条仓库数据：

```powershell
python .\github_crawler.py `
  --event-query "python crawler" `
  --no-exhaustive `
  --max-results 100
```

也可以限制时间范围：

```powershell
python .\github_crawler.py `
  --event-query "python crawler" `
  --type repositories `
  --exhaustive `
  --start-date 2025-01-01 `
  --end-date 2025-12-31 `
  --output .\output\python-crawler-2025.jsonl
```

同时采集仓库和代码，并输出 CSV：

```powershell
python .\github_crawler.py `
  --event-query "web scraper" `
  --type repositories `
  --type code `
  --max-results 300 `
  --format csv `
  --output .\output\scraper.csv
```

传入多个事件复核表达式：

```powershell
python .\github_crawler.py `
  --event-query "language:python stars:>1000 crawler" `
  --event-query "language:go scraper" `
  --type repositories `
  --output .\output\repositories.jsonl
```

`--event-query` 在 AgentHub 中只用于候选事件复核；它仍接受 GitHub 搜索语法，因此可以组合 `language:`、`stars:`、`user:`、`org:`、`repo:` 等限定符。

自主发现最近活跃公开仓库：

```powershell
python .\github_crawler.py `
  --discover-latest `
  --type repositories `
  --output .\output\repositories.jsonl
```

候选事件复核只接受 `--event-query`。旧的关键词文件/事件列表文件入口已经移除，AgentHub 自主发现不会读取任何静态词表。

## 港澳台监控与 MiniMax 分析

监控模式需要显式传入候选事件复核表达式；它不读取旧的默认词表文件。命中后调用 MiniMax M2.7 分析是否存在反华倾向，并按日期追加保存到 `output/YYYY/MM/DD/region-alerts.jsonl`。程序会用 `output/seen-records.txt` 记录已经处理过的结果，重复运行时只处理新的内容。

先在 `.env` 中配置：

```text
GITHUB_TOKEN=你的_GitHub_PAT
MINIMAX_API_KEY=你的_MiniMax_API_Key
MINIMAX_INTL_API_KEY=你的_国际版_MiniMax_API_Key
MINIMAX_API_URL=https://api.minimax.io/v1
MINIMAX_MODEL=MiniMax-M2.7
MATTERMOST_SERVER_URL=https://你的_Mattermost_地址
MATTERMOST_BOT_TOKEN=你的_机器人账号令牌
MATTERMOST_CHANNEL_ID=要推送到的频道ID
```

`MINIMAX_API_KEY` 可保留普通版密钥；当 `MINIMAX_API_URL` 使用国际版 `https://api.minimax.io/v1` 时，程序会优先读取 `MINIMAX_INTL_API_KEY`。
国际版 MiniMax 默认不读取系统代理环境变量，避免本机代理中断 POST 请求；如果确实需要让 MiniMax 请求走系统代理，可以设置 `MINIMAX_TRUST_ENV=true`。

截图里机器人账号页面显示的“令牌”填到 `MATTERMOST_BOT_TOKEN`。还需要把机器人加入目标团队和频道，并填写目标频道的 channel id。`PUSH_WEBHOOK_URL` 仍然可选，适合传入 Webhook；Mattermost 机器人推送不需要配置它。

运行：

```powershell
python .\github_crawler.py `
  --monitor-regions `
  --type repositories `
  --type issues `
  --max-results 50
```

常驻实时监听：

```powershell
python .\github_crawler.py `
  --monitor-regions `
  --watch `
  --watch-interval 300 `
  --type repositories `
  --type issues `
  --max-results 1 `
  --per-page 1 `
  --query-batch-size 20 `
  --state-file .\output\seen-records.txt
```

`--watch-interval` 是每轮间隔秒数，`--query-batch-size` 是每轮处理的扩展查询数量。GitHub Search API 有限流，建议保持分批轮询。

默认会保存所有新增命中结果，但只推送 MiniMax 判断 `anti_china_tendency` 为 `yes` 的结果；`no`、`unclear` 和分析失败的结果不会推送。程序会用 `output/pushed-records.txt` 记录已推送结果，避免 Mattermost 收到重复消息。未配置 Mattermost 或 Webhook 推送参数时不会推送，只保存本地文件。可以用 `--region hong_kong`、`--region macau`、`--region taiwan` 限定监控地区。

如果 MiniMax 返回 `422 output new_sensitive` 或错误信息中包含 `output new_sensitive`，程序会把该结果保存为 `anti_china_tendency=yes`，推送理由固定为“敏感内容过滤了，但信息和指定的事件复核条件相关。”，并按正常 `yes` 结果直接推送。

对疑似游戏项目，程序会额外读取仓库中的剧情、对白、任务、角色、本地化、语言包、文档等文本文件片段，再交给 MiniMax 判断，便于发现隐藏在游戏叙事和任务文本里的倾向。推送格式仍然保持五行：事件复核条件、地区、理由、标题、链接。

## 输出格式

默认输出 `output/results.jsonl`。仓库搜索只保存仓库页面右侧“关于”区域中的简介，不读取 README。简介中嵌入的 HTML 标签和不可显示字符会被移除，连续空白会被合并。为了避免仓库作者在简介字段中塞入异常长文本，默认最多保留 500 个字符，并优先截取事件复核表达式附近的上下文。每行只包含事件复核表达式、仓库 URL 和仓库简介：

```json
{"event_query":"python crawler","repository_url":"https://github.com/example/repository","content":"仓库页面右侧“关于”区域中的简介"}
```

CSV 包含相同的三个字段：`event_query`、`repository_url`、`content`。

GitHub 可能因为 README 等未输出字段中出现事件复核表达式而返回仓库。程序默认保留 GitHub 返回的全部结果，避免误删语义相关仓库。确认某些仓库无关时，可以使用 `--exclude-url` 精确排除。也可以添加 `--strict-event-match`，仅保留仓库名称、URL 或简介中直接包含完整事件复核表达式的结果，但该模式可能误删语义相关结果。

```powershell
python .\github_crawler.py `
  --event-query "python crawler" `
  --exclude-url "https://github.com/example/unrelated" `
  --output .\output\repositories.jsonl
```

调整简介最大长度，或使用 `0` 关闭截断：

```powershell
python .\github_crawler.py `
  --event-query "python crawler" `
  --content-max-length 300 `
  --output .\output\repositories.jsonl
```

清洗旧版脚本已经生成的 JSONL 文件：

```powershell
python .\github_crawler.py --clean-file .\output\event-query-result.jsonl
```

## GitHub API 限制

- GitHub Search API 对每条查询最多只提供前 1,000 条结果。
- PAT 的通用 REST API 额度通常为每小时 5,000 次，但搜索接口有更严格的独立限制。
- 程序遇到 GitHub 返回的限速响应时，会根据响应头等待后重试。
- `--exhaustive` 会自动按创建日期拆分仓库查询。极端情况下，如果某一天仍匹配超过 1,000 条，GitHub API 本身仍无法提供当天的全部结果，程序会显示警告。

## 参数帮助

```powershell
python .\github_crawler.py --help
```
