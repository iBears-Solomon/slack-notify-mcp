# SETUP — 從零建立 Slack Notify MCP

完整 SOP:建立 Slack App → 取得 bot token → 拿到 channel ID + name → 安裝這個 MCP → 接到 Claude Code。

預計時間 **10–15 分鐘**(包含 Slack 那邊的設定)。

> 💡 **想跳過手動步驟**:repo 內附 [`slack-notify--deploy`](./.claude/skills/slack-notify--deploy/SKILL.md) skill — 在 Claude Code 開這個 repo,跟 Claude 說「跑 deploy skill」,它會自動讀 README/SETUP、偵測你的環境、引導你完成 Slack App 設定、寫 config、跑 test。本文件適合想手動掌控每一步的人,或當作 skill 出錯時的 fallback 參考。

---

## 0. 前置需求

- Node.js **18 或以上**(`node --version` 確認)
- 一個你有管理權的 Slack workspace
- Claude Code(或其他支援 stdio MCP 的 client)

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

2.3 加入唯一必要的 scope:

| Scope | 必要性 | 說明 |
| --- | --- | --- |
| `chat:write` | **必要** | 發訊息到 bot 已加入的頻道 / DM |

> ⚠️ **不要**加其他 scope(`users:read` / `channels:read` / `chat:write.public` 等),除非你**之後**確定需要。最小權限原則。多一個 scope 就多一個攻擊面。

---

## 3. 安裝 App 到 Workspace

3.1 同頁面上方 **OAuth Tokens for Your Workspace** → 點 **Install to Workspace**

3.2 確認權限後 **Allow**

3.3 安裝完會出現 **Bot User OAuth Token**,格式是 `xoxb-...`,**複製起來**(下面要用)

> 💡 之後如果改 scopes,要記得回來這頁點 **Reinstall to Workspace** 才生效。

---

## 4. 邀請 Bot 進目標頻道

不管 public 或 private channel,bot 都要被邀請才能發訊息。

在 Slack 頻道輸入框:

```
/invite @你的App名字
```

例:`/invite @Claude Notify`

---

## 5. 取得目標頻道的 Channel ID 與 Channel Name

每個 slack-notify MCP instance 綁定**一個固定頻道**,你需要兩個資訊寫到 config:

- **Channel ID**(`C` 開頭 11 碼,例 `C0XXXXXXXXX`) — Slack API 真正使用
- **Channel Name**(去掉 `#` 前綴的純名字,例 `releases`、`alerts`、`solomon-test`) — 給 tool 描述、回傳訊息、`slack-notify` skill disambiguation 用

取得方式(三種擇一):

| 方式 | 怎麼做 |
| --- | --- |
| **Slack 桌面版**(最快) | channel **右鍵 → Copy link**,URL `https://YOUR.slack.com/archives/CXXXXXXXX` — channel name 在頻道清單上看,channel ID 是 URL 結尾的 `CXXXXXXXX` |
| **Slack 網頁版** | 打開 channel,網址列 `https://app.slack.com/client/TXXXX/CXXXXXXXX` 中 `C` 開頭那段是 ID;channel name 看左側清單 |
| **搭配其他能讀的 Slack MCP** | 用 claude.ai 內建 Slack connector 或其他 self-host MCP 跑一次 `search_channels` 同時拿到 ID + name |

> 💡 設定完成後,slack-notify 完全 **self-contained** — 之後發訊息不需要任何其他 MCP 在線。

> ⚠️ `SLACK_CHANNEL_NAME` 建議**和 Slack 上實際 channel 名一致**(例如真的 `#releases` 就填 `releases`),不然後續看到「Sent. channel=#xxx」會跟實際對不上、令人困惑。技術上你可以填任何辨識字串。

---

## 6. 安裝這個 MCP

```bash
git clone https://github.com/iBears-Solomon/slack-notify-mcp.git ~/.local/share/slack-notify-mcp
chmod +x ~/.local/share/slack-notify-mcp/slack-notify.js
```

> 路徑你可以自己選。文章後面用 `~/.local/share/slack-notify-mcp` 為例。

---

## 7. 設定 Claude Code

### 7.1 編輯 `~/.claude.json`

找到頂層 `"mcpServers"` 區塊,加上:

```json
"slack-notify": {
  "type": "stdio",
  "command": "/Users/YOU/.local/share/slack-notify-mcp/slack-notify.js",
  "args": [],
  "env": {
    "SLACK_BOT_TOKEN": "xoxb-REPLACE-WITH-YOUR-TOKEN",
    "SLACK_CHANNEL_ID": "C0XXXXXXXXX",
    "SLACK_CHANNEL_NAME": "your-channel-name"
  }
}
```

> ⚠️ **`command` 必須是絕對路徑**,Claude Code 不會展開 `~`。

> ⚠️ JSON 不支援註解。確認沒有 trailing comma,否則整個 config 會 parse 失敗。

> ❗ **三個 env var 都必填** — 缺任一,工具呼叫時會回明確錯誤訊息(指出缺哪個)並**不會**真的去打 Slack。

### 7.2 用 claude CLI(可選的替代法)

```bash
claude mcp add slack-notify \
  --scope user \
  --env SLACK_BOT_TOKEN=xoxb-REPLACE \
  --env SLACK_CHANNEL_ID=C0XXXXXXXXX \
  --env SLACK_CHANNEL_NAME=your-channel-name \
  -- /Users/YOU/.local/share/slack-notify-mcp/slack-notify.js
```

### 7.3 想發到多個頻道?

每個目的地配置一個獨立的 MCP entry,名字用 suffix 區分:

```json
"slack-notify-releases": {
  "type": "stdio",
  "command": "/Users/YOU/.local/share/slack-notify-mcp/slack-notify.js",
  "args": [],
  "env": {
    "SLACK_BOT_TOKEN": "xoxb-...",
    "SLACK_CHANNEL_ID": "C0AAAAAAA",
    "SLACK_CHANNEL_NAME": "releases"
  }
},
"slack-notify-alerts": {
  "type": "stdio",
  "command": "/Users/YOU/.local/share/slack-notify-mcp/slack-notify.js",
  "args": [],
  "env": {
    "SLACK_BOT_TOKEN": "xoxb-...",
    "SLACK_CHANNEL_ID": "C0BBBBBBB",
    "SLACK_CHANNEL_NAME": "alerts"
  }
}
```

工具名會是 `mcp__slack-notify-releases__send_message` 與 `mcp__slack-notify-alerts__send_message`,Claude 從工具名就能分辨用途。

> 💡 同一個 bot token 可以用在多個 entry,只要 bot 被邀請進那些 channel 即可。

---

## 8. 重啟 Claude Code

MCP server 只在 Claude Code 啟動時載入。**完全退出再重開**,別只是關掉視窗。

新 session 啟動後,工具會以 `mcp__slack-notify__send_message` 出現(多 instance 時各自有對應名字)。

---

## 9. 測試

### 9.1 用 npm 測

```bash
cd ~/.local/share/slack-notify-mcp
SLACK_BOT_TOKEN=xoxb-... \
SLACK_CHANNEL_ID=C07XXXX \
SLACK_CHANNEL_NAME=your-channel-name \
npm test
```

預期 `ALL PASS`,覆蓋 5 個情境:

1. **Happy path** — 完整 MCP 協定走過,tool 描述含 `#<channel-name>`,並真的發一則 `mcp-test-<timestamp>` 訊息到設定頻道
2. **Missing SLACK_CHANNEL_ID** — 工具回 isError 提到 `SLACK_CHANNEL_ID`,Slack 沒被呼叫
3. **Missing SLACK_BOT_TOKEN** — 同上,提到 `SLACK_BOT_TOKEN`
4. **Missing SLACK_CHANNEL_NAME** — 同上,提到 `SLACK_CHANNEL_NAME`
5. **Missing all three** — 同上,三者都提到

到 Slack 確認情境 1 的訊息有收到即驗證完成。

### 9.2 用 Claude Code 測

新 session 直接說:

> 發 hello 到 slack-notify

或更口語:

> 用 bot 發「部署完成」通知我

Claude 會呼叫 `mcp__slack-notify__send_message` with `{text: "..."}`,訊息會發到你 config 裡寫的 `SLACK_CHANNEL_ID`,你的 Slack 客戶端跳 unread 跟通知。

---

## Troubleshooting

### 工具呼叫回 `missing required env var(s): SLACK_BOT_TOKEN` / `SLACK_CHANNEL_ID` / `SLACK_CHANNEL_NAME`

`~/.claude.json` 裡那個 env block 漏設定。打開檢查三個 key 都在,值都有(不是空字串)。修完後**重啟 Claude Code**(env 是啟動時讀的)。

### 啟動 / 重啟後,工具沒出現在工具清單

**檢查順序:**

