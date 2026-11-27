# HANDOFF｜目前工作與交接狀態

## 目前狀態（2026-11-28，第二批：Firebase 實際模式）

- 目前任務：**Firebase 實際模式**（負責人指示）：
  - Cloud Firestore 加上 Firebase Authentication（Google）；
  - 受控 API 驗證**真實**的 Firebase ID token；
  - 第一個可完整操作的版本。
- 分支 `claude/firebase-real-mode`，從 PR #6（`002e667`，模擬登入，**尚未合併**）接續。基準 `main` `7958af3`：PR #5 已合併，含 R1 的修正 `ff9ea2d`；PR #4 已合併。
- 上游 `class-management-next` **沒有修改**：受控 API 的業務邏輯以 `1e20989` 的逐字複本放在 `server/upstream/`，由 `npm test` 核對 SHA-256，也與上游 git 歷史逐字比對。

### 第二批改了什麼

| 部分 | 內容 |
|---|---|
| API 位置 | `server/`：受控 API 移到本 repository。授權、請求格式、交易／版本／operationId／收據，都是上游逐字複本；只 fork 憑證、端點、token 驗證這一層 |
| 兩種模式 | `CMN_API_MODE=emulator｜firebase`。真實模式：專案 ID 要輸入兩次；拒絕 `demo-`；設有 `*_EMULATOR_HOST` 就拒絕；只能連該專案的 Firestore 文件與 `accounts:lookup` |
| 真實 token 驗證 | `server/token-firebase.mjs`：RS256、Google 憑證、`iss`／`aud`／`sub`／時間；`accounts:lookup` 確認帳號存在、未停用、未撤銷（`auth_time` 與 `validSince` 比較，同 Admin SDK） |
| API 自己的憑證 | `server/credentials.mjs`：負責人的 ADC（authorized_user）或 metadata；**拒絕服務帳戶金鑰檔** |
| Firestore Rules | `firestore.rules`：用戶端一律拒絕 |
| 開通帳號 | `server/admin.mjs`：bind／unbind／list／seed-fictional；只由負責人執行，有稽核；沒有自助加入，也沒有第一位管理員 |
| 真實模式執行 | `server/main.mjs`：網頁與 API 在 `localhost:18400`；`signInWithPopup`；CSP 只多允許 Google 登入的主機 |
| 頁面 | 永遠顯示目前班級；「尚未取得班級存取權」畫面顯示 UID（供負責人 `bind`） |
| 啟動器 | Emulator 的 stack 改用**本 repository 的 API**（emulator 後端），前後仍是上游的 trace proxy，所有既有的驗收照舊 |

### 操作

- **模擬登入（Emulator）**：`docs/LOGIN.md`。
- **真實 Google 登入（開發用專案）**：`docs/SETUP-FIREBASE.md`，需要負責人先完成 Console 設定。

### 測試（作者，Linux，`3e04316`，工作目錄乾淨）

| 類別 | 結果 | 說明 |
|---|---|---|
| `npm test` | **75/75** | 含模式防護 12 項、憑證 5 項、真實 token 驗證：偽造、未簽章、錯誤的 key、過期、其他專案、停用、撤銷、無法連線；URL 白名單；逐字複本的雜湊與上游 git 比對（`CMN_UPSTREAM_ROOT`） |
| `e2e-login`（模擬登入） | **17/17** | L1～L13；L14 用戶端以自己的 token 直接寫 binding、membership 或讀資料都 403（本 repository 的 rules），沒有開通的 API 路由，偽造的 `principalId`／`role` 欄位 403；L15 管理腳本開通與撤銷 |
| `firebase-mode`（真實模式程式路徑，Emulator） | **5/5** | `firebase` 後端：以測試金鑰簽章的 RS256 token；Emulator 的未簽章 token 被拒；交易規則（同一操作得到同一收據、內容不同→`OPERATION_REUSE_MISMATCH`、舊版本→`VERSION_CONFLICT`、只有 1 筆 revision、點名不變）；帳號停用、撤銷、binding 停用。**不是**真實 Google |
| `e2e`（測試情境） | 21/21 | 改用本 repository 的 API 之後，原本的 11 項驗收照舊 |
| `screens` | 36/36 | |
| `launcher:test` | 4/4 | |
| Mutation | 4 個都抓到 | 拿掉清除 → 3 項失敗；拿掉 UID 綁定 → L10 失敗；拿掉 403 的重新檢查 → L12 失敗；拿掉簽章檢查 → 單元測試 2 項失敗 |

