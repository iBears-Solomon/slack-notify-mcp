---
name: slack-notify--deploy-hook
description: |
  把 slack-notify 自動通知 hook 安裝到使用者 ~/.claude/ 環境:複製 helper script、
  在 ~/.claude/settings.json 註冊 Stop hook(子代理不通知),讓 Claude Code 每輪
  回應結束時自動發 Slack 通知。
  訊息內容感知 — 完成是「已解決: <你上次的提問>」、等回覆是「待回覆: <Claude 的問題>」。
  (SessionEnd / Notification 預設不裝 — 詳見 Step 5;前者撞名又觸發時機過多,後者跟 Stop 重複。)
  slack, hook, notify, auto, stop, deploy
when_to_use: |
  當使用者已經部署過 slack-notify MCP(`slack-notify--deploy` 跑完),想再加上
  「每輪回應結束自動通知」這個能力時。也用於更新或重裝既有 hook。
---

# Instructions

## Pre-requisites

- 機器上已有 slack-notify-mcp 的 repo(Step 1 會自動定位)
- `~/.claude.json` 已有可用的 `slack-notify` mcpServers entry(token + channel 都填好)
  → 如果還沒,**先跑 `slack-notify--deploy`**,別在這個 skill 裡重設 MCP
- Python 3(macOS 內建,`python3 --version` 確認)
- Claude Code 已安裝(這個 skill 設定的 hook 是給它觸發的)

如果任一不滿足:**先告知使用者再決定要不要繼續**,不要自動裝 Python 或重做 MCP 部署。

> 📖 **本檔案可獨立執行,不依賴 Claude Code skill loader** — 如果你(agent)是被 prompt
> 指示用 Read 讀到此檔案(mid-session clone 的情境),直接照下面 Steps 順序執行即可。

---

## Steps

### 1. 定位 repo + 確認 hook source 存在

按以下順序找 repo,**第一個找到就用**:

```bash
test -f ./slack-notify.js && test -f ./README.md && pwd
git -C . rev-parse --show-toplevel 2>/dev/null
for d in ~/slack-notify-mcp ~/.local/share/slack-notify-mcp ~/src/slack-notify-mcp ~/repos/slack-notify-mcp ~/code/slack-notify-mcp; do
  [ -f "$d/slack-notify.js" ] && echo "$d" && break
done
```

確認該 repo 下**確實有** `hooks/slack-notify-hook.py`:

```bash
ls -la <repo>/hooks/slack-notify-hook.py
```

沒有的話 → 跟使用者說「repo 版本過舊,缺 hooks/ 目錄,請 `git pull` 或重 clone」,別自己生內容。

### 2. 環境偵測

```bash
python3 --version
ls -la ~/.claude.json 2>&1 | head -1
ls -la ~/.claude/settings.json 2>&1 | head -1
ls -la ~/.claude/scripts/ 2>&1 | head -3

# slack-notify MCP entry 必須已存在
python3 -c "
import json, pathlib
cfg = json.loads((pathlib.Path.home() / '.claude.json').read_text())
entry = cfg.get('mcpServers', {}).get('slack-notify')
if not entry:
    print('MISSING: mcpServers.slack-notify entry not found')
else:
    env = entry.get('env', {})
    ok = all(env.get(k) for k in ('SLACK_BOT_TOKEN', 'SLACK_CHANNEL_ID', 'SLACK_CHANNEL_NAME'))
    print('OK' if ok else 'INCOMPLETE env:', list(env.keys()))
"

# get-timestamp skill 是否存在(timestamp 格式參考)
ls -la ~/.claude/skills/common--get-timestamp/SKILL.md 2>&1 | head -1
```

把結果整理一份簡短報告:

