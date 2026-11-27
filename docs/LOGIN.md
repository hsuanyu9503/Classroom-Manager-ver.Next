# Google 登入（本機模擬）：啟動與操作

> - 這是**模擬**登入：使用這台電腦上 Firebase **Auth Emulator** 的 Google provider，帳號都是**虛構**的，不是真的 Google 登入。
> - 規格：`docs/SPEC.md` §11。真實 Google 登入需要的資訊與決定：SPEC §11.6～§11.7。
> - 只用虛構資料，只連本機 Emulator，不部署。

## 啟動

Windows（在 `C:\cmn\Classroom-Manager-ver.Next`；上游 checkout 的準備見 `docs/WINDOWS.md`）：

```powershell
node dev\launcher.mjs --upstream C:\cmn\cmn-1e20989 --scenario LOGIN
```

Linux／macOS：`node dev/launcher.mjs --upstream <path> --scenario LOGIN`

- 看到 `W1 ready` 後，打開 http://127.0.0.1:18400/。
- 終端機會列出可以選的虛構帳號，以及各自是否有班級授權。
- 停止：Ctrl+C。停止後重新啟動，就回到全新的虛構資料與帳號。

## 虛構帳號（`dev/login-identities.json`）

| 帳號 | 授權 | 登入後看到 |
|---|---|---|
| `teacher.sc01@example.test` | 綁定 `ACTOR-SC01-TEACHER` | 班級 CLASS-606-SC01：名冊 1 人、請假紀錄 LV-007，可以更正 |
| `teacher.a17@example.test` | 綁定 `ACTOR-TEACHER` | 班級 CLASS-606-A17：名冊 15 人，只能看 |
| `no-access@example.test` | 沒有 | 「尚未取得班級存取權」 |
| 「新的虛構帳號」 | 沒有 | 「尚未取得班級存取權」：登入**不會**自動取得任何權限 |

## 操作重點

1. 未登入：只有「請先登入」，看不到任何班級資料。
2. 按「使用 Google 登入」→ 在帳號選擇窗選一個帳號。按「取消」或 Esc，會顯示「已取消登入」。
3. 右上角顯示「已登入」與帳號，旁邊是「登出」。
4. 重新整理：仍然是登入狀態（只限這個分頁；關閉分頁就會登出）。
5. 登出：畫面上的班級資料全部清除。
   - 如果有「尚未確認」的送出結果，登出前會先問你；
   - 換成其他帳號時，不會看到、也不會重送那個操作；
   - 用原帳號重新登入後，可以再查詢結果。
6. 更正、衝突、尚未確認、重新送出同一操作：和測試情境的操作相同（`docs/acceptance/w1/CHECKLIST.md` 第 2～3 節），只是先登入 `teacher.sc01@example.test`。
   - 兩個分頁：每個分頁都要各自登入。

## 不是本批的內容

- 真實 Google 帳號登入：需要開發用 Firebase 專案與後端變更，見 SPEC §11.6。
- 管理員畫面、邀請、加入班級：沒有實作，授權方式待負責人決定（SPEC §11.7 L-1）。