- **未執行**：
  - **真實 Google 登入與真實 Cloud Firestore**：需要負責人的開發用專案與 ADC，見下方；
  - Windows 上的新測試；
  - 多裝置使用：需要部署。
- `main.mjs` 的防護已實際確認：缺設定、專案不一致、缺 web config、設有 emulator 變數，都會 `REFUSED`。

### 待負責人操作（`docs/SETUP-FIREBASE.md`）

1. 建立開發用 Firebase 專案：
   - Firestore 以正式版模式建立；
   - 啟用 Google 登入；
   - 確認授權網域有 `localhost`；
   - 註冊網頁應用程式，把公開設定存成 `dev/firebase-web-config.json`。
2. 安裝 gcloud，然後執行 `gcloud auth application-default login` 與 `set-quota-project`。
3. 執行 `node server\admin.mjs seed-fictional ...` → `node server\main.mjs` → 用自己的 Google 帳號登入 → 看到 UID → `node server\admin.mjs bind --uid <UID> --principal ACTOR-SC01-TEACHER` → 按「重新檢查」。
4. 回報結果（SETUP-FIREBASE.md 第 D 節）。

### 缺口與待決（SPEC §12.8）

- **G-A**：沒有「我的班級」API；目前以 W1 的固定目標詢問 API。
- **G-B**：沒有管理介面。
- **G-C**：多裝置使用需要部署：Hosting、Cloud Run、Blaze，需要負責人同意。
- L-1（建議：管理腳本）、L-3（真實模式的 CSP 例外，已實作，待核准）、L-4（開發用專案）。

## 第一批：Google 登入（模擬；PR #6）

### 本批改了什麼

| 部分 | 內容 |
|---|---|
| 頁面 | 登入閘門：未登入／確認中／尚未取得班級存取權；帳號列與登出；只顯示 API 允許的班級；每次請求附上**登入者自己的** ID token |
| 帳號變更 | 登出或切換帳號時清除 DOM 中所有前一位使用者的資料；遲到的回應丟棄；尚未確認的操作綁定 UID：不會用其他帳號查詢或重送，同一帳號重新登入後恢復 |
| 失效與撤銷 | 讀取被拒時先 `reload()` 並重新取得 token：帳號停用或登入失效 →「登入已失效」；授權被撤銷 →「尚未取得班級存取權」；不會停在載入中 |
| 本機代理 | 登入模式**不持有任何 token**，只轉送頁面自己的 `Bearer` token；CSP 只多允許 Auth Emulator 的 origin；測試情境（actor）模式不變 |
| 模擬登入 | 啟動器在 Auth Emulator 建立虛構 Google 帳號（`dev/login-identities.json`），只為設定中有 `grant` 的帳號寫入綁定；開發用的帳號選擇窗 |
| SDK | Firebase Auth 13.3.0，以 `scripts/build-vendor.mjs` 打包到 `web/vendor/`，`npm test` 會核對；不使用 CDN |
| 規格 | SPEC §11（新增），並在 §1、§2.3、§3、§5、§7、§9 標示本批的變更；`docs/LOGIN.md`；真實專案的設定範本 `dev/firebase-web-config.example.json` |

### 如何操作

