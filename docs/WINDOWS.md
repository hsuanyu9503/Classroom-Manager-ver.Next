# 在 Windows 上啟動、停止與驗證 W1

> 只供開發與驗收。只用虛構測資、只連本機的 Firebase Emulator、**不部署**。
> 狀態：Windows 的啟動與停止**尚未**在 Windows 上驗證。下面的步驟就是驗證的方法；結果請記入 `docs/HANDOFF.md`。

## 1. 需要的軟體

| 軟體 | 版本 | 確認的方式 |
|---|---|---|
| Node.js | 22 以上 | `node -v` |
| Git | 任何近期版本 | `git --version` |
| Java（JDK） | **21 以上**（firebase-tools 15.35.0 的要求） | `java -version` |

沒有安裝的話，可以在 PowerShell 用 winget 安裝；裝完要**關掉 PowerShell 再重新打開**：

```powershell
winget install OpenJS.NodeJS.LTS
winget install Git.Git
winget install EclipseAdoptium.Temurin.21.JDK
```

## 2. 準備兩個 checkout（PowerShell）

路徑可以自己決定；下面用 `C:\cmn` 作例子。

```powershell
mkdir C:\cmn
cd C:\cmn
git clone https://github.com/hsuanyu9503/class-management-next.git cmn-1e20989
cd cmn-1e20989
git checkout 1e20989ea6393c12dd18e11db617873c297a9f4a
cd poc\stage2
npm ci
cd C:\cmn
git clone https://github.com/hsuanyu9503/Classroom-Manager-ver.Next.git
cd Classroom-Manager-ver.Next
git checkout claude/w1-windows-launcher
npm ci
```

- `git checkout claude/w1-windows-launcher`：PR #3 合併**之前**一定要切到這個分支；`main` 上的舊版啟動器在 Windows 會直接拒絕。合併之後就不需要這一行。

- 上游一定要在固定版本 `1e20989`，`poc/stage2` 不能有修改，否則啟動器會拒絕（REFUSED）。
- 第一次啟動 Emulator 時，firebase-tools 會下載 Emulator 的檔案；Windows 防火牆如果詢問，只允許「私人網路」即可（只用 127.0.0.1）。

## 3. 自動驗證：啟動與停止

```powershell
npm run launcher:test -- --upstream C:\cmn\cmn-1e20989
```

| 案例 | 內容 | 通過的條件 |
|---|---|---|
| A | 啟動後輸入 `q` + Enter | exit 0、沒有 FORCE、所有 port 已關閉 |
| B | 直接終止啟動器（不讓它清理） | Emulator 與代理自己停止，所有 port 關閉，沒有殘留 |
| C | Ctrl+C | Windows 不能用程式送出 Ctrl+C，列為 **MANUAL**，見第 4 節 |

- 每個案例執行中都會檢查：首頁回應 200；路徑變體 `/extra/../v1/read` 回應 404。
- 最後一行是 `LAUNCHER_LIFECYCLE ok=true checks=4/4 ...`（C 不計入）。結果 JSON 在 `test-results\launcher-win32-*.json`。

## 4. 手動驗證：Ctrl+C

```powershell
npm run dev -- --upstream C:\cmn\cmn-1e20989 --scenario S-LEAVE-SC01
```

1. 看到 `W1 ready` 後，用瀏覽器打開 http://127.0.0.1:18400/，確認頁面出現。
2. 回到終端機按 **Ctrl+C**。
3. 預期看到 `stopped (exit 0); ports confirmed closed`。
   - 如果看到 `stopped by FORCE`，代表正常停止失敗、改用強制終止，請回報。
   - 如果看到 `REFUSED: ports not confirmed closed`，代表有殘留，請回報該訊息。

停止的方法：Ctrl+C、Ctrl+Break，或輸入 `q` + Enter。重設資料＝停止後重新啟動。

## 5. 選擇性：端對端驗收

```powershell
npx playwright install chromium
npm run e2e -- --upstream C:\cmn\cmn-1e20989
```

最後一行是 `W1_E2E ok=true checks=18/18 ...`。

## 6. 回報

請把以下內容交給 Claude 或 ChatGPT：

- 第 3 節的終端機輸出與 `test-results\launcher-win32-*.json`；
- 第 4 節看到的最後一行；
- （如有執行）第 5 節的最後一行；
- `node -v`、`java -version` 的輸出。

不要附上 `.env`、token 或任何憑證；本流程不需要這些。
