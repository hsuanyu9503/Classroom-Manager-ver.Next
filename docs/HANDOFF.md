# HANDOFF｜目前工作與交接狀態

## 目前狀態（2026-11-25）

- **W1 已合併**：PR #2 由負責人核准，`main` `e11651d`。ChatGPT R1 複審（Reviewed Head `b7458ad`）關閉 WEB2-REV-001／002。
- 目前任務：**Windows 的啟動與停止驗證**（負責人指示，分支 `claude/w1-windows-launcher`）。詳見下方「Windows 啟動器」。
- 上游：受控 API 固定為 `class-management-next` `1e20989`（SPEC §3）；啟動器拒絕其他版本或 `poc/stage2` 有未提交修改的 checkout。
- 內容：
  - `web/`：P1 點名名冊（摘要＋明細）、P2 請假紀錄與「更正為全天」、P4 送出結果（SPEC §4 狀態機）、確認對話框；
  - `dev/`：開發用本機代理（SPEC §3 邊界）、上游檢查、情境世界、啟動器（`npm run dev -- --upstream <path> --scenario <S>`）；
  - `test/`：代理邊界單元測試（`npm test`）、端對端驗收（`npm run e2e -- --upstream <path>`）、啟動器生命週期（`npm run launcher:test -- --upstream <path>`）。

## Windows 啟動器（分支 `claude/w1-windows-launcher`）

- **問題**：停止的方法原本依賴 POSIX 的程序群組與訊號，Windows 沒有這種機制，所以先前原生 Windows 直接拒絕啟動。
- **作法**：停止改用兩個**不需要訊號**、各平台都能用的通道，並保留訊號作為補充：
  1. **停止檔**：啟動器收到 Ctrl+C、Ctrl+Break、SIGTERM，或使用者輸入 `q` + Enter 時，建立一個暫存的停止檔；stack 每 0.3 秒檢查，看到就走正常的停止流程（關閉代理與上游 stack、清除自己擁有的 Emulator 資料）。stack 結束後，`emulators:exec` 自己關閉 Emulator。
  2. **啟動器存活監看**：stack 監看啟動器的 PID；啟動器被直接終止時，stack 自己停止，不會留下仍在監聽的程序。
  3. **升級**：20 秒內沒有結束時，POSIX 送 SIGINT 給整個程序群組；40 秒時，POSIX 送 SIGKILL 給群組、Windows 用 `taskkill /T /F` 終止程序樹。強制停止會明確顯示 `stopped by FORCE` 並 exit 3，不算成功。
- 原生 Windows 的拒絕已移除。
- **Windows 第一次執行（負責人，2026-11-26，Windows 10.0.26200，Node 26.13.1，Head `7916611`）**：
  - A 通過；B 失敗：啟動器被終止後，8080 與 9150 在 90 秒後仍然開著，其他 port 都已關閉。
  - 原因：
    - Windows 上，Node（libuv）把非 detached 的子程序放進「關閉時終止」的 job object，所以啟動器一結束，firebase 也跟著被終止，來不及關閉 Firestore Emulator；
    - firebase-tools 自己以 detached 啟動 Java 版的 Firestore Emulator（`downloadableEmulators.js` 的 `_runBinary`），所以 Java 留了下來；
    - stack 不在這個 job 裡，所以它自己停止，18300～18400 都已關閉。
  - 修正：firebase 在各平台都以 detached 啟動，脫離啟動器的 job；它的輸出改寫到記錄檔，由啟動器轉印到畫面，避免啟動器不在之後寫入斷掉的 pipe。
  - 同一次的第二次執行因為上一次的殘留而無法開始，**不是**新的問題。`docs/WINDOWS.md` 已補上「清除殘留」的步驟。
- **Windows 第二次執行（負責人，2026-11-26，同一台機器，修正後）**：
  - 版本：負責人先執行 `git pull`，取得修正 `16f5555`。修正前 B 必定失敗，這次 B 通過，可以作為輔助判斷；但**沒有**取得 `git log -1` 的輸出。
  - `npm run launcher:test`：**3/3**。
    - A：首頁 200、路徑變體 404、exit 0、沒有 FORCE；
    - B：直接終止啟動器之後，1.0 秒內所有 port 都關閉；
    - final：所有 port 都已關閉。
    - 結果檔：`test-results\launcher-win32-20261126T043553Z.json`（在負責人的電腦上）。
  - 手動 Ctrl+C：`launcher: stop requested (SIGINT)` → `stack: stopping (stop requested)` → firebase 關閉 Firestore、Auth、hub、logging → **`stopped (exit 0); ports confirmed closed`**，沒有 FORCE。
  - 證據形式：負責人提供的**截圖**，不是原始檔。