- `node dev/launcher.mjs --upstream <path> --scenario LOGIN`，詳見 `docs/LOGIN.md`。
- 原本的測試情境（`S-LEAVE-SC01` 等）照舊可以使用。

### 測試（**模擬登入**，不是真的 Google 登入）

- **已通過**（作者，Linux，`f141bcc`，工作目錄乾淨）：
  - `npm run e2e -- --script e2e-login` **15/15**：
    - L1 未登入：沒有任何 API 請求；
    - L2 取消；L3 失敗（Auth 服務無法連線）；
    - L4 沒有綁定的帳號，以及全新帳號：「尚未取得班級存取權」，稽核紀錄顯示以該 UID 被拒，原因 `BINDING_NOT_FOUND`；
    - L5 SC01 只看到 SC01；A17 即使直接請求或偽造 claimedScope 也被拒；所有被允許的請求都是該 Google UID；
    - L6 重新整理後恢復；L7 更正 v6；L8 兩個分頁衝突；L9 同一操作重送；
    - L10 登出時有尚未確認的操作；
    - L11 換帳號（DOM 不殘留）；L12 帳號停用；L13 授權撤銷；
    - 四種尺寸的版面。
  - `npm run e2e`（測試情境）21/21；`npm test` 36/36；`npm run screens` 36/36；`npm run launcher:test` 4/4；LOGIN 情境的啟動與停止：`stack cleanup: CLEAN`。
  - Mutation（各自獨立的目錄）：
    - 拿掉帳號變更時的清除 → 3 項失敗；
    - 拿掉操作的 UID 綁定 → L10 失敗；
    - 拿掉 403 的重新檢查 → L12 失敗，L13 也停在等待。
- **未執行**：
  - **真實 Google 登入**：需要開發用 Firebase 專案與後端變更，見 SPEC §11.6；
  - Windows 上的登入模式；
  - Firefox、Safari；螢幕閱讀器。
- **沿用**：Windows 單元測試 33/33（`c8e4fbd`，之後 `dev/` 有改；登入相關的新測試沒有在 Windows 執行）。

### 待負責人決定與提供（SPEC §11.6～§11.7）

- **L-1** 管理員與初始成員的授權方式。建議：負責人在自己電腦上以命令列寫入綁定，不提供網頁自助加入。
- **L-2** 受控 API 在哪裡執行。建議：負責人的電腦，以 ADC 取得憑證，不存金鑰。
- **L-3** 真實登入的 CSP 例外：`apis.google.com` 等。
- **L-4** 開發用 Firebase 專案。需要提供：
  - `projectId`、Web app 設定（`apiKey`、`authDomain`、`appId`：公開的識別資料）；
  - 在 Console 啟用 Google provider；
  - authorized domains 加入 `localhost`。
  - **不要**提供密碼、服務帳戶私鑰或 client secret。
- 上游的後端變更（驗證簽章 token、存取真實 Firestore、放寬只能 Emulator 的防護）會改動受保護檔案，需要負責人重新核准錨定；等 L-1、L-2 決定後再提出。

## 前一批：W1 新版介面（PR #5，已合併 `7958af3`）

### 這次改了什麼（`web/`；送出規則沒有改）

| 項目 | 改版前 | 改版後 |
|---|---|---|
| 整體版面 | 三張卡片由上而下 | 桌面與課堂橫向（≥1024）：名冊在左、請假紀錄＋送出結果在右（固定在畫面中）；平板、手機：由上而下。只有名冊的情境用較窄的頁面 |
| 摘要 | 7 個同樣大小的格子 | 上排：合計、已到、已登記的大數字；下排：P／R／N／U（只顯示代碼） |
| 名冊 | 表格；手機是一欄的長清單 | 表格；手機改為多欄小卡片（「7 號　N」） |
| 請假紀錄 | 文字清單 | 「涵蓋時段」以醒目的標籤顯示；按鈕上方一行說明現在能不能更正、為什麼 |
| 確認對話框 | 一段文字 | 請假紀錄、「上午 → 全天」、目前版本；說明按下才會送出、點名不會改變 |
| 送出結果 | 標籤＋一句話 | 標籤（✓／!／?／×）＋標題＋說明＋下一步；每種狀態有自己的邊框與暫定顏色；送出後焦點移到結果、畫面捲到結果 |
| 開發說明 | 散在各處（例如「姓名不在受控 API 的回應中」） | 收在最下方「關於這個開發版」；測試情境標示仍然永遠可見 |
| S-DENY | 仍顯示日期選單與停用的按鈕 | 只顯示「無法存取」，沒有日期選單與更正區 |

