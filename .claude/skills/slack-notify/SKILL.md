---
name: slack-notify
description: |
  透過 slack-notify MCP 發送 Slack 訊息。讀取 ~/.claude.json 找出所有可用的
  slack-notify* MCP instance,單一直接送、多個依使用者指定的 channel name 或
  channel id 自動選擇,沒指定就詢問。
  slack, notify, send, message, notification, 通知, 發訊息
when_to_use: |
  當使用者想透過 bot 發 Slack 通知時,例如:
  - "發 X 到 slack"
  - "通知 slack:X"
  - "deploy 完成,通知 #releases"
  - "用 bot 發 X 到 notification-for-solomon"
  - "丟個訊息到 alerts 頻道:X"
  不要用在「設定/部署 MCP」的場景 — 那是 slack-notify--deploy 的工作。
---

# Instructions

## Pre-requisites

- 至少有一個 `slack-notify*` 的 mcpServers entry 設定在 `~/.claude.json`(由 `slack-notify--deploy` skill 或手動設定)
- Claude Code 已重啟過,該 entry 對應的 MCP 工具 (`mcp__<entry>__send_message`) 在這個 session 可見

如果上述任一條件沒滿足,Step 2 會偵測到並引導使用者去跑 `slack-notify--deploy`。

---

## Steps

### 1. 從使用者輸入萃取「訊息內容」與「指定的 channel(如果有)」

從使用者的 prompt 找出:

- **訊息文字**:要送出去的內容(常常是冒號 / 引號之後的部分,或整段「請幫我發 X」的 X)
- **目標 channel(可選)**:
  - `#xxx` 開頭 → 那是 channel name(去掉 `#` 之後比對 `SLACK_CHANNEL_NAME`)
  - `C` 開頭的 11 碼 ID → channel ID(比對 `SLACK_CHANNEL_ID`)
  - 自然語言「發到 alerts 頻道」、「丟到 releases」→ 視為 channel name `alerts` / `releases`
  - 完全沒提到 → 後面依規則處理

把萃取結果整理一下,**不要**直接動作,讓 Step 2 接手選 instance。

### 2. 掃描可用的 slack-notify instances

```bash
python3 <<'PY'
import json, os, pathlib
p = pathlib.Path.home() / '.claude.json'
cfg = json.loads(p.read_text())
servers = cfg.get('mcpServers', {})
instances = []
for name, conf in servers.items():
    if not name.startswith('slack-notify') or name == 'slack-notify--deploy':
        continue  # skip deploy meta-entry if someone named it the same way
    env = conf.get('env', {})
    instances.append({
        'entry_name': name,
        'tool_name': f'mcp__{name}__send_message',
        'channel_id': env.get('SLACK_CHANNEL_ID', ''),
        'channel_name': env.get('SLACK_CHANNEL_NAME', ''),
    })
print(json.dumps(instances, indent=2))
PY
```

### 3. 依 instance 數量決定行為

#### 3a. 0 個 instance

告知使用者:「找不到 slack-notify MCP entry。請先在這個 repo 跑 `slack-notify--deploy` skill 安裝,或檢查 `~/.claude.json` 的 `mcpServers` 區塊。」結束。

#### 3b. 1 個 instance

**不詢問**。直接用唯一那一個 instance 的 `tool_name`。

如果使用者在 Step 1 有指定 channel name 或 id,**比對一下**:
- 對得上 → 直接送
- 對不上 → 警告使用者「你指定的是 `<X>`,但目前唯一可用 instance 是 `#<name>` (`<id>`),要送到那邊嗎?」用 AskUserQuestion 確認

#### 3c. 2 個以上 instance

| 情況 | 動作 |
|---|---|
| 使用者**有指定** channel(name 或 id),且**剛好**對應到某個 instance | 直接用那個 |
| 使用者**有指定** channel,但找不到對應 instance | 列出所有可用 instance,告知「找不到符合 `<X>` 的 instance,可用的是這些」並用 AskUserQuestion 讓使用者選或取消 |
| 使用者**沒指定** channel | 用 AskUserQuestion 列出所有 instance(顯示 `#<name>` + entry name),讓使用者選 |

> 💡 比對規則:把使用者輸入的 channel name 和 `SLACK_CHANNEL_NAME` 都去除前後空白並小寫後比對(不分大小寫),避免「#Alerts」對不上 `alerts`。

### 4. 載入並呼叫對應的 MCP 工具

用 ToolSearch 載入該 instance 的工具:

```text
select:mcp__<entry_name>__send_message
```

呼叫 schema:

```json
{
  "text": "<從 Step 1 萃取出來的訊息文字>"
}
```

如果使用者明確要回覆某個 thread,加上 `thread_ts`。

### 5. 把結果回報給使用者

成功(MCP 回傳類似 `Sent. channel=#xxx (Cxxxx) ts=...`):

> ✅ 已發送到 **#notification-for-solomon** (ts: 1779964131.180969)

失敗(MCP 回 `isError: true`):

把錯誤原文展示給使用者,並照 SETUP.md 的 Troubleshooting 對應條目給建議:

- `missing required env var(s): ...` → 該 instance 的 env 不完整,叫使用者跑 `slack-notify--deploy` 修
- `Slack API error: not_in_channel` → 提醒去該 channel `/invite @<bot>`
- `Slack API error: channel_not_found` → `SLACK_CHANNEL_ID` 拼錯
- `Slack API error: invalid_auth` → token 失效,Reinstall Slack App
- `Slack API error: missing_scope` → 補 `chat:write` 並 Reinstall

---

## 邊界情況

### 訊息含換行 / 多行

直接整段塞進 `text` 即可,Slack mrkdwn 支援換行(`\n`)。不要自己加 escape。

### 訊息超長

Slack `chat.postMessage` 單則訊息上限約 40,000 字。如果訊息明顯超過 4,000 字,**先警告使用者**,問要不要拆成多則或丟附件。

### 使用者要發到多個 channel

> 「發 X 到 #alerts 跟 #releases」

逐個呼叫對應 instance 的 `send_message`。最後彙總成「✅ 已發送到 #alerts 與 #releases」。

### 使用者把訊息打在引號裡 vs 直接打在指令裡

- `發 "deploy 完成" 到 #releases` → text 是 `deploy 完成`
- `發 deploy 完成 到 #releases` → text 是 `deploy 完成`(往「到」之前的內容當訊息)
- 模糊就**問一次**,不要硬猜

### token 安全

呼叫 MCP 時不會看到 token(由 stdio server 自己處理 env),這 skill **不需要也不應該**去碰 token。不要在 log / 訊息 / commit message 中暴露任何 `xoxb-` 字串。

---

## 完成判定

對照 `./check-list.md`,所有項目都打勾才算完成。

## 與 slack-notify--deploy 的分工

| 場景 | 用哪個 skill |
|---|---|
| 「發訊息」/ 「通知」/ 「告訴 #channel」 | **slack-notify**(這個) |
| 「設定 slack-notify」/ 「新增 channel」/ 「換 token」/ 「部署 MCP」 | **slack-notify--deploy** |

混用判定:如果使用者說「幫我設定 alerts 頻道並發第一則訊息」,**先**跑 deploy,**再**跑這個 slack-notify。
