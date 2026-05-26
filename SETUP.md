# SETUP — 從零建立 Slack Notify MCP

完整 SOP:建立 Slack App → 取得 bot token → 安裝這個 MCP → 接到 Claude Code。

預計時間 **10–15 分鐘**(包含 Slack 那邊的設定)。

---

## 0. 前置需求

- Node.js **18 或以上**(`node --version` 確認)
- 一個你有管理權的 Slack workspace
- Claude Code(或其他支援 stdio MCP 的 client)
- **另一個能讀 Slack 的 MCP**(見 §0.1) — 這個 server 只負責發送,channel ID 從別處來

### 0.1 為什麼需要「另一個 MCP」

`slack-notify` 只實作 `chat.postMessage`,沒任何讀取能力。它**不知道**有哪些 channel、channel 對應到什麼名字、有哪些 user — 它需要外部把 `channel_id` (例 `C07XXXX`) 直接餵給它。

實務上 AI agent 的對話會像這樣:

```
User: 發 deploy 完成 到 #releases
Agent: [內部] 查 channel "releases" 的 ID
       → 呼叫「讀取用 MCP」的 slack_search_channels("releases")
       ← C0AB12CD3
Agent: [內部] 發訊息
       → 呼叫 slack-notify 的 send_message(channel_id=C0AB12CD3, text="deploy 完成")
       ← Sent.
```

少了讀取 MCP,使用者每次都得自己貼 channel ID,失去 AI agent 的便利性。

**選一個讀取 MCP 設定好再繼續:**