- 沒有改的部分：凍結的操作、重新送出同一操作、403 的區分、收據查詢、衝突後的鎖定。E2E 的 11 項驗收照舊通過。
- 色彩：只在 `web/tokens.css` 增加暫定值，**沒有**經負責人核准（Q-2）。

### 如何操作

- 照 `docs/acceptance/w1/CHECKLIST.md` 操作（已改成新版的文字與畫面）。
- 合併之前，先在網站 checkout 執行 `git checkout claude/w1-ui-refresh`，再 `git pull`。

### ChatGPT 審查（Reviewed Head `c8e4fbd`）

- 新版介面的方向可以接受，有一項 P2。
- **WEB5-REV-001（P2）**：完成後的文字固定寫「請假紀錄已重新讀取，顯示的是最新內容」，但重新讀取是之後才非同步進行的；讀取中、讀取失敗（503／斷線）或被拒（403）時，這句話不成立。
  - 修正（`ce5734a`）：完成的說明改為依重新讀取的實際狀態顯示：讀取中／成功／失敗。「完成」與收據保留，不會重送，也不會產生新的 operationId。
  - 新增 E2E item 2b × 3：完成後的重新讀取「變慢」「503 後按重試」「403」。
  - 修正前的 `app.js`（`c8e4fbd`）跑這 3 項全部失敗；作者在獨立目錄中執行，單次。
- **非阻擋**：第一次送出就被拒絕的文字，由「沒有送出任何修改」改為「這次更正未獲允許，沒有修改資料。」
- 審查者在 Windows 執行 `npm test`：33/33（`c8e4fbd`）。
- **R1 複審（Reviewed Head `93e3837`）：審查通過，WEB5-REV-001 結案**，沒有新的阻擋項。結論只限 W1 的本機虛構資料範圍；**不是**部署、真實資料或正式視覺驗收。
  - 審查者的驗證：用最新的 `app.js` 加上最小的 DOM／fetch 替身，做 UI 邏輯的隔離測試，延遲回應 200／503／403 三項，結果符合。這**不是**完整的瀏覽器／Emulator E2E。
  - 作者的驗證：Linux E2E 21/21；舊 `app.js` 配上新測試是 18/21。
  - 審查者沒有重跑 `npm test`（本輪沒有改那部分）；前一輪的 Windows 33/33 保留原本的來源版本 `c8e4fbd`。
  - 交負責人決定合併；正式色票與使用感受仍由負責人決定。

### 測試

- **已通過**（作者，Linux，`ce5734a`，工作目錄乾淨）：
  - `npm run e2e` **21/21**：原本的 18 項，加上 2b × 3。
  - `npm test` 33/33。
  - `npm run screens` 36/36：沒有水平溢出，見 `docs/acceptance/w1/SCREENS.md`。
- **沿用**（未受影響）：
  - Windows 單元測試 33/33：審查者 `c8e4fbd`；負責人與審查者 `b935427`。之後 `dev/` 沒有改。
  - lifecycle 3/3：`b5f0cbb`；
  - Ctrl+C CLEAN：`b935427`。