- Python ≥ 3.8 — macOS 內建一定夠,但確認一下
- `~/.claude.json` 存在
- `mcpServers.slack-notify` entry 存在,且 env 三個欄位都填了
- `~/.claude/skills/common--get-timestamp/` 存在(沒有 → 提示複製,見 Step 3a)
- `~/.claude/settings.json` 存在(沒有則 Step 5 會建一個空殼)
- `~/.claude/scripts/` 目錄(沒有 → Step 4 會 mkdir)

### 3. (可選)確保 get-timestamp skill 存在

Hook script 用本機時區的 ISO 8601 / HH:MM,**功能上不依賴 get-timestamp skill**,但專案規範用 timestamp 時都引用該 skill,值得有。

若 `~/.claude/skills/common--get-timestamp/` 不存在:

```bash
# 尋找來源(任一專案內的副本都行)
SRC=$(find /Users/$USER -maxdepth 5 -type d -name "common--get-timestamp" 2>/dev/null | head -1)
[ -n "$SRC" ] && mkdir -p ~/.claude/skills && cp -r "$SRC" ~/.claude/skills/common--get-timestamp
```

找不到來源就跳過,提醒使用者「之後想要 timestamp 標準化可以手動安裝」,別中斷部署。

### 4. 安裝 helper script 到 `~/.claude/scripts/`

```bash
mkdir -p ~/.claude/scripts
cp <repo>/hooks/slack-notify-hook.py ~/.claude/scripts/slack-notify-hook.py
chmod +x ~/.claude/scripts/slack-notify-hook.py
ls -la ~/.claude/scripts/slack-notify-hook.py
```

**驗證**:期望看到 `-rwxr-xr-x`,大小 ~6KB 上下。

> ⚠️ Hook script 預設讀 `mcpServers["slack-notify"]` entry。如果使用者用不同 entry 名(例
> 多 channel 的 `slack-notify-alerts`),Step 6 完成後請他改 script 內的 `INSTANCE`
> 常數,或為每個 entry 各複製一份 script 並重新指向。

### 5. 用 Python merge hooks 進 `~/.claude/settings.json`(冪等)

**先備份**,再 merge,不重複加同樣 command:

```bash
python3 <<'PY'
import json, pathlib, datetime, shutil

p = pathlib.Path.home() / '.claude' / 'settings.json'
p.parent.mkdir(parents=True, exist_ok=True)
if p.exists():
    backup = p.with_suffix(f'.json.bak.{datetime.datetime.now().strftime("%Y%m%d-%H%M%S")}')
    shutil.copy(p, backup)
    print(f'backup -> {backup}')
    cfg = json.loads(p.read_text())
else:
    cfg = {}

events = ['Stop']
# Only Stop is registered by default. The hook script also handles
# SessionEnd and Notification if you add them here, but both are off by
# default on purpose:
#   - SessionEnd: fires whenever ANY session closes (including stale idle
#     tabs you forgot about), and auto-titles frequently collide
#     ("Slack notify command" x2), so "已結束" is ambiguous + surprising.
#   - Notification: Claude Code's built-in 60s idle reminder duplicates
#     Stop, which already fires the moment Claude waits for input.
# To re-enable either, add 'SessionEnd' / 'Notification' to this list and
# re-run -- the script is content-aware for all three.
existing = cfg.setdefault('hooks', {})

for event in events:
    cmd = f'python3 ~/.claude/scripts/slack-notify-hook.py {event}'
    entries = existing.setdefault(event, [])
    already = any(
        any(h.get('command') == cmd for h in entry.get('hooks', []))
        for entry in entries
    )
    if already:
        print(f'{event}: already present, skipping')
        continue
    entries.append({'hooks': [{'type': 'command', 'command': cmd}]})
    print(f'{event}: added')

p.write_text(json.dumps(cfg, indent=2) + '\n')
# Verify still parseable
json.loads(p.read_text())
print('hooks keys:', list(cfg.get('hooks', {}).keys()))
PY
```

**重要**:

