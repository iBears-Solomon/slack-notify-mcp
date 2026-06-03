# slack-notify-mcp

最小化的 stdio MCP server,讓 Claude Code(或任何 MCP client)用 Slack bot token 發訊息。

- **零 npm 依賴** — 純 Node stdlib(`readline` + `https`)
- **單一工具** — `send_message(text, thread_ts?)`
- **單一 scope** — bot 只需要 `chat:write`
- **單一目的地** — channel 在 config 時固定,**一個 MCP instance 對應一個頻道**;要發多頻道就配置多個 entry
- **缺參數會清楚報錯** — `SLACK_BOT_TOKEN` / `SLACK_CHANNEL_ID` / `SLACK_CHANNEL_NAME` 三者任一缺少時,呼叫工具會回傳明確錯誤訊息指出缺哪一個,**不會**真的去打 Slack API
- **多 instance 友善** — `SLACK_CHANNEL_NAME` 會出現在 tool 描述與回傳訊息,搭配內附 `slack-notify` skill 可自動依使用者指定的 channel 名字選對 instance

> 適合的場景:你想讓 AI agent **以 bot 身分發通知**到固定頻道,並期望自己的 Slack 客戶端跳 unread + push notification(自己用 user-token 發訊息給自己不會通知)。

## Quick Start

兩種安裝方式擇一:

### 方法 A:讓 Claude 跑 deploy skill(推薦)

在任何 Claude Code session 內(**不需要先手動 clone**),直接說:

> 請 clone https://github.com/iBears-Solomon/slack-notify-mcp 到 ~/slack-notify-mcp,然後讀 `~/slack-notify-mcp/.claude/skills/slack-notify--deploy/SKILL.md` 並依序執行所有 Steps

agent 會 `git clone` 後讀 [`SKILL.md`](./.claude/skills/slack-notify--deploy/SKILL.md) 按步驟執行:偵測環境、引導 Slack App 設定(scopes / install / invite)、寫入 `~/.claude.json`、跑 `npm test` 端到端驗證。

> 💡 為什麼要明示 `讀 SKILL.md`?Claude Code 的 skill loader 只在 session 啟動時掃描;mid-session clone 下來的 skill 不會被自動發現,所以直接讓 agent 用 Read 工具讀檔最穩。SKILL.md 本身可獨立執行,不依賴 skill registry。

**⏱ 約 10-20 分鐘**。過程中你會被要求:

- Slack workspace 管理權(能建立 / 安裝 App)
- 若還沒有 bot token:手動建 Slack App + 在目標 channel 跑 `/invite @<bot>`(skill 會給你 checklist)
- 完成後**完全退出 Claude Code(macOS: Cmd+Q,非僅關閉視窗)**再重開,新 MCP 才會載入

已有 entry 也可用同樣方式更新 path / 換 token / 新增 channel。

### 方法 B:手動設定

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

