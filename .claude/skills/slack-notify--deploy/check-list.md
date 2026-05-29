# Checklist

執行 `slack-notify--deploy` 完成後逐項打勾。

## 文件 & 環境

- [ ] 已讀 repo 的 `README.md` 與 `SETUP.md`,並向使用者口頭確認版本未過期
- [ ] Node.js 版本 ≥ 18
- [ ] `~/.claude.json` 存在且為合法 JSON
- [ ] Repo 絕對路徑已確定(寫入 `command` 的值)
- [ ] `slack-notify.js` 有 `+x` 執行位元

## Slack App

- [ ] Bot App 已存在(使用者既有的或新建的)
- [ ] Bot Token Scope **只有** `chat:write`(沒有 `users:read` / `channels:read` / `chat:write.public` 等)
- [ ] Bot 已被 `/invite` 進目標 channel
- [ ] 取得了 `xoxb-...` 開頭的 Bot User OAuth Token
- [ ] 取得了 `C` 開頭的目標 channel ID
- [ ] 取得了人類可讀的 channel name(去 `#` 前綴,例 `solomon-test`)

## Config

- [ ] 寫入前已備份 `~/.claude.json` 到 `.claude.json.bak.<timestamp>`
- [ ] 新增/更新後的 entry 包含四個欄位:`type` / `command`(絕對路徑) / `args` / `env`
- [ ] `env` 同時有 `SLACK_BOT_TOKEN` + `SLACK_CHANNEL_ID` + `SLACK_CHANNEL_NAME`,三者皆非空字串
- [ ] 寫入後重新 `json.load` 驗證,JSON 仍合法

## 驗證

- [ ] `npm test` 顯示 `ALL PASS`(5 情境:happy、missing-channel-id、missing-bot-token、missing-channel-name、missing-all)
- [ ] Slack 端能看到 happy-path 發出的 `mcp-test-<timestamp>` 訊息
- [ ] happy-path 的 server 回應包含 `#<channel-name>`(確認 NAME 有透到 tool 描述與回傳)

## 收尾

- [ ] 已明確告知使用者「必須完全退出 Claude Code 再重開」才能載入新 MCP
- [ ] 已給使用者一個重開後可直接用的測試指令(例「發 hello 到 slack-notify」)
- [ ] Token 沒有在對話以外的地方留下完整字串(commit message / log / 其他檔案皆無)

## 附加元件部署(Step 9 multi-select)

### Multi-select 詢問

- [ ] 已用 AskUserQuestion 多選,選項包含 **Skill /slack-notify** + **Hook (auto-notify)** 兩個,且兩者**預設皆勾**

### Skill 選項(若勾選了)

- [ ] `~/.claude/skills/slack-notify/` 下有 SKILL.md + check-list.md,大小非 0
- [ ] `head -10 SKILL.md` 顯示 `name: slack-notify`(frontmatter 完整)
- [ ] 已告訴使用者「下次在任何 session 跟 Claude 說『發 X 到 slack』會自動走此 skill」

### Hook 選項(若勾選了)

- [ ] 已委派給 `slack-notify--deploy-hook` skill 跑完整流程(不在本 skill 重複 hook 邏輯)
- [ ] `~/.claude/scripts/slack-notify-hook.py` 存在且可執行(`-rwxr-xr-x`)
- [ ] `~/.claude/settings.json` 的 `hooks.Stop` 已註冊到 helper script(預設只裝 Stop;SessionEnd / Notification 不裝)
- [ ] Smoke test 通過:Slack 收到一則自動發送訊息,`~/.claude/scripts/slack-notify-hook.log` 最後一行是 `OK ...`
- [ ] 已告知使用者「必須完全退出 Claude Code 再重開」才會啟用 hook

### 都勾的情境

- [ ] 已說明 Stop dedupe 行為:這輪用過 /slack-notify 就會跳過自動通知,不會雙重發送

### 都不勾的情境

- [ ] 已告知之後想裝可以重跑 deploy skill 到 Step 9,或單獨跑 `slack-notify--deploy-hook`

### 共通提醒

- [ ] 已提醒使用者「user-level 副本是當下快照,repo 更新時不會自動同步」
- [ ] 已提及 `slack-notify--deploy` 與 `slack-notify--deploy-hook` 一般不需安裝到 user-level
- [ ] 已給 hook log 路徑 `~/.claude/scripts/slack-notify-hook.log` 供 troubleshoot 用