- 一定要**先備份**(`.bak.<timestamp>`),萬一改壞了可還原
- 寫入後重新 `json.load` 驗證合法
- 已存在同 command 的 entry → **跳過**(不重複加),這個 skill 才能安全重跑

### 6. Smoke test — 直接呼叫 script 確認可發訊息

**6a. 正常發送**(建臨時 transcript 確保會送出 — 注意:不帶 transcript 又無 title 的呼叫會被 skip,不會送):

```bash
TMP=$(mktemp -d)
cat > "$TMP/t.jsonl" <<'EOF'
{"type":"ai-title","aiTitle":"smoke test","sessionId":"smoke"}
{"type":"user","message":{"content":"hello from smoke test"}}
{"type":"assistant","message":{"content":[{"type":"text","text":"done"}]}}
EOF
echo "{\"cwd\":\"$HOME/slack-notify-mcp\",\"transcript_path\":\"$TMP/t.jsonl\"}" \
  | python3 ~/.claude/scripts/slack-notify-hook.py Stop
echo "exit=$?"
rm -rf "$TMP"
```

預期:exit=0,Slack 對應 channel 收到一則兩行訊息:
```
已解決: hello from smoke test
by slack-notify-mcp/smoke test
```
(`slack-notify-mcp/smoke test` 是可點連結。若使用者是 Claude Desktop 且該 session 有 rename,實際 title 會以 desktop 顯示名為準。)

**6b. (可選)失敗情境**

`fail()` 永遠 `exit 0` 不 surface 到對話(防 infinite loop,見 Step 7 說明)。要驗證失敗路徑,可暫時把 `~/.claude.json` 的 `SLACK_BOT_TOKEN` 改成 `xoxb-broken` 跑一次,期待:

- 退出碼仍是 `0`(必須,不能是 2)
- Slack 沒有收到新訊息
- log 最後一行是 `FAIL slack api error: invalid_auth`

驗證完**務必改回原 token**。

預期 log file 有寫:

```bash
cat ~/.claude/scripts/slack-notify-hook.log | tail -5
```

應該看到 `OK Stop -> Cxxxxx ts=...`(成功)、`SKIP Stop ...`(dedupe)或 `FAIL ...`(失敗,exit 仍 0)。

### 7. 告知使用者重啟 + 行為說明

`~/.claude/settings.json` 改完之後,Claude Code 必須**完全退出再重開**才會載入新 hook。

告訴使用者:

1. **完全退出** Claude Code(quit,不是只關視窗)
2. 重開後**任何一個 session** 都會自動啟用(只在 Claude 每輪回應結束時):
   - Claude 完成回應 → Slack 收到 `已解決: <你上次的提問>` + `by <project>/<title>`
   - Claude 結束於提問(AskUserQuestion 或結尾 `?`/`？`)→ 收到 `待回覆: <Claude 的問題>`
3. **訊息不含時間** — Slack 本來就在每則訊息旁邊有時戳,沒必要重複
4. **空 session 靜默** — Stop 在「沒有可萃取的 user prompt 又沒標題」時跳過,不送空的 `已解決`(預設沒裝 SessionEnd,所以也不會有 `已結束 by solomon/Untitled` 這種噪音)
5. **標題用你看到的那個** — 訊息結尾的 `<project>/<title>`,title 優先讀 Claude Desktop 的即時標題(側邊欄顯示、rename 對話框編輯的那個),存在 `~/Library/Application Support/Claude/claude-code-sessions/**/local_*.json` 的 `title` 欄位。讀不到(CLI / Linux 無此路徑)才退回 transcript 的 `ai-title`。⚠️ transcript 的 `ai-title` 是早期自動生成、寫入後就凍結、**不會跟 rename**,所以不能當主來源
6. **subagent 不會通知** — hook 只註冊在主 agent 的 `Stop`,加上 transcript 路徑含 `/subagents/` 的防呆,workflow 內部 subagent stop 一律靜默
7. Stop 有 dedupe:如果這輪你用 `/slack-notify` 手動發過訊息,Stop 會自動跳過避免雙重通知
8. **沒有 idle 60s 提醒** — Notification hook 預設不註冊(它跟 Stop 同時觸發只會重複)。要的話自己加 `Notification` 進 Step 5 的 `events` list 並重跑
9. 失敗時:錯誤**只**寫進 `~/.claude/scripts/slack-notify-hook.log`,**不會**印到 Claude Code 對話裡。這是刻意設計 — Stop hook 用 exit 2 surface 錯誤會造成無限 loop(Stop 被 block → Claude 繼續 → 又結束 → Stop 又被 block …)。要看失敗就 `tail -f` log。日後想要被動提醒可以加一個 SessionStart hook 在新 session 開始時印「上次以來有 N 條失敗」

