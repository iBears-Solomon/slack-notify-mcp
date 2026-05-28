# slack-notify-mcp

最小化的 stdio MCP server,讓 Claude Code(或任何 MCP client)用 Slack bot token 發訊息。

- **零 npm 依賴** — 純 Node stdlib(`readline` + `https`)
- **單一工具** — `send_message(text, thread_ts?)`
- **單一 scope** — bot 只需要 `chat:write`
- **單一目的地** — channel 在 config 時固定,**一個 MCP instance 對應一個頻道**;要發多頻道就配置多個 entry
- **缺參數會清楚報錯** — `SLACK_BOT_TOKEN` / `SLACK_CHANNEL_ID` / `SLACK_CHANNEL_NAME` 三者任一缺少時,呼叫工具會回傳明確錯誤訊息指出缺哪一個,**不會**真的去打 Slack API
- **多 instance 友善** — `SLACK_CHANNEL_NAME` 會出現在 tool 描述與回傳訊息,搭配內附 `slack-notify` skill 可自動依使用者指定的 channel 名字選對 instance

> 適合的場景:你想讓 AI agent **以 bot 身分發通知**到固定頻道,並期望自己的 Slack 客戶端跳 unread + push notification(自己用 user-token 發訊息給自己不會通知)。

## ⚠️ 設定前怎麼拿到 channel ID

這個 MCP 不能列 channel — channel ID 必須在設定階段就準備好寫入 `~/.claude.json`。三個方法:

1. **Slack 桌面版**:在 channel 名稱上**右鍵 → Copy link**,URL 結尾 `/archives/CXXXXXXX` 就是 channel ID
2. **Slack 網頁版**:打開 channel,網址列尾段 `/messages/CXXXXXXX`(或舊版 `/archives/CXXXXXXX`)
3. **搭配其他能讀 Slack 的 MCP**(claude.ai 內建 Slack connector / 其他 self-host MCP)讓 agent 幫你查

> 💡 設定完成後就**不再依賴**其他 MCP — slack-notify 啟動後完全 self-contained。

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
    "SLACK_BOT_TOKEN": "xoxb-REPLACE-WITH-YOUR-BOT-TOKEN",
    "SLACK_CHANNEL_ID": "C0XXXXXXXXX",
    "SLACK_CHANNEL_NAME": "your-channel-name"
  }
}
```

完整步驟(建立 Slack App、拿 token、邀請 bot、測試)看 [SETUP.md](./SETUP.md)。

## 內附 skills

repo 內有兩個 [Agent Skill](https://docs.claude.com/en/docs/claude-code/skills) 把這個 MCP 變成「Claude 直接會做的事」:

| Skill | 何時觸發 | 做什麼 |
|---|---|---|
| [`slack-notify--deploy`](./.claude/skills/slack-notify--deploy/SKILL.md) | 「設定 slack-notify」、「新增 channel」、「換 token」 | 讀文件、偵測環境、引導 Slack App 設定、寫入 `~/.claude.json`、跑 `npm test`、最後問你要不要把 `slack-notify` skill 裝到 user-level |
| [`slack-notify`](./.claude/skills/slack-notify/SKILL.md) | 「發 X 到 slack」、「通知 #releases」、「丟訊息到 alerts」 | 掃 `~/.claude.json` 找可用 instance、單一直接送、多個依使用者指定 channel name/id 選對應 instance 或詢問 |

## Tool Schema

```
send_message
├── text       (string, required) — 訊息內容,支援 Slack mrkdwn
└── thread_ts  (string, optional) — 回覆某 thread 時帶上 parent 的 ts
```

> ❗ Channel **不是**工具參數 — 由 `SLACK_CHANNEL_ID` env var 在 config 時固定。

成功回傳(含 `SLACK_CHANNEL_NAME` 的人類可讀標籤):
```
Sent. channel=#your-channel-name (C07XXXX) ts=1779795557.811009
```

API 錯誤(例 `channel_not_found` / `not_in_channel`):
```
Slack API error: not_in_channel
```

設定錯誤(env var 缺失):
```
slack-notify: missing required env var(s): SLACK_CHANNEL_NAME. Add to the
`env` block of this MCP server entry in ~/.claude.json and restart Claude
Code. The tool will refuse to call Slack until all three are set.
```

## 想發到多個頻道?

每個目的地配置一個 MCP entry,名字加 suffix 區分:

```json
"slack-notify-releases": {
  "type": "stdio",
  "command": "/Users/YOU/.local/share/slack-notify-mcp/slack-notify.js",
  "args": [],
  "env": {
    "SLACK_BOT_TOKEN": "xoxb-...",
    "SLACK_CHANNEL_ID": "C0AAAA",
    "SLACK_CHANNEL_NAME": "releases"
  }
},
"slack-notify-alerts": {
  "type": "stdio",
  "command": "/Users/YOU/.local/share/slack-notify-mcp/slack-notify.js",
  "args": [],
  "env": {
    "SLACK_BOT_TOKEN": "xoxb-...",
    "SLACK_CHANNEL_ID": "C0BBBB",
    "SLACK_CHANNEL_NAME": "alerts"
  }
}
```

工具名會是 `mcp__slack-notify-releases__send_message` 與 `mcp__slack-notify-alerts__send_message`,Claude 從工具名就知道發到哪個目的地。每個 instance 的 `SLACK_CHANNEL_NAME` 還會出現在 tool 描述,內附的 `slack-notify` skill 也會用它做自然語言匹配(例「發 X 到 #releases」會自動選 releases instance)。

## Test

```bash
SLACK_BOT_TOKEN=xoxb-... \
SLACK_CHANNEL_ID=C07XXXX \
SLACK_CHANNEL_NAME=your-channel-name \
npm test
```

預期 `ALL PASS`,測試會涵蓋 5 個情境:
1. **Happy path** — 完整 MCP 協定走過(`initialize` → `tools/list` → `tools/call`),tool 描述含 `#<channel-name>`,真的發一則訊息到設定頻道
2. **Missing SLACK_CHANNEL_ID** — 啟動時 stderr 警告 + 呼叫工具回 isError 提到 `SLACK_CHANNEL_ID`,**不會**打 Slack
3. **Missing SLACK_BOT_TOKEN** — 同上,提到 `SLACK_BOT_TOKEN`
4. **Missing SLACK_CHANNEL_NAME** — 同上,提到 `SLACK_CHANNEL_NAME`
5. **Missing all three** — 同上,三個都提到

## 為什麼是 MCP 而不是 Slack Incoming Webhook

- **Webhook** 每個 channel 一個 URL,token 在 URL query string,洩漏風險較高
- **MCP** 一個 bot token 可發給多個 channel(以多個 MCP instance 配置)
- **MCP** 走 stdio,Claude Code / Claude Desktop / Cursor 都可以直接接;agent 自然會把錯誤訊息(missing env / Slack API error)回給使用者,而 webhook 是單向的不回應

## License

[MIT](./LICENSE)
