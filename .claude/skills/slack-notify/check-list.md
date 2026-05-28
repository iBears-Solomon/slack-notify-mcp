# Checklist

執行 `slack-notify` 完成後逐項打勾。

## 輸入解析

- [ ] 已從使用者輸入萃取出「訊息內容」
- [ ] 已偵測到使用者是否指定 channel(name 以 `#` 或自然語言,id 以 `C` 開頭 11 碼)
- [ ] 不確定的部分有跟使用者確認,沒有硬猜

## Instance 選擇

- [ ] 已從 `~/.claude.json` 掃出所有 `slack-notify*` entry(排除非 MCP 的同名項)
- [ ] **0 instance**:已引導使用者去跑 `slack-notify--deploy`,**沒有**自己亂建 entry
- [ ] **1 instance**:直接用,**沒有**多餘詢問;若使用者指定的 channel 與 instance 不符,有提示確認
- [ ] **2+ instances**:依使用者指定的 channel name/id 自動匹配;找不到對應就列出選項問

## 發送

- [ ] 用 ToolSearch 載入該 instance 的 `mcp__<entry>__send_message` schema
- [ ] 呼叫時只傳 `text`(+ 必要時 `thread_ts`),沒有試圖傳已被移除的 `channel_id` 參數
- [ ] 訊息超長(> 4,000 字)時有先警告使用者

## 結果回報

- [ ] 成功時告知使用者頻道名 + ts
- [ ] 失敗時把錯誤原文 + SETUP.md 對應 troubleshooting 建議一起給

## 安全

- [ ] 整個流程沒有把 `xoxb-` token 印到任何輸出 / log
- [ ] 沒有把使用者敏感訊息(密碼、key)無意中發到 Slack
