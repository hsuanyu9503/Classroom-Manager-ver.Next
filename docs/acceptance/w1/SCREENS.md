# W1 實際畫面（驗收用）

> - **產生的版本**：`ce5734ab301a9ca94403b43d0326aa9bc3461743`（分支 `claude/w1-ui-refresh`，工作目錄乾淨）。這是**新版介面**（2026-11-27），已包含 WEB5-REV-001 的修正。
>   - 先前的截圖保留在 git 歷史中：`cb601bb`（修正前）、`2661dd2`（改版前）。
>   - 上游 API：`1e20989`。
> - **產生的方式**：`npm run screens -- --upstream <path>`（`test/screens.mjs`）。
>   - 真正的頁面、真正的 Auth／Firestore Emulator、固定版本的受控 API；Playwright 1.63.0 的 Chromium，deviceScaleFactor 1；作者在 Linux 執行，2026-11-27。
>   - 每個流程都從全新的虛構世界開始。
> - **故障注入**（08、09）：使用與 `test/e2e.mjs` 相同的**測試專用**故障代理；網頁本身沒有任何測試按鈕。
> - 36 張截圖都沒有水平溢出；頁首都有「虛構資料｜暫定色票」（`manifest.json`）。
> - 色彩是**暫定色票**，不是正式決定（Q-2）；本次改版的樣式也**沒有**經負責人核准。
## S-ROSTER-A17：P1 名冊（座號、狀態代碼）與摘要

**手機 390×844**

![S-ROSTER-A17：P1 名冊（座號、狀態代碼）與摘要（手機 390×844）](screens/01-roster-a17-phone-390x844.png)

**平板 820×1180**

![S-ROSTER-A17：P1 名冊（座號、狀態代碼）與摘要（平板 820×1180）](screens/01-roster-a17-tablet-820x1180.png)

**桌面 1440×900**

![S-ROSTER-A17：P1 名冊（座號、狀態代碼）與摘要（桌面 1440×900）](screens/01-roster-a17-desktop-1440x900.png)

**課堂橫向 1024×768**

![S-ROSTER-A17：P1 名冊（座號、狀態代碼）與摘要（課堂橫向 1024×768）](screens/01-roster-a17-classroom-1024x768.png)

## S-LEAVE-SC01：初始（LV-007 上午 v5）

**手機 390×844**

![S-LEAVE-SC01：初始（LV-007 上午 v5）（手機 390×844）](screens/02-leave-initial-phone-390x844.png)

**平板 820×1180**

![S-LEAVE-SC01：初始（LV-007 上午 v5）（平板 820×1180）](screens/02-leave-initial-tablet-820x1180.png)

**桌面 1440×900**

![S-LEAVE-SC01：初始（LV-007 上午 v5）（桌面 1440×900）](screens/02-leave-initial-desktop-1440x900.png)

**課堂橫向 1024×768**

![S-LEAVE-SC01：初始（LV-007 上午 v5）（課堂橫向 1024×768）](screens/02-leave-initial-classroom-1024x768.png)

## S-LEAVE-SC01：確認對話框

**手機 390×844**

![S-LEAVE-SC01：確認對話框（手機 390×844）](screens/03-leave-confirm-phone-390x844.png)

**平板 820×1180**

![S-LEAVE-SC01：確認對話框（平板 820×1180）](screens/03-leave-confirm-tablet-820x1180.png)

**桌面 1440×900**

![S-LEAVE-SC01：確認對話框（桌面 1440×900）](screens/03-leave-confirm-desktop-1440x900.png)

**課堂橫向 1024×768**

![S-LEAVE-SC01：確認對話框（課堂橫向 1024×768）](screens/03-leave-confirm-classroom-1024x768.png)

## S-LEAVE-SC01：成功（完成，全天 v6，收據）

**手機 390×844**

![S-LEAVE-SC01：成功（完成，全天 v6，收據）（手機 390×844）](screens/04-leave-done-phone-390x844.png)

**平板 820×1180**

![S-LEAVE-SC01：成功（完成，全天 v6，收據）（平板 820×1180）](screens/04-leave-done-tablet-820x1180.png)

**桌面 1440×900**

![S-LEAVE-SC01：成功（完成，全天 v6，收據）（桌面 1440×900）](screens/04-leave-done-desktop-1440x900.png)

**課堂橫向 1024×768**

![S-LEAVE-SC01：成功（完成，全天 v6，收據）（課堂橫向 1024×768）](screens/04-leave-done-classroom-1024x768.png)