- **未執行**：
  - 新版介面在 Windows 瀏覽器（Edge／Chrome）的實際操作，請負責人照清單操作；
  - Firefox、Safari；實體手機與平板；螢幕閱讀器；
  - `invalid`、`error` 兩個狀態沒有在 E2E 中觸發；`denied`（第一次送出就 403）也沒有在 E2E 中觸發。
- **只經人工檢視**：截圖的版面與文字（作者）。

## W1 驗收：待決事項（2026-11-27 更新）

**沿用既有決定，不重複詢問**：
- Q-1：既有網站的基準，已決定；
- Q-3：Settings，已設定；
- 「沒有權限」與「不存在」的畫面相同；
- 不顯示姓名；
- W1 不做的功能（SPEC §2.3）；
- P／R／N／U 先顯示代碼。

| # | 事項 | 目前作法 | 負責 |
|---|---|---|---|
| Q-2 | 正式色票 | 維持暫定（`web/tokens.css`），頁首標示「暫定色票」 | 負責人 |
| AQ-1 | P／R／N／U 的中文名稱 | 顯示代碼；**不自行猜測** | 負責人 |
| AQ-2 | 假別顯示原始代碼 `SICK-LEAVE` | 顯示代碼；**不自行猜測** | 負責人 |
| AQ-3 | 新版介面的使用感受：版面、摘要的主次、按鈕旁的說明、結果是否好分辨 | 見 `CHECKLIST.md` 第 8 節 | 負責人實際操作 |
| AQ-4 | 送出結果的文字 | 2026-11-27 改寫為較口語的版本，仍是草案（DESIGN §4） | 負責人 |

**PR #4 時觀察到的 4 點，這次的處理**：
1. 按鈕停用卻沒有原因：**已處理**，按鈕上方加一行說明。
2. 手機名冊很長：**已處理**，改為多欄小卡片。
3. 「已登記（P+R+N）」標題換行：平板與課堂橫向已不換行；手機仍會換成兩行，數字不受影響。
4. S-DENY 仍顯示日期選單：**已處理**，無法存取時隱藏日期選單與更正區。

**後續功能**（不在本批，不自行加入）：姓名（需要上游的 `roster.read`）、直接登記出缺席、作業、聯絡簿、成績、座位、正式登入。

**需要負責人決定的業務規則問題**：本批沒有遇到。

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

**ChatGPT 審查（Reviewed Head `02fef5a`）：需修正後複查**

| 編號 | 問題 | 修正 | 證據（作者，Linux） |
|---|---|---|---|
| WEB3-REV-001（P2） | stack 停止時 5 秒到就 `exit(0)`，清理的錯誤也被吞掉：逾時或失敗會被當成正常停止。審查者在 Windows 以 mock 重現：卡住時約 5 秒 exit 0，沒有執行 `up.close()` | `dev/stop.mjs` 判定停止結果：<br>• `CLEAN`：exit 0；<br>• `EMULATORS_GONE`：清理失敗，但事後**確認** Emulator 的 port 已關閉，exit 0，明確分類；<br>• `STOP_TIMEOUT`：exit 4；<br>• `STOP_ERROR`、`CLEANUP_ERROR`：exit 5。<br>stack 以這個結果結束，並寫入結果檔。<br>啟動器只有在四個條件都成立時才算成功：stack 記錄成功、firebase exit 0、沒有升級、port 全關；否則顯示 `stop FAILED` 並以非零值結束 | `stop.test.mjs`：<br>• runStop 8 項；<br>• **真正的** `dev/stack.mjs` 加上注入的故障 6 項：卡住→4、拋錯→5、Emulator 仍在→5、確認已關→0。<br>舊 `stack.mjs`（`02fef5a`）跑同一組測試：6 項整合測試全部失敗，卡住時 exit 0。<br>端對端 mutation：讓清理拋錯，真正的啟動器輸出 `stop FAILED (exit 5; stack: CLEANUP_ERROR …)` |
| WEB3-REV-002（P2） | 清除殘留的指令只憑 `java` 名稱和 port 就 `Stop-Process -Force`，可能終止無關的 Java 服務 | 新增 `dev/leftovers.mjs`：<br>• 列出 W1 port 上的程式（PID、啟動時間、完整命令列）；<br>• 以**精確的參數**判定 `OWNED`：Firestore JAR、`--project_id demo-cmn-s2b2`、這個 checkout 的 `--rules`；或這個 checkout 的 firebase-tools、stack；<br>• `--stop` 在執行的當下重新核對 PID、啟動時間、port、擁有權，只停止一個 PID。<br>`WINDOWS.md` 與測試的提示都改用它 | `leftovers.test.mjs` 7 項：其中「專案名稱的前綴」這個漏洞是測試抓到後才修正的。<br>Linux 實際執行：<br>• 三個 W1 程式都是 OWNED；<br>• 錯誤或缺少啟動時間 → REFUSED；<br>• 模擬「孤兒 Firestore」：OWNED，停止並確認；<br>• 模擬「無關的 Java 在 9150」：NOT_OWNED，拒絕停止，它繼續執行 |

