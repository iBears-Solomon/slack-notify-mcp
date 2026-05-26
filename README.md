# slack-notify-mcp

最小化的 stdio MCP server,讓 Claude Code(或任何 MCP client)用 Slack bot token 發訊息。

- **零 npm 依賴** — 純 Node stdlib(`readline` + `https`)
- **單一工具** — `send_message(channel_id, text, thread_ts?)`
- **單一 scope** — 只需要 bot 的 `chat:write`(視需求可加 `chat:write.public`)
- **不在啟動時 cache user list** — 避開 [korotovsky/slack-mcp-server](https://github.com/korotovsky/slack-mcp-server) 強制要 `users:read` 才能啟動的設計

> 適合的場景:你只是想讓 AI agent **以 bot 身分發通知**到頻道,並期望自己的 Slack 客戶端跳 unread + push notification(自己用 user-token 發訊息給自己不會通知)。

## ⚠️ 重要:這是 write-only MCP,需搭配另一個能讀 Slack 的 MCP

`slack-notify` **只能發訊息**,不能列頻道 / 搜訊息 / 查 user — 它連「頻道存在」這件事都不知道。這是刻意的最小權限設計。

實際工作流:

```
你: 「發 hello 到 #solomon-test」
  │
  ├─→ Claude 用「讀取用 MCP」呼叫 slack_search_channels("solomon-test")
  │   ← 拿到 channel_id = C07XXXX
  │
  └─→ Claude 用 slack-notify 呼叫 send_message(channel_id=C07XXXX, text="hello")
      ← Sent.
```

**所以使用前你必須先有一個能讀 Slack 的 MCP**,推薦其一:

| 方案 | 來源 | 適合 |
| --- | --- | --- |
| **claude.ai 內建 Slack connector**(最簡單) | claude.ai → Connectors → Slack OAuth | 一般 user,在 Claude Code / Desktop / web 都通 |
| [korotovsky/slack-mcp-server](https://github.com/korotovsky/slack-mcp-server) | 自架 stdio MCP | 進階,想全部 self-host;支援 xoxp/xoxc/xoxd 多種 token 模式 |

> 💡 如果完全沒有讀取 MCP,也可以手動取得 channel ID:Slack 桌面版右鍵 channel → **Copy link**,URL 結尾 `/archives/CXXXXXXX` 即是 ID。但每次都這樣很煩,所以還是建議搭配讀取 MCP。

## 為什麼自己寫一個

主流 Slack MCP server 多半把工具集打包得很完整(讀頻道、搜尋訊息、列 user、reactions...),代價是需要一堆額外 scopes,而且不少實作會在啟動時預先抓 user list,缺 scope 就 fatal 直接退出。

如果你只要「發通知」這個能力,這個 60 行有效程式碼的 server 就夠了,而且 Slack App 只需要勾一個 scope。

## Quick Start

```bash
git clone https://github.com/iBears-Solomon/slack-notify-mcp.git ~/.local/share/slack-notify-mcp
chmod +x ~/.local/share/slack-notify-mcp/slack-notify.js
```

加到 `~/.claude.json` 的 `mcpServers`:

```json
"slack-notify": {
  "type": "stdio",
  "command": "/Users/YOU/.local/share/slack-notify-mcp/slack-notify.js",
  "args": [],
  "env": {
    "SLACK_BOT_TOKEN": "xoxb-REPLACE-WITH-YOUR-BOT-TOKEN"
  }
}
```

完整步驟(建立 Slack App、拿 token、邀請 bot、測試)看 [SETUP.md](./SETUP.md)。

## Tool Schema

```
send_message
├── channel_id  (string, required) — Channel ID (Cxxxx) 或 User ID (Uxxxx) for DM
├── text        (string, required) — 訊息內容,支援 Slack mrkdwn
└── thread_ts   (string, optional) — 回覆某 thread 時帶上 parent 的 ts
```

回傳格式(成功):
```
Sent. channel=C07XXXX ts=1779795557.811009
```

回傳格式(失敗,例 channel_not_found / not_in_channel):
```
Slack API error: channel_not_found
```

## Test

```bash
SLACK_BOT_TOKEN=xoxb-... \
TEST_CHANNEL_ID=C07XXXX \
npm test
```

預期輸出:
```
PASS
marker: mcp-test-1234567890
channel: C07XXXX
send_message response text: Sent. channel=C07XXXX ts=...
```

測試會走完整 MCP 協定:`initialize` → `notifications/initialized` → `tools/list` → `tools/call` → 未知工具 error path,並真的發一則訊息到指定頻道(以 `mcp-test-<timestamp>` 為內容)。

## 為什麼是 MCP 而不是 Slack Webhook

- **Webhook** 綁定特定 channel,要發多 channel 就要多個 URL
- **MCP** 一個 token 任意 channel(只要 bot 被邀請進去)
- **MCP** 走 stdio,Claude Code / Claude Desktop / Cursor 都可以直接接

## License

[MIT](./LICENSE)
