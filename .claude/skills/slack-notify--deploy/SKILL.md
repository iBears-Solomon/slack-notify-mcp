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

- 機器上已有 slack-notify-mcp 的 repo(本身在 repo 內,或在其他位置都可以 — Step 1 會自動定位)
- 使用者有管理權的 Slack workspace(至少能建立 App / 安裝 App)
- 已安裝 Node.js 18+(`node --version`)
- 已安裝 Claude Code(這個 skill 設定的 MCP 是給它用的)

如果任一前置條件不滿足:**先告知使用者再決定要不要繼續**,不要嘗試自動安裝 Node 或 Claude Code。

> 💡 這個 skill 可以從**任何位置**執行 — 包含本 repo 內 (`<repo>/.claude/skills/...`) 或使用者裝在 user-level (`~/.claude/skills/...`) 的副本。Step 1 會找到 repo 實體位置。

---

## Steps

### 1. 定位 repo + 讀取專案文件,建立內部知識

#### 1a. 找到 repo 實體位置

按以下順序找,**第一個找到就用**:

```bash
# 嘗試 1: cwd 本身就是 repo
test -f ./slack-notify.js && test -f ./README.md && test -f ./SETUP.md && pwd

# 嘗試 2: cwd 是 repo 子目錄(往上 git rev-parse)
git -C . rev-parse --show-toplevel 2>/dev/null

# 嘗試 3: 常見位置(逐一檢查)
for d in ~/slack-notify-mcp ~/.local/share/slack-notify-mcp ~/src/slack-notify-mcp ~/repos/slack-notify-mcp ~/code/slack-notify-mcp; do
  [ -f "$d/slack-notify.js" ] && echo "$d" && break
done

# 嘗試 4: 全部失敗 → 詢問使用者
```

確認方式:目標目錄必須**同時**有 `slack-notify.js`、`README.md`、`SETUP.md`。其他都不算數。

若四步都失敗,**詢問使用者**:「我找不到 slack-notify-mcp 的本地副本。如果你還沒 clone,執行 `git clone https://github.com/iBears-Solomon/slack-notify-mcp.git ~/slack-notify-mcp`;如果已 clone,請告訴我絕對路徑。」

#### 1b. 讀取文件

從上面定位到的 repo 路徑讀取**權威來源**,後續所有步驟以此為準,不要依靠記憶或外部推測:

```text
<repo>/README.md     # 概覽、tool schema、env var 規範
<repo>/SETUP.md      # 完整 SOP、scope 設定、troubleshooting
```

讀完後,**用一句話告訴使用者你抓到的版本與 repo 路徑**(例 "已讀 v2.0.0 @ ~/slack-notify-mcp,目前 channel 走 SLACK_CHANNEL_ID env var,單一 chat:write scope"),確認文件未過期。

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

問四件事(用 AskUserQuestion 一次問完):

1. **要新增 entry 還是修改既有 entry?**
   - 「新增」:給新的 entry 名字(預設 `slack-notify`,如已存在則建議 `slack-notify-<suffix>`)
   - 「修改」:列出既有 slack-related entry 讓使用者選

2. **目標 channel ID?**
   - 如使用者不知道,引導他:Slack 桌面版右鍵 channel → Copy link → URL 結尾的 `CXXXXXXXX`
   - 提醒他必須先 `/invite @你的Bot` 進該 channel(這一步無法用 API 代勞)

3. **目標 channel name?**(去掉 `#` 前綴的純名字,例 `solomon-test` / `releases` / `alerts`)
   - 這個會寫進 `SLACK_CHANNEL_NAME`,給 slack-notify skill 在多 instance 場景下做 disambiguation 用
   - 也會出現在工具描述與發送成功訊息(`Sent. channel=#xxx`)
   - 建議和 Slack 上**實際**頻道名一致,維護心智模型一致;但技術上你可以填任何辨識用字串
   - 如果使用者不知道、跟 channel ID 一起教他在 Slack 桌面版查看 channel 名

4. **Bot token 在哪?**
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
        'SLACK_CHANNEL_NAME': '<CHANNEL_NAME>',
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
SLACK_BOT_TOKEN=<TOKEN> SLACK_CHANNEL_ID=<CHANNEL_ID> SLACK_CHANNEL_NAME=<CHANNEL_NAME> npm test
```

預期 `ALL PASS`(5 個情境:happy + missing-channel-id + missing-bot-token + missing-channel-name + missing-all)。如果 happy-path fail:

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

### 9. 詢問是否把 `slack-notify` skill 部署到 user-level

到這一步,MCP 已經設定完成。但「**發訊息**」這個動作目前還沒有對應的 skill 自動化 — Claude 仍然需要使用者每次清楚地說工具名/channel 才會發。

**`slack-notify` skill**(`<REPO>/.claude/skills/slack-notify/`)就是補這個缺:它會掃 `~/.claude.json` 找到所有 slack-notify instance,單一直接送、多個依使用者指定的 channel name/id 自動選或詢問。

> 📝 **這一步要部署的是 `slack-notify` skill(發訊息用),不是 `slack-notify--deploy` skill(設定用)。** Deploy skill 留在 repo 內就好,因為它本來就只在「要設定/變更 MCP」時用得到。

問使用者(用 AskUserQuestion):「要不要把 **slack-notify** skill 複製到 `~/.claude/skills/slack-notify/`?這樣以後在任何專案下,跟 Claude 說『發 X 到 #xxx』時都會自動觸發。」

選項:

- **Yes, install/update** — 複製 SKILL.md + check-list.md 到 user-level
- **No, keep repo-local** — 跳過,使用者只在本 repo 內可用該 skill

#### 9a. 若同意,執行複製

```bash
# 偵測目標是否已存在,顯示給使用者(知道是 install 還是 update)
TARGET=~/.claude/skills/slack-notify
if [ -d "$TARGET" ]; then
  echo "user-level slack-notify skill 已存在,本次將覆蓋更新"
  ls -la "$TARGET"
else
  echo "首次安裝 slack-notify skill 到 user-level"
fi

mkdir -p "$TARGET"
cp -p <REPO>/.claude/skills/slack-notify/SKILL.md "$TARGET/SKILL.md"
cp -p <REPO>/.claude/skills/slack-notify/check-list.md "$TARGET/check-list.md"

# 驗證
echo "--- 安裝後狀態 ---"
ls -la "$TARGET"
echo "--- frontmatter ---"
head -10 "$TARGET/SKILL.md"
```

#### 9b. 確認結果並提醒

- 確認 `$TARGET` 下確實有兩個檔案 (SKILL.md + check-list.md),大小非 0
- 告訴使用者:「下次在任何 Claude Code session,跟 Claude 說『發 X 到 slack』(或指定 channel)就會走 slack-notify skill,自動找對 instance 發送。」
- **提醒**:user-level skill 是當下時間點的快照。**repo 內 SKILL.md 更新時不會自動同步** — 想升級就重跑這個 deploy skill 的 Step 9。
- 如果使用者選 No:告訴他之後想裝可以手動 `cp -r <repo>/.claude/skills/slack-notify ~/.claude/skills/`,或重跑 deploy skill 跳到 Step 9。

> 💡 **想連 `slack-notify--deploy` 也裝到 user-level?** 一般沒必要 — 你只會在這個 repo 工作時改設定,在 repo 內就讀得到 deploy skill。但如果你希望「從任何地方都能新增 channel entry」,可以額外:`cp -r <repo>/.claude/skills/slack-notify--deploy ~/.claude/skills/`。

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