- 驗證步驟：`docs/WINDOWS.md`。

**測試結果**

- **已通過：作者執行**（Linux 雲端環境，Node 22.23.5）
  - `npm run launcher:test`：4/4。A 用 `q` + Enter，走停止檔通道；B 直接終止啟動器（SIGKILL），走存活監看；C 用 SIGINT；最後確認所有 port 都已關閉。三個案例執行中都確認首頁 200、路徑變體 404。A、B 用的正是 Windows 依靠的兩個通道。
  - Mutation：停用存活監看後，B 失敗，9 個 port 在 90 秒後仍然開著，證明測試能抓到殘留。之後已清除殘留程序。
  - `npm test`：12/12。
  - 修正 B 之後（記錄檔轉印、firebase detached）：Linux 4/4。
- **負責人在 Windows 執行**（截圖）：第一次 A 通過、B 失敗；修正後 3/3，手動 Ctrl+C 也通過。見上方。
- **未執行**
  - Windows 上的 E2E；強制停止（FORCE）與 `taskkill` 升級；
  - macOS、WSL；
  - 升級（FORCE）路徑：Linux 上也沒有觸發。
- **只經人工檢視**：`docs/WINDOWS.md` 的步驟。
- **沒有重跑**：E2E。E2E 不使用 launcher／stack，`world.mjs`、頁面、代理都沒有改。

## W1 實作的待審事項（ChatGPT 第一輪已答覆）

| # | 事項 | 目前作法 | 審查答覆 |
|---|---|---|---|
| W1-Q1 | P／R／N／U 在規格中沒有中文名稱 | 頁面直接顯示代碼；摘要另列「已到（P+R）」「已登記（P+R+N）」 | 可接受；名稱待負責人決定，不自行猜 |
| W1-Q2 | 目標 ID 寫在 `web/app.js` 的 `TARGETS` | 情境設定，不是測資；都是上游 Stage 1 的虛構 ID | 可接受；`/scenario.json` 已明列在 SPEC §3 |
| W1-Q3 | 色彩 | `web/tokens.css` 的**暫定**值，頁首標示「暫定色票」 | 可接受；正式色票仍待 Q-2，未完成正式視覺驗收 |
| W1-Q4 | 啟動器 | **只供開發**；以程序群組停止，結束後確認 port 已關閉 | 可接受；**不等於**跨平台已驗證。PR #2 當時：Windows 明確拒絕啟動。之後的變更見上方「Windows 啟動器」 |

## 第一輪審查的修正（2026-11-25）

| 編號 | 問題 | 修正 | 新增的測試 |
|---|---|---|---|
| WEB2-REV-001（P2，**R1 已關閉**） | 代理先以 `new URL()` 正規化再比對路徑；`/extra/../v1/read`、`#fragment`、absolute-form 會被轉送；`http://[` 造成未捕捉的例外 | 以**原始 request-target 精確比對**允許清單，不解析 URL；處理器的例外回應受控的 500；格式錯誤的 HTTP 回應 400 只關閉該連線；Origin 改為字串精確比對 | `proxy.test.mjs` 新增 3 項：12 種 API 路徑變體、7 種靜態路徑變體、5 種格式錯誤的 target（POST／GET）之後服務仍正常 |
| WEB2-REV-002（P2，**R1 已關閉**） | 衝突後仍保留舊的請假紀錄，「更正為全天」會重新啟用 | 衝突時丟棄舊紀錄並標示「以上內容已不是最新，請先重新讀取」；衝突狀態下不能更正；只有讀取成功才恢復 | E2E item 9b：衝突後、重新讀取之前，以及重新讀取 503、403 之後，按鈕都停用；**強制啟用並點擊**也不開對話框；沒有新的 operationId 或 commit |
| 補強建議 | item 1 只比對算式；狀態標籤只搜尋原始碼 | item 1 改由上游權威狀態算出 P/R/N/U 與每列（座號、狀態）再比較；狀態標籤改由實際呈現的 DOM 判定，只聲明本輪到達的狀態 | — |

**修正有效的證據**（作者在本輪執行）：

- 新的代理測試對 `895e988` 的舊 `proxy.mjs`：路徑變體的 2 項失敗，格式錯誤的那項讓測試程序停住不回應。
  - **R1 審查備註**：複審包中的 `mutation/proxy-tests-on-old-proxy.log` 混雜了兩次執行（舊 proxy 的失敗，加上還原後的 12 pass），**不能**當作完整的 mutation 紀錄。
  - R1 之後重新取得單次紀錄：舊 `proxy.mjs`（`895e988`）搭配 `b7458ad` 的測試，在獨立目錄中執行，加上 60 秒逾時。結果：1～9 通過，10、11 失敗，12 沒有結果，以逾時結束（exit 124）。這只證明新測試能辨識舊缺陷，不是「mutation 全數驗證通過」。
