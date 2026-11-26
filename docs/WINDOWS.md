# 在 Windows 上啟動、停止與驗證 W1

> 只供開發與驗收。只用虛構測資、只連本機的 Firebase Emulator、**不部署**。
> **目前的驗證狀態**（詳見 `docs/HANDOFF.md`）：
> - 已在 Windows 驗證（負責人，2026-11-26，Windows 10.0.26200，Node 26.13.1，**截圖**）：`launcher:test` 3/3（A、B、final）、手動 Ctrl+C 正常停止。驗證的是修正 B 之後的版本，但截圖沒有包含 commit SHA。
> - WEB3-REV-001／002 修正之後（Head `b5f0cbb`，負責人，原始 JSON）：`launcher:test` 3/3；`leftovers.mjs` 列出模式顯示 `LEFTOVERS none`。這個版本的手動 Ctrl+C **沒有**驗證。
> - Head `b935427`：Windows `npm test` 33/33（審查者、負責人各自執行）；手動 Ctrl+C 正常停止，`stack cleanup: CLEAN`（負責人）。啟動與停止的 3/3 沿用 `b5f0cbb` 的原始 JSON，這段之後沒有改執行程式。
> - 沒有驗證：Windows 上的 E2E、強制停止（FORCE）與 `taskkill`、macOS、WSL。

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
- 開頭會印出 `HEAD <commit>`，以及工作目錄是否乾淨（`working tree clean`）。
- 最後一行是 `LAUNCHER_LIFECYCLE head=<commit> ok=true checks=3/3 ...`：A、B 和最後的 port 檢查；C 是 MANUAL，不計入。
- A、B 除了 port 都關閉之外，還要求 stack 自己記錄的停止結果是 `CLEAN`。只有 port 關閉不算成功。
- 結果 JSON 在 `test-results\launcher-win32-*.json`，內含 HEAD、工作目錄狀態、平台與 Node 版本。請把**原始 JSON 檔**交回，不只截圖。

### 清除殘留（只有出現 `ports not confirmed closed` 時才需要）

**不要**只憑程式名稱（例如 `java`）或 port 停止程式：你電腦上的其他服務也可能用到這些 port。請用下面這個工具，它只會把**能證明屬於這套 W1 設定**的程式標成 `OWNED`。

1. 列出目前佔用 W1 port 的程式（**這一步不會停止任何東西**）：

   ```powershell
   node dev\leftovers.mjs --upstream C:\cmn\cmn-1e20989
   ```

   每個程式會顯示 port、PID、名稱、啟動時間和完整的命令列，前面標示：
   - `OWNED`：命令列證明它屬於這套 W1 設定。例如 Firestore Emulator 必須同時符合：Firestore Emulator 的 JAR、專案 `demo-cmn-s2b2`，以及**這個**上游 checkout 的 `poc\stage2\firestore.rules`；
   - `NOT_OWNED`：不屬於、或無法確認。**不要停止**，請把畫面回報給 Claude。
   - 如果顯示 `LEFTOVERS none`，表示已經沒有殘留。

2. 只對 `OWNED` 的程式，複製工具印出的那一行指令執行，例如：

   ```powershell
   node dev\leftovers.mjs --upstream "C:\cmn\cmn-1e20989" --stop 12345 --started "2026-11-26T04:35:53.0000000Z"
   ```

   - 執行的當下，工具會**重新核對**：同一個 PID、同一個啟動時間、仍然佔用 W1 的 port、仍然是 `OWNED`。任何一項不符就拒絕（`REFUSED`），什麼都不停止。
   - 成功時會顯示 `stopped PID …` 和 `confirmed: it no longer listens on any W1 port`。

3. 再執行一次第 1 步，確認顯示 `LEFTOVERS none`。

- 也可以直接重新開機。

## 4. 手動驗證：Ctrl+C

```powershell
node dev\launcher.mjs --upstream C:\cmn\cmn-1e20989 --scenario S-LEAVE-SC01
```

這裡直接用 `node` 啟動，不經過 `npm run`：透過 `npm run` 時，按 Ctrl+C 後 Windows 可能會問「終止批次工作 (Y/N)?」，蓋掉最後的訊息。

1. 看到 `W1 ready` 後，用瀏覽器打開 http://127.0.0.1:18400/，確認頁面出現。
2. 回到終端機按 **Ctrl+C**。
3. 預期看到 `stopped (exit 0); ports confirmed closed; stack cleanup: CLEAN`。
   - 如果看到 `stopped by FORCE` 或 `stop FAILED`，代表停止或資料清除沒有正常完成，請回報。
   - 如果看到 `REFUSED: ports not confirmed closed`，代表有殘留：照上面「清除殘留」處理，並回報該訊息。

停止的方法：Ctrl+C、Ctrl+Break，或輸入 `q` + Enter。重設資料＝停止後重新啟動。

## 4b. 單元測試（不需要 Emulator）

```powershell
npm.cmd test
```

最後應該是 `# pass 33`、`# fail 0`。

## 5. 選擇性：端對端驗收

```powershell
npx playwright install chromium
npm run e2e -- --upstream C:\cmn\cmn-1e20989
```

最後一行是 `W1_E2E ok=true checks=18/18 ...`。

## 6. 回報

請把以下內容交給 Claude 或 ChatGPT：

- 第 3 節的終端機輸出與 `test-results\launcher-win32-*.json`（**原始檔**）；
- 第 4 節看到的最後一行；
- （如有執行）第 5 節的最後一行；
- `node -v`、`java -version` 的輸出。

不要附上 `.env`、token 或任何憑證；本流程不需要這些。