### 8. (可選)解除安裝指引

如果使用者之後想關掉 hook:

```bash
# 移除 settings.json 的 hooks 區塊
python3 <<'PY'
import json, pathlib
p = pathlib.Path.home() / '.claude' / 'settings.json'
cfg = json.loads(p.read_text())
removed = []
for event in ['Stop', 'Notification', 'SessionEnd']:  # cover Notification too in case user previously enabled it
    if event not in cfg.get('hooks', {}):
        continue
    cmd = f'python3 ~/.claude/scripts/slack-notify-hook.py {event}'
    entries = cfg['hooks'][event]
    new_entries = []
    for entry in entries:
        kept_hooks = [h for h in entry.get('hooks', []) if h.get('command') != cmd]
        if kept_hooks:
            new_entries.append({**entry, 'hooks': kept_hooks})
    if new_entries:
        cfg['hooks'][event] = new_entries
    else:
        del cfg['hooks'][event]
    removed.append(event)
if not cfg.get('hooks'):
    cfg.pop('hooks', None)
p.write_text(json.dumps(cfg, indent=2) + '\n')
print('removed:', removed)
PY

# (可選)刪 helper script
rm ~/.claude/scripts/slack-notify-hook.py
```

---

## 完成判定

對照 `./check-list.md`,所有項目都打勾才算完成。任一項沒過 → 告知使用者卡在哪、為什麼、建議下一步。

## 失敗時要做的事

1. 從 backup 還原 `~/.claude/settings.json`
2. 列出具體錯誤(Python stderr / Slack API error)
3. 對照下表找 fix:

| 症狀 | 原因 | Fix |
|---|---|---|
| `cannot read slack-notify config` | `~/.claude.json` 缺 `mcpServers.slack-notify` 或 env 不完整 | 跑 `slack-notify--deploy` 修 |
| `slack api error: not_in_channel` | Bot 沒被 invite 進 channel | Slack 該 channel 跑 `/invite @<bot>` |
| `slack api error: channel_not_found` | `SLACK_CHANNEL_ID` 拼錯 / 換 workspace 了 | 重新複製 channel ID 進 `~/.claude.json` |
| `slack api error: invalid_auth` | Token 失效 | Slack App OAuth & Permissions → Reinstall to Workspace,拿新 token |
| `slack api error: missing_scope` | 漏 `chat:write` | OAuth & Permissions 補 `chat:write` 並 Reinstall |
| Hook 完全沒觸發 | 沒重啟 Claude Code | 完全 quit 再開 |
| Hook 觸發但 Slack 沒收到 | 看 `~/.claude/scripts/slack-notify-hook.log` 最後幾行 | 依錯誤訊息對應上表 |

## 安全性

- 不在這個 skill 處理 token — token 已經在 `~/.claude.json` 由 `slack-notify--deploy` 寫入
- log file 可能含 channel ID + ts,但不含 token,**檔案權限預設 644**;若敏感請使用者自行 `chmod 600`
- 引用 token / channel ID 時用 prefix(`xoxb-3374...`、`C0B7...`),不印完整字串