| 方案 | 設定難度 | 適合誰 |
| --- | --- | --- |
| **claude.ai 內建 Slack connector** | 低(網頁 OAuth 一次完成) | 一般使用者,推薦 |
| [korotovsky/slack-mcp-server](https://github.com/korotovsky/slack-mcp-server) | 中(需要 xoxp 或 xoxc/xoxd) | 想自架 / 不依賴 claude.ai connector |
| 自己擴充本 repo | 高(要加 scope + 工具) | 想全部自掌控 |

> 💡 **臨時解法(沒讀取 MCP 也能用)**:Slack 桌面版右鍵 channel → Copy link,URL `https://YOUR.slack.com/archives/CXXXXXXXX` 結尾就是 channel ID。手動把 ID 給 agent 即可,但每個 channel 都要查一次。

---

## 1. 建立 Slack App

1.1 開 https://api.slack.com/apps → 點 **Create New App**

1.2 選 **From scratch**

1.3 填:
- **App Name**:建議用容易識別的名字,例 `Claude Notify` / `AI Notify`(這個名字會出現在訊息發送者欄位)
- **Pick a workspace**:你要發訊息的那個 workspace

1.4 點 **Create App**

---

## 2. 設定 Bot Token Scopes

2.1 左側 sidebar 進 **OAuth & Permissions**

2.2 往下捲到 **Scopes** 區塊 → **Bot Token Scopes** → **Add an OAuth Scope**

2.3 加入必要 scope:

| Scope | 必要性 | 說明 |
| --- | --- | --- |
| `chat:write` | **必要** | 發訊息到 bot 已加入的頻道 / DM |
| `chat:write.public` | 選用 | 不用 invite 就能發到 public channel(方便,但會稍微擴大權限) |

> ⚠️ **不要**加 `users:read` / `channels:read` 等其他 scope,除非你**之後**確定需要。最小權限原則。

---

## 3. 安裝 App 到 Workspace

3.1 同頁面上方 **OAuth Tokens for Your Workspace** → 點 **Install to Workspace**

3.2 確認權限後 **Allow**

3.3 安裝完會出現 **Bot User OAuth Token**,格式是 `xoxb-...`,**複製起來**(下面要用)

> 💡 之後如果改 scopes,要記得回來這頁點 **Reinstall to Workspace** 才生效。

---

## 4. 邀請 Bot 進目標頻道

不管 public 或 private channel,bot 都要被邀請才能發訊息(`chat:write.public` 例外,但建議養成 invite 習慣)。

在 Slack 頻道輸入框:

```
/invite @你的App名字
```

例:`/invite @Claude Notify`

---

## 5. 安裝這個 MCP

```bash
git clone https://github.com/iBears-Solomon/slack-notify-mcp.git ~/.local/share/slack-notify-mcp
chmod +x ~/.local/share/slack-notify-mcp/slack-notify.js
```

> 路徑你可以自己選。文章後面用 `~/.local/share/slack-notify-mcp` 為例。

---

## 6. 設定 Claude Code

### 6.1 編輯 `~/.claude.json`

找到頂層 `"mcpServers"` 區塊,加上:

```json
"slack-notify": {
  "type": "stdio",
  "command": "/Users/YOU/.local/share/slack-notify-mcp/slack-notify.js",
  "args": [],
  "env": {
    "SLACK_BOT_TOKEN": "xoxb-REPLACE-WITH-YOUR-TOKEN"
  }
}
```

> ⚠️ **`command` 必須是絕對路徑**,Claude Code 不會展開 `~`。

> ⚠️ JSON 不支援註解。確認沒有 trailing comma,否則整個 config 會 parse 失敗。

### 6.2 用 claude CLI(可選的替代法)

```bash
claude mcp add slack-notify \
  --scope user \
  --env SLACK_BOT_TOKEN=xoxb-REPLACE \
  -- /Users/YOU/.local/share/slack-notify-mcp/slack-notify.js
```

---

## 7. 重啟 Claude Code

MCP server 只在 Claude Code 啟動時載入。**完全退出再重開**,別只是關掉視窗。

新 session 啟動後,工具會以 `mcp__slack-notify__send_message` 出現。

---

## 8. 測試

### 8.1 用 npm 測

```bash
cd ~/.local/share/slack-notify-mcp
SLACK_BOT_TOKEN=xoxb-... \
TEST_CHANNEL_ID=C07XXXX \
npm test
```

預期 `PASS`,並到 Slack 確認有收到一則 `mcp-test-<timestamp>` 訊息。

### 8.2 用 Claude Code 測

#### 已知 channel ID 的情況
新 session 直接說:

> 幫我用 slack-notify 發 hello 到 C07XXXX

Claude 會呼叫 `mcp__slack-notify__send_message`,你應該會在 Slack 看到該訊息以 bot 身分送達,你的客戶端會跳 unread 跟通知。

#### 真實情境(搭配讀取 MCP)
通常你不會記得 channel ID,而是直接講頻道名字:

> 幫我發 deploy 完成 到 #releases

Claude 會:
1. 用讀取 MCP(claude.ai connector / korotovsky 等)呼叫 `slack_search_channels("releases")` 拿到 channel ID
2. 用 `slack-notify` 的 `send_message` 把訊息送出

如果你只設定了 `slack-notify` 沒設讀取 MCP,Claude 會回你「不知道 channel ID,請你提供」— 這就是 §0.1 強調的「兩個 MCP 缺一不可」。

---

## Troubleshooting

### 啟動 / 重啟後,工具沒出現

**檢查順序:**

1. `~/.claude.json` JSON 是否合法:
   ```bash
   python3 -c "import json; json.load(open('$HOME/.claude.json'))"
   ```
   無錯誤 = 合法。
2. `command` 的絕對路徑是否真的存在:
   ```bash
   ls -la /Users/YOU/.local/share/slack-notify-mcp/slack-notify.js
   ```
   `-rwxr-xr-x` 才表示可執行。
3. 手動跑一次,確認 server 啟得起來:
   ```bash
   SLACK_BOT_TOKEN=xoxb-... node ~/.local/share/slack-notify-mcp/slack-notify.js
   ```
   如果它 hang 住等輸入,就是 OK 的(stdio server 行為)。按 Ctrl-C 結束。

### Slack API error: `not_in_channel`

Bot 還沒被邀請進那個頻道。回到頻道執行 `/invite @你的App名字`。

### Slack API error: `channel_not_found`

- `channel_id` 拼錯
- 或這是 private channel 而 bot 不在裡面
- 或這是另一個 workspace 的 channel(bot 只認自己被安裝的 workspace)

### Slack API error: `missing_scope`

Bot 的 scope 不夠。檢查 OAuth & Permissions 頁面,確認 `chat:write` 有勾,並且改完之後**有 Reinstall**。

### Slack API error: `invalid_auth`

Token 錯了 / 已 revoke / Reinstall 之後 token 更新了但 `~/.claude.json` 沒同步。回 OAuth & Permissions 拿最新 token。

### Test 顯示 `Timeout waiting for ...`

伺服器啟動但沒回應 — 通常是 stdin/stdout 沒接好,或 `SLACK_BOT_TOKEN` 沒傳進去(server 啟動會立刻 exit 1)。手動跑一次 server 看 stderr 有沒有印錯。

---

## 安全性筆記

- **Bot token 嚴禁 commit 進 git**。`~/.claude.json` 是 user-level 設定,本身不會被 commit。
- 如果你不小心把 token 貼到對話 / PR / Slack 公開頻道,**立刻**到 OAuth & Permissions → Reinstall to Workspace,舊 token 會作廢。
- 這個 MCP 只實作 `chat.postMessage`,沒有讀任何資料的能力。即使 token 漏了,攻擊面也只限於「以 bot 身分發垃圾訊息」。
- 想進一步限縮,可在 Slack App 設定加 IP allowlist(企業版才有)或定期 rotate token。

---

## 進階:擴充自己的工具

整個 server 只有 ~160 行,新增工具的範本:

1. 在 `TOOLS` array 加一個 entry,定義 name + schema
2. 在 `handle()` 裡 `tools/call` 分支加一個 if
3. 寫對應的 helper(通常就是另一個 `slackPost('xxx.yyy', body)`)
4. 在 `test-slack-notify.js` 加一個 assertion

範例:加 `add_reaction`(需要 bot scope `reactions:write`):

```js
// 在 TOOLS array 加
{
  name: 'add_reaction',
  description: 'Add an emoji reaction to a message',
  inputSchema: {
    type: 'object',
    properties: {
      channel_id: { type: 'string' },
      ts: { type: 'string', description: 'Message timestamp' },
      emoji: { type: 'string', description: 'Emoji name (no colons), e.g. "thumbsup"' },
    },
    required: ['channel_id', 'ts', 'emoji'],
  },
}

// 在 tools/call 分支加
if (name === 'add_reaction') {
  const { channel_id, ts, emoji } = params.arguments;
  const r = await slackPost('reactions.add', { channel: channel_id, timestamp: ts, name: emoji });
  // ...同 send_message 的 ok 判斷
}
```

加完 scope 記得 Reinstall。

---

## 參考

- [Slack API: chat.postMessage](https://api.slack.com/methods/chat.postMessage)
- [Slack scope reference](https://api.slack.com/scopes)
- [Model Context Protocol spec](https://modelcontextprotocol.io/)
- [Claude Code MCP docs](https://docs.claude.com/en/docs/claude-code/mcp)