## 兩個分頁：後送出的分頁顯示「衝突」，舊內容標示為不是最新

**手機 390×844**

![兩個分頁：後送出的分頁顯示「衝突」，舊內容標示為不是最新（手機 390×844）](screens/05-conflict-phone-390x844.png)

**平板 820×1180**

![兩個分頁：後送出的分頁顯示「衝突」，舊內容標示為不是最新（平板 820×1180）](screens/05-conflict-tablet-820x1180.png)

**桌面 1440×900**

![兩個分頁：後送出的分頁顯示「衝突」，舊內容標示為不是最新（桌面 1440×900）](screens/05-conflict-desktop-1440x900.png)

**課堂橫向 1024×768**

![兩個分頁：後送出的分頁顯示「衝突」，舊內容標示為不是最新（課堂橫向 1024×768）](screens/05-conflict-classroom-1024x768.png)

## 衝突後按「重新讀取」：顯示最新內容（全天 v6），更正按鈕停用

**手機 390×844**

![衝突後按「重新讀取」：顯示最新內容（全天 v6），更正按鈕停用（手機 390×844）](screens/06-conflict-reread-phone-390x844.png)

**平板 820×1180**

![衝突後按「重新讀取」：顯示最新內容（全天 v6），更正按鈕停用（平板 820×1180）](screens/06-conflict-reread-tablet-820x1180.png)

**桌面 1440×900**

![衝突後按「重新讀取」：顯示最新內容（全天 v6），更正按鈕停用（桌面 1440×900）](screens/06-conflict-reread-desktop-1440x900.png)

**課堂橫向 1024×768**

![衝突後按「重新讀取」：顯示最新內容（全天 v6），更正按鈕停用（課堂橫向 1024×768）](screens/06-conflict-reread-classroom-1024x768.png)

## S-DENY：一般的「無法存取」

**手機 390×844**

![S-DENY：一般的「無法存取」（手機 390×844）](screens/07-deny-phone-390x844.png)

**平板 820×1180**

![S-DENY：一般的「無法存取」（平板 820×1180）](screens/07-deny-tablet-820x1180.png)

**桌面 1440×900**

![S-DENY：一般的「無法存取」（桌面 1440×900）](screens/07-deny-desktop-1440x900.png)

**課堂橫向 1024×768**

![S-DENY：一般的「無法存取」（課堂橫向 1024×768）](screens/07-deny-classroom-1024x768.png)

## ［故障注入］提交已發生但回應遺失：「尚未確認」與「查詢結果」「重新送出同一操作」

**手機 390×844**

![［故障注入］提交已發生但回應遺失：「尚未確認」與「查詢結果」「重新送出同一操作」（手機 390×844）](screens/08-unknown-phone-390x844.png)

**平板 820×1180**

![［故障注入］提交已發生但回應遺失：「尚未確認」與「查詢結果」「重新送出同一操作」（平板 820×1180）](screens/08-unknown-tablet-820x1180.png)

**桌面 1440×900**

![［故障注入］提交已發生但回應遺失：「尚未確認」與「查詢結果」「重新送出同一操作」（桌面 1440×900）](screens/08-unknown-desktop-1440x900.png)

**課堂橫向 1024×768**

![［故障注入］提交已發生但回應遺失：「尚未確認」與「查詢結果」「重新送出同一操作」（課堂橫向 1024×768）](screens/08-unknown-classroom-1024x768.png)

## ［故障注入］之後身分失效、重送被拒：「先前的送出結果尚未確認，目前無法存取」

**手機 390×844**

![［故障注入］之後身分失效、重送被拒：「先前的送出結果尚未確認，目前無法存取」（手機 390×844）](screens/09-unknown-denied-phone-390x844.png)

**平板 820×1180**

![［故障注入］之後身分失效、重送被拒：「先前的送出結果尚未確認，目前無法存取」（平板 820×1180）](screens/09-unknown-denied-tablet-820x1180.png)

**桌面 1440×900**

![［故障注入］之後身分失效、重送被拒：「先前的送出結果尚未確認，目前無法存取」（桌面 1440×900）](screens/09-unknown-denied-desktop-1440x900.png)

**課堂橫向 1024×768**

![［故障注入］之後身分失效、重送被拒：「先前的送出結果尚未確認，目前無法存取」（課堂橫向 1024×768）](screens/09-unknown-denied-classroom-1024x768.png)