- 本輪測試（作者，Linux，Head `574c354`，工作目錄乾淨）：
  - `npm test` 33/33；
  - `launcher:test` 4/4：A、C 要求 `stack cleanup: CLEAN`；B 要求 stack 記錄的結果是 `CLEAN`（`trigger: launcher gone`）。
- **未執行**：修正後在 Windows 上重跑；Windows 上的 `leftovers.mjs`（PowerShell 的查詢）**只經人工檢視**。

**R1 複審（Reviewed Head `b5f0cbb`）**：WEB3-REV-001、002 的修正可以接受；新增 WEB3-REV-003（P2）。

- **WEB3-REV-003**：`test/stop.test.mjs` 把 `C:\...` 的絕對路徑直接傳給 `--import`；Windows 的 ESM loader 把它當成 `c:` URL scheme，結果 `ERR_UNSUPPORTED_ESM_URL_SCHEME`。審查者在 Windows 的結果是 27/33：6 項真正 stack 的故障注入在載入階段就失敗，沒有執行到停止判定。
  - 修正（`a03af7c`）：改用 `pathToFileURL(...).href`。只改測試，程式沒有改。
  - Linux：33/33（作者）。
  - **R2 收尾審查（Reviewed Head `b935427`）：審查通過**；WEB3-REV-001、002、003 **全部結案**。結論只限本機 W1 的開發與驗收工具。
  - `b935427` 的 Windows `npm test`：
    - **審查者**獨立執行 33/33（0 fail、0 skipped、exit 0）；
    - **負責人**（`git log -1` 確認是 `b935427`）也是 33/33。
    - 6 項真正 stack 的故障注入都實際執行並通過：CLEAN／0、STOP_TIMEOUT／4 兩項、STOP_ERROR／5、CLEANUP_ERROR／5、EMULATORS_GONE／0。
  - `b935427` 的手動 Ctrl+C（負責人，終端紀錄）：`stack: stop CLEAN` → `stopped (exit 0); ports confirmed closed; stack cleanup: CLEAN`。
- **負責人 Windows 第三次執行**（R1 Head `b5f0cbb`）：
  - 原始 JSON：`launcher-win32-20261126T045618Z.json`，由審查者核對；
  - head 完整等於 `b5f0cbbb7e6d3f853588b3c5e77d10b99ada7093`，dirty 是空字串，上游是 `1e20989`，Windows 10.0.26200，Node 26.13.1；
  - A：exit 0、`CLEAN`、沒有 FORCE、所有 port 關閉；
  - B：結果記錄為 `CLEAN`，約 1 秒後所有 port 關閉；
  - final 通過，合計 **3/3**；
  - `leftovers.mjs` 列出模式：`LEFTOVERS none`（截圖）；
  - C（手動 Ctrl+C）在這份 JSON 中是 MANUAL／null；`b5f0cbb` 的 Ctrl+C 沒有驗證。之後在 `b935427` 由負責人驗證（見上）。
  - `a03af7c` 只改測試的 import，啟動器與 stack 都沒有改，所以這次的 3/3 沿用，**來源版本是 `b5f0cbb`**，不回填成 `b935427`。