- 新的 E2E 對 `895e988` 的舊 `app.js`：item 9b 失敗（`forcedOpened=true`、commits 2→3、opIds 2→3），在真實瀏覽器與 Emulator 中重現了繞過。

## W1 測試結果

**已通過：作者執行**（Linux 雲端環境；Node 22.23.5、firebase-tools 15.35.0、Playwright 1.63.0 Chromium）

- 第二輪（修正後）：
  - `npm test`：代理測試 12/12；
  - `npm run e2e`：18/18；
  - 啟動器（`S-LEAVE-SC01`）：首頁 200；`/extra/../v1/read` 回應 404；SIGINT 後 ports confirmed closed。
- 第一輪（`895e988`）：
  - 代理測試 9/9；E2E 17/17；啟動器停止測試；
  - SPEC §6.1 第 4 點的上游煙霧檢查（固定版本 `1e20989`）：`check` 通過、`npm test` 20/20、`stage1:all` 通過（Postgres 仍是 `NOT_RUN`）、`s2:test` 198/198；工作區仍乾淨。上游沒有改變，本輪沒有重跑。

**審查者執行**（ChatGPT，Windows／Node 26）：

- 第一輪：`895e988` 的代理測試 9/9；另以自己的探測腳本發現 WEB2-REV-001。
- R1：`b7458ad` 的代理測試 12/12；在原生 Windows 執行啟動器，確認輸出 REFUSED 並 exit 2，沒有進入上游的啟動流程。
- 兩輪都沒有重跑完整的 Emulator E2E、Linux 的啟動器停止測試或上游套件。

**沿用的既有證據**（不是本輪重跑）：見 SPEC §6.1 第 2 點。

**未執行**

- （PR #2 當時）Windows、macOS、WSL 的啟動器與 E2E。原生 Windows 會**拒絕啟動**（R1 由審查者確認）：這是揭露平台限制，**不是**完成 Windows 支援。如果要讓負責人在 Windows 上直接看網站，要先安排相容的啟動與停止驗證，或確認可用的 Linux／WSL 環境；
- Firefox、WebKit；實體手機、平板與螢幕閱讀器；
- `denied`、`invalid`、`error` 三個送出狀態沒有在 E2E 中觸發（標籤只經人工檢視原始碼）；
- 上游需要 Emulator 的套件（`s2:cases`、`s2:b3`、`s2:b4`）：依 SPEC §6.1 第 4 點不例行執行；
- CI：本 repository 還沒有 CI。

**只經人工檢視**

- 截圖中的版面與視覺（DESIGN §7）。

## Settings 核對結果（2026-11-25，Claude 以未認證的 GitHub API 讀取）

| 項目 | 結果 | 依據 |
|---|---|---|
| Ruleset `protect-main`（id 28037705） | `enforcement: active`；目標 `~DEFAULT_BRANCH`（`main`）；**bypass 名單是空的** | `GET /repos/…/rulesets/28037705` |
| 套用在 `main` 的規則 | `deletion`（禁止刪除）、`non_fast_forward`（禁止強制推送）、`pull_request`：`required_approving_review_count: 0`（要求走 PR，**不**表示需要一位 reviewer 的 Approve）、`dismiss_stale_reviews_on_push: false`、`require_code_owner_review: false`、`require_last_push_approval: false`、`required_review_thread_resolution: false`、`require_extra_approval_for_unattributed_changes: true`（保留 GitHub 預設；核准數是 0 時沒有效果） | `GET /repos/…/rules/branches/main`（Claude 讀取；ChatGPT R2 改以 ruleset 本身確認） |
| Pages | `has_pages: false` | `GET /repos/…` |
| Secret scanning、Push protection | 都是 `enabled` | 同上 `security_and_analysis`（**Claude** 2026-11-25 讀取；ChatGPT R2 的回應中沒有這個欄位，所以**未獨立確認**） |
| Actions 的 workflow 權限 | **無法以公開 API 核對**（需要管理員權限）；依負責人表示已設定 | — |

- 之後加入 CI 時，要在 ruleset 加上「Require status checks to pass」。
- 這些是負責人的設定；Claude 不修改 Settings。

## Settings 建議（負責人設定，Claude 不修改）

- **Pages**：保持關閉（Settings → Pages → Source：None）。本 repository 是 public，W1 不部署。
- **分支保護**（Settings → Rules → Rulesets，目標 `main`）：
  - 需要 PR 才能合併；
  - 禁止強制推送與刪除；
  - 之後加入 CI 時，要求 CI 通過。
