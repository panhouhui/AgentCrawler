# Telegram AI Tool

这是一个可迁移的 Telegram 爬虫工具目录。它不依赖当前主项目源码，复制到另一台电脑后，只要安装 Python 依赖并配置 `.env`，AI 就可以用 JSON 调用它。

## 推荐运行环境

- Python：`3.11.x`
- 已验证版本：`Python 3.11.4`
- 最低建议：`Python 3.10+`

依赖版本写在 `requirements.txt`：

```text
Telethon==1.41.1
PySocks==1.7.1
pyaes==1.6.1
rsa==4.9.1
```

说明：

- `Telethon`：Telegram 客户端库。
- `PySocks`：使用 `socks5://` 或 `socks4://` 代理时需要。
- `pyaes`、`rsa`：Telethon 当前环境里的依赖，建议一起固定，避免迁移机器版本漂移。

## 新电脑部署

进入工具目录：

```powershell
cd C:\path\to\telegram_ai_tool
```

创建虚拟环境：

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\activate
```

安装依赖：

```powershell
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
```

复制环境变量模板：

```powershell
copy .env.example .env
```

编辑 `.env`：

```text
TELEGRAM_API_ID=你的 api_id
TELEGRAM_API_HASH=你的 api_hash
TELEGRAM_SESSION=你的 StringSession
TELEGRAM_PROXY=socks5://127.0.0.1:7898

MATTERMOST_URL=https://kan.cool
MATTERMOST_TOKEN=你的 Mattermost bot token
MATTERMOST_CHANNEL_IDS=b5zush8777dkfx6cu8r69w6uiw,eybnxu9emjr63mukqpccpu4sjr,romr77ojopnw3p5gkiqcxyx59r,rajjhpqmhidabc3ohffbbjbzyw
TELEGRAM_PUSH_DIALOGS=1364377229,2686642044,1481904333
TELEGRAM_MATTERMOST_CHANNEL_MAP=
```

如果新电脑直连 Telegram，不需要代理：

```text
TELEGRAM_PROXY=
```

## 命令行使用

列出当前账号加入的群/频道：

```powershell
python telegram_ai_tool.py list_dialogs
```

抓取指定群最近 7 天消息：

```powershell
python telegram_ai_tool.py crawl_dialogs --dialogs 1364377229,2686642044 --days 7 --max-results 30
```

检查 Mattermost 频道是否可访问：

```powershell
python telegram_ai_tool.py mattermost_test_channels
```

向 `.env` 中配置的 Mattermost 频道发送消息：

```powershell
python telegram_ai_tool.py mattermost_send_message --message "测试消息"
```

只向指定 Mattermost 频道发送消息：

```powershell
python telegram_ai_tool.py mattermost_send_message --channels b5zush8777dkfx6cu8r69w6uiw --message "测试消息"
```

把 Telegram 新消息按群分开推送到 Mattermost：

```powershell
python telegram_ai_tool.py push_telegram_updates --batch-size 25
```

持续监听，每 60 秒检查一次：

```powershell
python telegram_ai_tool.py push_telegram_updates --batch-size 25 --interval 60
```

从当前最新消息开始监听，不推已经积压的消息：

```powershell
python telegram_ai_tool.py push_telegram_updates --reset-baseline
```

预览推送内容但不发送：

```powershell
python telegram_ai_tool.py push_telegram_updates --dry-run
```

说明：

- 每个 Telegram 群会单独生成一条“聊天记录式”Mattermost 消息，不同群不会混在一起。
- 默认只推送 `TELEGRAM_PUSH_DIALOGS` 中配置的 Telegram 群。
- 每个群今天的新消息各自累计，默认满 25 条才推送；没满 25 条会继续等待下一轮。
- 如果某个群累计 55 条，会先推 2 批，每批 25 条，剩余 5 条留到下次继续累计。
- 默认第一次运行只记录各群最新消息位置，不推历史消息，避免刷屏。
- 推送正文会默认脱敏手机号、身份证号、邮箱和长数字串。
- 已推送位置保存在 `telegram_push_state.json`。
- 如需把不同 Telegram 群推到不同 Mattermost 频道，可配置：

```text
TELEGRAM_MATTERMOST_CHANNEL_MAP=1364377229:b5zush8777dkfx6cu8r69w6uiw,2686642044:eybnxu9emjr63mukqpccpu4sjr
```

`--dialogs` 支持：

- 群/频道 ID：`1364377229`
- 用户名：`channel_name`
- 带 @ 用户名：`@channel_name`

## AI JSON 调用方式

列群：

```powershell
'{"action":"list_dialogs"}' | python telegram_ai_tool.py --stdin
```

抓消息：

```powershell
'{"action":"crawl_dialogs","dialogs":["1364377229"],"days":7,"max_results":30}' | python telegram_ai_tool.py --stdin
```

检查 Mattermost 频道：

```powershell
'{"action":"mattermost_test_channels"}' | python telegram_ai_tool.py --stdin
```

发送 Mattermost 消息：

```powershell
'{"action":"mattermost_send_message","message":"测试消息"}' | python telegram_ai_tool.py --stdin
```

推送 Telegram 新消息到 Mattermost：

```powershell
'{"action":"push_telegram_updates","dialogs":["1364377229","2686642044"],"dry_run":true}' | python telegram_ai_tool.py --stdin
```

返回固定 JSON，例如：

```json
{
  "ok": true,
  "action": "crawl_dialogs",
  "days": 7,
  "message_count": 10,
  "group_count": 1,
  "groups": [
    {
      "dialog_id": "1364377229",
      "dialog_title": "group name",
      "dialog_username": "",
      "count": 10,
      "messages": []
    }
  ]
}
```

## 推荐给 AI 的工具定义

```json
{
  "name": "telegram_crawl_dialogs",
  "description": "抓取指定 Telegram 群/频道最近 N 天聊天记录，按群返回结构化消息。",
  "parameters": {
    "type": "object",
    "properties": {
      "dialogs": {
        "type": "array",
        "items": { "type": "string" },
        "description": "Telegram 群/频道 id、用户名或 @用户名"
      },
      "days": {
        "type": "integer",
        "description": "抓取最近多少天，默认 1"
      },
      "max_results": {
        "type": "integer",
        "description": "扫描上限基准，默认 30；工具内部会按天数放大每群扫描量"
      }
    },
    "required": ["dialogs"]
  }
}
```

## 注意事项

- `.env` 里包含 Telegram 登录会话，不要提交到公开仓库。
- 新电脑需要能访问 Telegram；不能直连时配置 `TELEGRAM_PROXY`。
- 这个工具只负责读取群/频道消息并输出 JSON，不负责入库、不调用主项目后端。