- 審查者的判定：OWNED 代表命令列符合這套 W1 設定，**不是**密碼學或每次執行專屬的擁有權證明；同一個 checkout 的另一次 W1 執行也會符合。這是使用者明確指定 PID 的本機開發清理工具，不是對抗惡意程序的安全邊界。

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
| 2026-11-26 | ChatGPT → Claude | PR #3 審查（Reviewed Head `02fef5a`）：WEB3-REV-001、002（P2） |
| 2026-11-26 | Claude → ChatGPT | 修正 WEB3-REV-001、002（Head `574c354`）；Linux 33/33、4/4；待 Windows 重跑與複審 |
| 2026-11-26 | ChatGPT → Claude | PR #3 R1（Reviewed Head `b5f0cbb`）：REV-001／002 可以接受；WEB3-REV-003（Windows `--import`）；負責人 Windows 3/3（原始 JSON，對應 `b5f0cbb`） |
| 2026-11-26 | Claude | WEB3-REV-003 修正（`a03af7c`）；Linux 33/33；待 Windows 33/33 |
| 2026-11-26 | ChatGPT → Claude | PR #3 R2（Reviewed Head `b935427`）：審查通過，WEB3-REV-001～003 結案；Windows `npm test` 33/33（審查者、負責人）；負責人 Ctrl+C CLEAN |
| 2026-11-26 | Claude | 只更新文件（HANDOFF、WINDOWS.md）；程式和 `b935427` 相同；交負責人決定合併 |
| 2026-11-26 | 負責人 → Claude | PR #3 合併（`ba1909f`）；W1 操作與畫面驗收準備 |
| 2026-11-26 | Claude | 驗收截圖 36 張（`2661dd2`）、CHECKLIST、待決事項 AQ-1～4；E2E 18/18、單元 33/33（Linux） |
| 2026-11-27 | 負責人 → Claude | 往實作推進：W1 新版介面與操作流程 |
| 2026-11-27 | Claude | 介面改版（`cb601bb`）：E2E 18/18、單元 33/33、截圖 36/36（Linux）；CHECKLIST、DESIGN 更新；交 ChatGPT 審查 |
| 2026-11-27 | ChatGPT → Claude | PR #5 審查（Reviewed Head `c8e4fbd`）：方向可以接受；WEB5-REV-001（P2）；拒絕的文字（非阻擋） |
| 2026-11-27 | Claude | WEB5-REV-001 修正（`ce5734a`）：E2E 21/21、單元 33/33、截圖 36/36（Linux）；舊 app.js 的 2b 全部失敗 |
| 2026-11-27 | ChatGPT → Claude | PR #5 R1（Reviewed Head `93e3837`）：審查通過，WEB5-REV-001 結案 |
| 2026-11-27 | Claude | 只更新 HANDOFF；程式和 `93e3837` 相同；交負責人決定合併 |
| 2026-11-28 | 負責人 → Claude | Firebase／Cloud Firestore 確定；新增 Google 登入；直接實作 |
| 2026-11-28 | Claude | Google 登入（模擬，`f141bcc`）：e2e-login 15/15、E2E 21/21、單元 36/36；L3 PR；待決 L-1～L-4 |
| 2026-11-28 | 負責人 → Claude | 直接實作 Firebase 實際模式（Firestore、Google 登入），不部署、不付費、不用真實資料 |
| 2026-11-28 | Claude | 真實模式（`3e04316`）：npm test 75/75、e2e-login 17/17、firebase-mode 5/5、e2e 21/21；L3 PR；待負責人設定開發用專案 |
