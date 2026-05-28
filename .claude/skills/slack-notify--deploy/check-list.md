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

## Config

- [ ] 寫入前已備份 `~/.claude.json` 到 `.claude.json.bak.<timestamp>`
- [ ] 新增/更新後的 entry 包含三個欄位:`type` / `command`(絕對路徑) / `args` / `env`
- [ ] `env` 同時有 `SLACK_BOT_TOKEN` 和 `SLACK_CHANNEL_ID`,兩者皆非空字串
- [ ] 寫入後重新 `json.load` 驗證,JSON 仍合法

## 驗證

- [ ] `npm test` 顯示 `ALL PASS`(4 情境:happy、missing-channel-id、missing-bot-token、missing-both)
- [ ] Slack 端能看到 happy-path 發出的 `mcp-test-<timestamp>` 訊息

## 收尾

- [ ] 已明確告知使用者「必須完全退出 Claude Code 再重開」才能載入新 MCP
- [ ] 已給使用者一個重開後可直接用的測試指令(例「發 hello 到 slack-notify」)
- [ ] Token 沒有在對話以外的地方留下完整字串(commit message / log / 其他檔案皆無)
