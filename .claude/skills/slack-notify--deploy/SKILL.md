---
name: slack-notify--deploy
description: |
  一鍵部署 slack-notify-mcp 到使用者環境:讀取專案文件、偵測現有環境、引導
  Slack App 設定 + 填入 token/channel,寫入 ~/.claude.json,跑 npm test 驗證。
  slack, mcp, deploy, setup, notify, slack-notify
when_to_use: |
  當使用者要把 slack-notify-mcp 安裝/設定到自己的環境,或要新增/修改既有的
  slack-notify entry(換 token、換 channel、新增多個目的地)時。
---

# Instructions

## Pre-requisites

- 使用者位於 slack-notify-mcp 的 repo 內(`pwd` 包含 README.md + SETUP.md + slack-notify.js),或可以告訴你 repo 路徑
- 使用者有管理權的 Slack workspace(至少能建立 App / 安裝 App)
- 已安裝 Node.js 18+(`node --version`)
- 已安裝 Claude Code(這個 skill 設定的 MCP 是給它用的)

如果任一前置條件不滿足:**先告知使用者再決定要不要繼續**,不要嘗試自動安裝 Node 或 Claude Code。

---

## Steps

### 1. 讀取專案文件,建立內部知識

讀取 repo 內這兩份文件作為**權威來源**,後續所有步驟都以此為準,不要依靠記憶或外部推測:

```text
README.md     # 概覽、tool schema、env var 規範
SETUP.md      # 完整 SOP、scope 設定、troubleshooting
```

讀完後,**用一句話告訴使用者你抓到的版本**(例 "已讀 v2.0.0,目前 channel 走 SLACK_CHANNEL_ID env var,單一 chat:write scope"),確認文件未過期。

> ⚠️ 如果發現 SKILL.md 與 README/SETUP 內容矛盾(版本不一致時可能發生),**以 README/SETUP 為準**,並提醒使用者該 skill 可能需要更新。

### 2. 偵測使用者環境

跑以下檢查並彙整成一份「環境快照」給使用者看:

```bash
# Node 與 Claude Code
node --version
which claude 2>/dev/null && claude --version 2>/dev/null
ls -la ~/.claude.json 2>&1 | head -1

# 既有 slack-notify entries(可能有舊版的、可能有多個 channel)
python3 -c "
import json
try:
    cfg = json.load(open('$HOME/.claude.json'))
    servers = cfg.get('mcpServers', {})
    matches = {k: v for k, v in servers.items() if 'slack' in k.lower()}
    import json as J
    print(J.dumps(matches, indent=2) if matches else '(no slack-related MCP entries)')
except Exception as e:
    print('Error reading ~/.claude.json:', e)
"

# Repo 位置 + 可執行性
pwd
ls -la ./slack-notify.js 2>/dev/null
```

把結果整理成簡短報告:

- Node 版本(>= 18 才繼續)
- Claude Code 是否安裝
- `~/.claude.json` 是否存在
- 既有 slack 相關 MCP entries(用來決定是「新增」還是「更新」)
- 目前 repo 路徑(寫入 config 的 `command` 要用這個絕對路徑)
- slack-notify.js 是否有 `+x` 位元(沒有的話下一步要 chmod)

### 3. 與使用者確認部署目標

問三件事(用 AskUserQuestion 一次問完):

1. **要新增 entry 還是修改既有 entry?**
   - 「新增」:給新的 entry 名字(預設 `slack-notify`,如已存在則建議 `slack-notify-<suffix>`)
   - 「修改」:列出既有 slack-related entry 讓使用者選

2. **目標 channel ID?**
   - 如使用者不知道,引導他:Slack 桌面版右鍵 channel → Copy link → URL 結尾的 `CXXXXXXXX`
   - 提醒他必須先 `/invite @你的Bot` 進該 channel(這一步無法用 API 代勞)

3. **Bot token 在哪?**
   - 已有 token → 請使用者貼上(token 不會留在對話 transcript 以外的地方)
   - 沒有 token → 進 Step 4

### 4. (僅在沒 token 時)引導建立 Slack App

**不要自動執行**,因為這是在 Slack 網頁端操作。把這些步驟整理成 checklist 給使用者執行,完成後請他貼回 token:

引用 `SETUP.md` 的 §1–§4(建 App → scopes → install → invite),特別強調:

- App Name 選有識別度的名字(訊息發送者欄會用這個名字)
- Bot Token Scopes **只加 `chat:write`**,不要加 `chat:write.public` / `users:read` / `channels:read` 等(SETUP §2 強調最小權限)
- 安裝完拿到 `xoxb-...` token

等使用者貼 token 回來後,繼續 Step 5。

### 5. 寫入 `~/.claude.json`

用 Python(避免 shell escape 出包)更新 config,**保持冪等**(idempotent — 重跑這個 skill 不會出問題):

```bash
python3 <<'PY'
import json, pathlib, datetime

p = pathlib.Path.home() / '.claude.json'
backup = p.with_suffix(f'.json.bak.{datetime.datetime.now().strftime("%Y%m%d-%H%M%S")}')
backup.write_text(p.read_text())  # backup first
cfg = json.loads(p.read_text())

cfg.setdefault('mcpServers', {})['<ENTRY_NAME>'] = {
    'type': 'stdio',
    'command': '<ABSOLUTE_PATH_TO>/slack-notify.js',
    'args': [],
    'env': {
        'SLACK_BOT_TOKEN': '<TOKEN>',
        'SLACK_CHANNEL_ID': '<CHANNEL_ID>',
    },
}

p.write_text(json.dumps(cfg, indent=2) + '\n')
print('Backup written:', backup)
print('mcpServers entries:', list(cfg['mcpServers'].keys()))
PY
```

**重要:**

- `command` 必須是**絕對路徑**(Claude Code 不展開 `~`)— 用 Step 2 偵測到的 repo 路徑 + `/slack-notify.js`
- 寫入前**先備份**(`.claude.json.bak.<timestamp>`),萬一改壞了可以還原
- 如果該 entry 已存在,**直接覆寫**整個物件(不要 merge),避免遺留舊 key
- 寫入後 `json.load` 驗證一次,確認 config 仍是合法 JSON

### 6. 確保 slack-notify.js 可執行

```bash
chmod +x <REPO>/slack-notify.js
ls -la <REPO>/slack-notify.js  # 應該看到 -rwxr-xr-x
```

### 7. 跑 npm test 端到端驗證

```bash
cd <REPO>
SLACK_BOT_TOKEN=<TOKEN> SLACK_CHANNEL_ID=<CHANNEL_ID> npm test
```

預期 `ALL PASS`(4 個情境)。如果 happy-path fail:

- `Slack API error: not_in_channel` → 提醒使用者 `/invite @Bot` 進該 channel
- `Slack API error: missing_scope` → 回 Slack App OAuth & Permissions 加 `chat:write` 並 Reinstall
- `Slack API error: invalid_auth` → token 錯,重新拿
- `Slack API error: channel_not_found` → channel ID 拼錯或 bot 不在 workspace

如果 missing-env 三個情境 fail(不太可能,但要驗) → 表示 server 沒按 SETUP §9 的契約走,應該停下來給使用者看 stderr 出了什麼錯。

### 8. 告知使用者重啟 + 給出測試指令

`~/.claude.json` 改完之後,**Claude Code 必須完全退出再重開**(MCP server 只在啟動時載入)。

告訴使用者:

1. 完全退出 Claude Code(不是只關視窗,是 quit)
2. 重開後在**新 session** 跟 Claude 說:「發 hello 到 slack-notify」(或他自己取的 entry 名字)
3. 他應該看到該訊息以 bot 身分送達該 channel,自己的 Slack 客戶端跳 unread + 通知

---

## 完成判定

對照 `./check-list.md`,所有項目都打勾才算完成。任一項沒過,告知使用者卡在哪一步、原因、建議下一步。

## 失敗時要做的事

1. 還原 `~/.claude.json` 從 backup
2. 列出失敗的具體錯誤訊息(stderr / Slack API error code)
3. 對照 `SETUP.md` 的 Troubleshooting 區段找對應條目
4. **不要**捏造 fix,如果 SETUP 沒涵蓋,直接告訴使用者「這個情境不在已知範圍內,需要進一步診斷」

## 安全性

- Bot token 是 **secret**:絕不寫入 git tracked files,絕不在輸出 / log / commit message 中印出完整 token
- 引用 token 時用 prefix + `...`(例 `xoxb-3374...`)
- 若 token 不小心外洩(貼到公開 channel / PR),立刻引導使用者去 Slack App OAuth & Permissions → Reinstall to Workspace 作廢舊 token
