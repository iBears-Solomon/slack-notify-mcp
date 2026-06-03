# Checklist

執行 `slack-notify--deploy-hook` 完成後逐項打勾。

## 前置 & 環境

- [ ] Repo 絕對路徑已確定,且 `<repo>/hooks/slack-notify-hook.py` 確實存在
- [ ] Python 3 可用(`python3 --version` 不報錯)
- [ ] `~/.claude.json` 存在,且有 `mcpServers.slack-notify` entry,env 包含 `SLACK_BOT_TOKEN` + `SLACK_CHANNEL_ID` + `SLACK_CHANNEL_NAME` 三者皆非空
- [ ] (可選但建議)`~/.claude/skills/common--get-timestamp/SKILL.md` 存在

## Helper script

- [ ] `~/.claude/scripts/` 目錄存在
- [ ] `~/.claude/scripts/slack-notify-hook.py` 存在,內容與 `<repo>/hooks/slack-notify-hook.py` 一致
- [ ] `slack-notify-hook.py` 有 `+x` 執行位元(`-rwxr-xr-x`)

## Settings 註冊

- [ ] 寫入前已備份 `~/.claude/settings.json` 到 `.json.bak.<timestamp>`(若原本不存在則跳過)
- [ ] `~/.claude/settings.json` 的 `hooks` 區塊包含 `Stop` + `Notification`(`SessionEnd` 預設不裝 — 撞名又觸發太頻繁,使用者要才加)
- [ ] 每個 event 都有一筆 `{"hooks": [{"type": "command", "command": "python3 ~/.claude/scripts/slack-notify-hook.py <Event>"}]}`
- [ ] 重複跑此 skill 時,不會重複加同樣的 command(冪等)
- [ ] 寫入後 `json.load` 重讀仍合法
- [ ] 既有 `permissions` / 其他 top-level key 未被破壞

## Smoke test

- [ ] 用 Step 6a 的臨時 transcript 呼叫 `slack-notify-hook.py Stop`,退出 0
- [ ] Slack 目標 channel 收到一則**兩行**訊息:第一行 `已解決: <user prompt>`(或結束於提問時 `待回覆: <question>`)、第二行 `by <project>/<title>`,**不含時間**
- [ ] `~/.claude/scripts/slack-notify-hook.log` 最後一行是 `OK Stop -> Cxxxxx ts=...`
- [ ] 點 Slack 訊息中的 link **能開啟** Claude Code 在該 repo 路徑(開新 session,不是 resume,這是 Claude Code 限制)

## 收尾

- [ ] 已明確告知使用者「必須完全退出 Claude Code 再重開」才會啟用 hook
- [ ] 已說明三個 hook 的行為與觸發時機(每輪結束 / idle 60s / session end)
- [ ] 已說明 Stop dedupe 行為(這輪用過 /slack-notify 就跳過 Stop)
- [ ] 已給使用者解除安裝指引(Step 8),或至少指出怎麼移除
- [ ] log 路徑 `~/.claude/scripts/slack-notify-hook.log` 已告知,方便日後 troubleshoot

## 安全

- [ ] 沒有把 token / 完整 channel ID 印在 log 或對話以外的地方
- [ ] 沒有把 settings.json backup 寫進 git tracked 區域