1. `~/.claude.json` JSON 是否合法:
   ```bash
   python3 -c "import json; json.load(open('$HOME/.claude.json'))"
   ```
   無錯誤 = 合法。

2. `command` 的絕對路徑是否真的存在且可執行:
   ```bash
   ls -la /Users/YOU/.local/share/slack-notify-mcp/slack-notify.js
   ```
   `-rwxr-xr-x` 才表示可執行。沒有 `x` 就 `chmod +x`。

3. 手動跑一次,確認 server 啟得起來:
   ```bash
   SLACK_BOT_TOKEN=xoxb-... SLACK_CHANNEL_ID=C... SLACK_CHANNEL_NAME=... \
     node ~/.local/share/slack-notify-mcp/slack-notify.js
   ```
   如果它 hang 住等輸入,就是 OK 的(stdio server 行為)。按 Ctrl-C 結束。如果 stderr 有印 `missing required env var(s): ...`,那就是 env 沒給對。

### Slack API error: `not_in_channel`

Bot 還沒被邀請進那個頻道。回到頻道執行 `/invite @你的App名字`。

### Slack API error: `channel_not_found`

- `SLACK_CHANNEL_ID` 拼錯
- 或這是 private channel 而 bot 不在裡面
- 或這是另一個 workspace 的 channel(bot 只認自己被安裝的 workspace)

### Slack API error: `missing_scope`

Bot 的 scope 不夠。回 OAuth & Permissions 確認 `chat:write` 有勾,改完**有點 Reinstall**。

### Slack API error: `invalid_auth`

Token 錯了 / 已 revoke / Reinstall 之後 token 更新了但 `~/.claude.json` 沒同步。回 OAuth & Permissions 拿最新 token。

### Test 顯示 `Timeout waiting for ...`

伺服器啟動但沒回應 — 通常是 stdin/stdout 沒接好。手動跑一次 server 看 stderr 有沒有印錯。

---

## 安全性筆記

- **Bot token 嚴禁 commit 進 git**。`~/.claude.json` 是 user-level 設定,本身不會被 commit。
- 如果你不小心把 token 貼到對話 / PR / Slack 公開頻道,**立刻**到 OAuth & Permissions → Reinstall to Workspace,舊 token 會作廢。
- 這個 MCP 只實作 `chat.postMessage`,沒有讀任何資料的能力。即使 token 漏了,攻擊面也只限於「以 bot 身分發垃圾訊息」(且只能發到 bot 被邀請進的 channel)。
- 想進一步限縮,可在 Slack App 設定加 IP allowlist(企業版才有)或定期 rotate token。

---

## 進階:擴充自己的工具

整個 server 只有 ~240 行,新增工具的範本:

1. 在 `TOOLS` array 加一個 entry,定義 name + schema
2. 在 `handle()` 裡 `tools/call` 分支加一個 if
3. 寫對應的 helper(通常就是另一個 `slackPost('xxx.yyy', body)`)
4. 在 `test-slack-notify.js` 加一個 assertion

範例:加 `add_reaction`(需要 bot scope `reactions:write`):

```js
// 在 TOOLS array 加
{
  name: 'add_reaction',
  description: 'Add an emoji reaction to a message in the configured channel',
  inputSchema: {
    type: 'object',
    properties: {
      ts: { type: 'string', description: 'Message timestamp' },
      emoji: { type: 'string', description: 'Emoji name (no colons), e.g. "thumbsup"' },
    },
    required: ['ts', 'emoji'],
  },
}

// 在 tools/call 分支加
if (name === 'add_reaction') {
  const envErr = checkRequiredEnv();
  if (envErr) return { content: [{ type: 'text', text: envErr }], isError: true };
  const { ts, emoji } = params.arguments;
  const r = await slackPost('reactions.add', {
    channel: CHANNEL_ID,
    timestamp: ts,
    name: emoji,
  });
  // ...同 send_message 的 ok 判斷
}
```

加完 scope 記得 Reinstall;新工具沿用既有的 `SLACK_BOT_TOKEN` / `SLACK_CHANNEL_ID` / `SLACK_CHANNEL_NAME`,通常不用新增 env var。

---

## 參考

- [Slack API: chat.postMessage](https://api.slack.com/methods/chat.postMessage)
- [Slack scope reference](https://api.slack.com/scopes)
- [Model Context Protocol spec](https://modelcontextprotocol.io/)
- [Claude Code MCP docs](https://docs.claude.com/en/docs/claude-code/mcp)
