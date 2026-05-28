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

## User-level skill 部署(Step 9)

- [ ] 已詢問使用者要不要把 **`slack-notify` skill**(發訊息用,不是這個 deploy skill)複製到 `~/.claude/skills/slack-notify/`
- [ ] 若使用者同意:`~/.claude/skills/slack-notify/` 下有 SKILL.md + check-list.md,且 frontmatter 完整 (`name: slack-notify`)
- [ ] 若使用者拒絕:已告知之後想裝可以手動 `cp -r <repo>/.claude/skills/slack-notify ~/.claude/skills/` 或重跑 deploy skill 到 Step 9
- [ ] 已提醒使用者「user-level 副本不會跟 repo 自動同步,要升級需重跑此 deploy skill」
- [ ] 已順帶提及 `slack-notify--deploy` 一般不需要安裝到 user-level(只在 repo 內工作時用)