- **Actions**（Settings → Actions → General）：
  - Workflow permissions 設為 **Read repository contents**；
  - 不勾選「Allow GitHub Actions to create and approve pull requests」。
- **Secrets**：不需要任何 secret；不要放入 token 或憑證。

## 交接紀錄

| 日期 | 交接 | 內容 |
|---|---|---|
| 2026-11-25 | Claude → ChatGPT | W1 文件 PR（L1）：CLAUDE.md、SPEC、DESIGN、HANDOFF、README |
| 2026-11-25 | 負責人 → Claude | 既有網站只參考功能；顏色等視覺效果依已驗收的準則 → DESIGN D0.2 |
| 2026-11-25 | ChatGPT → Claude | PR #1 審查（Reviewed Head `d54649e`）：範圍、契約、11 項驗收可以接受；WEB-REV-001（P2）：上游回歸的縮減沒有揭露。審查者沒有審查 D0.2（`2663a1a`） |
| 2026-11-25 | Claude → ChatGPT | WEB-REV-001：SPEC §6.1 明寫為相對 v0.4 的**調整**——沿用的既有證據、一定要在本 repository 實測的項目、啟動器整合時的上游煙霧檢查、需要重新評估的情況。DESIGN 補上「關閉對話框不等於放棄操作」 |
| 2026-11-25 | 負責人 → Claude | Q-1：`Homework-manager-` 就是基準 → SPEC §8、DESIGN、CLAUDE.md 更新 |
| 2026-11-25 | 負責人 → Claude | Q-3：Settings 設定完成；Claude 核對（上方） |
| 2026-11-25 | ChatGPT → Claude | PR #1 R1（Reviewed Head `a6e24c4`，已包含 DESIGN D0.2）：WEB-REV-001 關閉，文件草案審查通過 |
| 2026-11-25 | ChatGPT → Claude | PR #1 R2（Reviewed Head `9b268c2`）：維持通過，沒有新的阻擋項；可以交負責人決定合併。非阻擋整理：平板驗收尺寸、SPEC 引用 §7、範本預設與已審查要求分開、日期選擇的範圍、HANDOFF 的 ruleset 欄位、審查歷程、PR 描述 |
| 2026-11-25 | Claude | 完成上述非阻擋整理（DESIGN D0.3）。**目前沒有 CI**（check-runs 是 0），不寫成 CI 通過 |
| 2026-11-25 | 負責人 → Claude | 合併 PR #1，開始實作 W1 |
| 2026-11-25 | Claude → ChatGPT | W1 實作 PR（L3）：網頁、本機代理、啟動器、代理測試、E2E 17/17；待審事項 W1-Q1～Q4 |
| 2026-11-25 | ChatGPT → Claude | PR #2 第一輪（Reviewed Head `895e988`）：WEB2-REV-001、002（P2）；Q1～Q4 答覆；測試補強建議 |
| 2026-11-25 | Claude → ChatGPT | 修正 WEB2-REV-001、002；代理測試 12/12、E2E 18/18；兩項修正都以舊程式重現失敗 |
| 2026-11-25 | ChatGPT → Claude | PR #2 R1（Reviewed Head `b7458ad`）：WEB2-REV-001、002 關閉；可以交負責人決定合併。備註：舊 proxy 的 mutation 紀錄不完整、原生 Windows 只是拒絕、`denied`／`invalid`／`error` 沒有觸發 |
| 2026-11-25 | Claude | 只更新 HANDOFF（記錄 R1 結果；重新取得單次的舊 proxy mutation 紀錄）。程式與測試和 `b7458ad` 相同 |
| 2026-11-25 | 負責人 → Claude | 合併 PR #2（`e11651d`）；補上 Windows 的啟動與停止驗證；上游文件開 PR（class-management-next #23） |
| 2026-11-25 | Claude | Windows 啟動器：停止檔與存活監看；`launcher:test`（Linux 4/4，含 mutation）；`docs/WINDOWS.md`。**Windows 上尚未執行** |
| 2026-11-26 | 負責人 → Claude | Windows 第一次執行：A 通過、B 失敗（Java 版 Firestore Emulator 殘留在 8080／9150） |
| 2026-11-26 | Claude | 修正：firebase 以 detached 啟動、輸出改寫記錄檔；Linux 4/4；待 Windows 重跑 |
| 2026-11-26 | 負責人 → Claude | Windows 第二次執行（修正後）：`launcher:test` 3/3、手動 Ctrl+C 通過（截圖） |