repo 內有三個 [Agent Skill](https://docs.claude.com/en/docs/claude-code/skills) 把這個 MCP 變成「Claude 直接會做的事」:

| Skill | 何時觸發 | 做什麼 |
|---|---|---|
| [`slack-notify--deploy`](./.claude/skills/slack-notify--deploy/SKILL.md) | 「設定 slack-notify」、「新增 channel」、「換 token」 | 讀文件、偵測環境、引導 Slack App 設定、寫入 `~/.claude.json`、跑 `npm test`、最後用 multi-select 問你要裝哪些附加元件(`slack-notify` skill / auto-notify hook,預設全勾) |
| [`slack-notify`](./.claude/skills/slack-notify/SKILL.md) | 「發 X 到 slack」、「通知 #releases」、「丟訊息到 alerts」 | 掃 `~/.claude.json` 找可用 instance、單一直接送、多個依使用者指定 channel name/id 選對應 instance 或詢問 |
| [`slack-notify--deploy-hook`](./.claude/skills/slack-notify--deploy-hook/SKILL.md) | 「裝自動通知 hook」、「Claude 做完通知我」 | 把 helper script 複製到 `~/.claude/scripts/`、在 `~/.claude/settings.json` 註冊 `Stop` hook,讓 Claude Code 每輪回應結束自動發 Slack(見下節) |

## 自動通知(Claude Code hook)

> ⛔ **這是 Claude Code 限定功能,不是給一般 Claude chat 用的。** hook 綁在 Claude Code 的 agent 生命週期(`~/.claude/settings.json`);Claude Desktop 的一般對話 / claude.ai 網頁**沒有 hook 機制**,裝不上也不會自動通知。想在其他客戶端用,見下面〈[在一般 Claude chat 用得到嗎?](#在一般-claude-chat-用得到嗎)〉。

除了「Claude 主動發訊息」(上面的 `slack-notify` skill),還可以裝一個 **hook**,讓 Claude Code **每輪回應結束時自動**發一則 Slack 通知 —— 適合「丟個長任務給 Claude,跑完或需要你回覆時 ping 你」。

**安裝**:跑 `slack-notify--deploy` 時在最後的 multi-select 勾「auto-notify hook」,或單獨跑 [`slack-notify--deploy-hook`](./.claude/skills/slack-notify--deploy-hook/SKILL.md)。裝完**完全退出再重開 Claude Code** 才生效。

**訊息格式**(兩行,不含時間 — Slack 本來就有時戳):

```
已解決: <你上一則的提問>
by slack-notify-mcp/My session title
```
```
待回覆: <Claude 結束時問你的問題>
by slack-notify-mcp/My session title
```

- 第二行的 `<project>/<title>` 是**可點連結**,用 `claude://code/new?folder=<cwd>` 開啟 Claude Code 在該專案(開新 session — Claude Code 不支援用 session id resume 既有對話)
- **內容感知**:plan 待核准(`ExitPlanMode`)/ 選項介面(`AskUserQuestion`)/ 結尾問句 → `待回覆:`;一般回應結束 → `已解決:`(帶上你上一則 prompt 當主題)

**觸發事件**:裝 `Stop` + `Notification` 兩個 hook。

| 事件 | 抓什麼 |
|---|---|
| `Stop` | 一般回應結束 → `已解決` / `待回覆`(結尾問句) |
| `Notification` | **plan 待核准、選項介面** → `待回覆`。AskUserQuestion / ExitPlanMode 讓 turn 以 `stop_reason=tool_use` 結束,**`Stop` 不觸發**(Claude Code 已知限制,無專屬 hook),只能靠 Notification 抓。⚠️ 可能即時(視窗失焦)或要到 idle 門檻才觸發,**無法保證零延遲** |

**行為細節**:

| 行為 | 說明 |
|---|---|
| 不洗版 | Notification 只在偵測到 pending 問題/計劃時送;**權限請求**(太頻繁)與**純 idle**(Stop 已送)一律忽略 |
| 跨事件去重 | per-session signature(最後一則 assistant uuid)避免 Stop + Notification 或多次 Notification 對同一暫停重複 ping |
| subagent 不通知 | 只在主 agent 觸發;transcript 路徑含 `/subagents/` 一律靜默 |
| 手動 dedupe | 這一輪若你已用 `mcp__slack-notify__send_message` 手動發過,Stop 自動跳過 |
| 空 session 靜默 | 沒有可萃取的 prompt 又沒標題 → 跳過,不發空訊息 |
| 標題來源 | 優先讀 Claude Desktop 的即時 / rename 標題(`~/Library/Application Support/Claude/claude-code-sessions/**/local_*.json`),讀不到才退回 transcript 的 `ai-title`,最後 `Untitled` |
| 失敗不擋路 | Slack 送失敗只記 `~/.claude/scripts/slack-notify-hook.log` 並 **exit 0** —— Stop hook 回非零會 block 並造成無限 loop,所以一律不 surface 到對話 |
| `SessionEnd` 預設不裝 | 關 session 才觸發,但撞名又觸發太頻繁;要的話在 deploy-hook 的 `events` list 加回 |

> token / channel 跟 MCP 共用 `~/.claude.json` 的 `slack-notify` entry,hook 不另存密鑰。解除安裝指引見 deploy-hook skill 的 Step 8。

## 在一般 Claude chat 用得到嗎?

這個 repo 是兩個獨立的東西,可攜性不同:

| 能力 | Claude Code | Claude Desktop 一般對話 | claude.ai 網頁 |
|---|---|---|---|
| **發訊息工具**(`send_message`) | ✅ | ✅ 加進 Desktop config 即可 | ⚠️ 需改寫成 remote MCP |
| **自動通知 hook**(做完 / 待回覆自動 ping) | ✅ | ❌ 無 hook 機制 | ❌ 無 hook 機制 |

### 發訊息工具 → 可搬到 Claude Desktop 一般對話

`slack-notify.js` 是標準 stdio MCP server,Claude Desktop 一般對話也吃 MCP。把它加進 `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "slack-notify": {
      "command": "/絕對路徑/node",
      "args": ["/絕對路徑/slack-notify-mcp/slack-notify.js"],
      "env": {
        "SLACK_BOT_TOKEN": "xoxb-...",
        "SLACK_CHANNEL_ID": "C0XXXX",
        "SLACK_CHANNEL_NAME": "your-channel-name"
      }
    }
  }
}
```

完全退出再重開 Claude Desktop,之後在**一般對話**說「發 X 到 slack」Claude 就會呼叫工具。

> ⚠️ **macOS 雷**:Claude Desktop 是 GUI 啟動,**不繼承 shell PATH**,`command` 寫 `node` / `npx` 常常找不到。用 `which node` 查出**絕對路徑**填進去(version manager 如 nvm/fnm 的路徑尤其要注意)。

### claude.ai 網頁 → 需要 remote MCP connector

網頁端只吃**遠端 MCP**(Streamable HTTP,SSE 已淘汰),不能跑本機 stdio。要上網頁得把這支 server 改寫 / 用 proxy(如 `mcp-remote`)包成 HTTP server、公開部署、加 OAuth —— 是另一個工程,本 repo 不含。

### 自動通知(做完 ping 你)→ 一般 chat 做不到

`Stop` / `Notification` hook 是 **Claude Code 與 [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/hooks) 專屬**。一般 Claude chat(Desktop / 網頁)沒有「turn 結束」的生命週期事件可掛。可行的替代:

- **軟性版**:在 Project 自訂指令叫 Claude「每次回應結束都呼叫 `send_message` 通知我」—— 靠 prompt,不保證每次、也不會在「等你回覆」時觸發
- **完整版**:用 Claude Agent SDK 自己寫一個 chat app,SDK 支援 `Stop` / `Notification` / `PreToolUse` 等 hook,即可複刻本 repo 的自動通知

## Tool Schema

```
send_message
├── text       (string, required) — 訊息內容,支援 Slack mrkdwn
└── thread_ts  (string, optional) — 回覆某 thread 時帶上 parent 的 ts
```

> ❗ Channel **不是**工具參數 — 由 `SLACK_CHANNEL_ID`(API 用)+ `SLACK_CHANNEL_NAME`(顯示用)兩個 env var 在 config 時固定。

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
