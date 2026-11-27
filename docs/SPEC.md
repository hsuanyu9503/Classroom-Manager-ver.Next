# SPEC｜Classroom Manager ver.Next：第一批（W1）功能規格

> 版本：W1-S0.1（草案，待 ChatGPT 審查與負責人核准）　｜　最近更新：2026-11-25
> 來源：`class-management-next` 的 [`docs/WEB-B1-PROPOSAL.md` v0.4](https://github.com/hsuanyu9503/class-management-next/blob/754e3a1c0ec674e57ff36d4af7b45b959f448e5b/docs/WEB-B1-PROPOSAL.md)（PR #22 文件審查通過，main `754e3a1`）。本 SPEC 承接其範圍、契約與 11 項驗收，**不擴張**。
> 負責人的決定（2026-11-24～25）：
> - D-W1：網站在本 repository 製作；
> - D-W2：同意讀取既有規格；
> - D-W3：第一批是點名名冊與請假更正；
> - D-W4～D-W8：依 Claude 的建議，見 §5、§7。
>
> **這不是正式上線的網站**：只用虛構測資，只連本機 Emulator，不部署。

## 1. 背景與定位

- 本 repository 是 Classroom Manager 的下一版網站。~~後端暫定 Firebase（上游 ADR-001）。~~ **2026-11-28 負責人決定：資料庫確定使用 Firebase，以 Cloud Firestore 承接既有資料模型**；新版網站繼續沿用本 repository（§11）。
- 受控 API 與 Firebase Emulator 的技術驗證，在上游 repository `hsuanyu9503/class-management-next` 進行。
  - 第一批只使用其中已驗證的能力，見 §2.1；
  - 這些能力在本機 Emulator 與 hosted 的結果都是 `UNATTESTED`，**不是**正式 PASS。
- 既有網站的基準見 §8。

## 2. 第一批（W1）的範圍：導師的「點名名冊與請假更正」

### 2.1 使用的已驗證能力（上游 Stage 2 的案例）

| 能力 | API | 上游案例 |
|---|---|---|
| 點名名冊與明細（唯讀） | `POST /v1/read`：`attendanceSession.read` | POC-001 |
| 點名摘要計數 | `attendanceSummary.read` | POC-008 |
| 請假摘要（唯讀） | `leaveRecord.read` | POC-009 的讀取部分 |
| 請假更正（上午 → 全天） | `POST /v1/commit` | POC-016、POC-017、POC-018 |
| 回應遺失後查詢收據 | `POST /v1/receipt` | POC-021 |

POC-002（沒有權限與不存在的回應相同）只是**參考案例**：本網站用到的每一條路由，都要在本 repository 的測試中另外驗證（§6 第 6 項）。

### 2.2 頁面與流程

| 頁面／流程 | 使用者看得到什麼 | 使用的 API |
|---|---|---|
| P1 名冊與點名摘要 | 座號、狀態（P／R／N／U）、合計。受控 API **不回傳姓名**（只回傳白名單欄位）；要顯示姓名，需要上游另外決定 `roster.read`（D-09 前停用） | `attendanceSession.read`、`attendanceSummary.read` |
| P2 請假摘要 | 假別、涵蓋的時段（上午／全天）、版本 | `leaveRecord.read` |
| P3 請假更正 | 「上午 → 全天」的確認、送出中、成功（顯示新版本與收據）、衝突、結果尚未確認；規則見 §4 | `/v1/commit` |
| P4 結果尚未確認時的確認 | 以原本的操作查詢收據，或重新送出原本的操作；規則見 §4 | `/v1/receipt`、`/v1/commit` |
| 錯誤畫面 | 沒有權限與資料不存在看起來**一樣** | — |

情境與身分見 §3：請假流程只在 `S-LEAVE-SC01`；`S-ROSTER-A17` 是另一個獨立的唯讀情境。

### 2.3 不在 W1

- 請假適用提示（上游 G-1、G-4）、投影模式（G-9）、敏感備註（G-10）、匯出（D-08）；
- 草稿、離線、共用 iPad 切帳（上游 Stage 4）；
- 名冊管理、成員管理、其他角色；
- 正式登入；**← 本批變更（2026-11-28）**：新增 Google 登入、登出與登入狀態，見 §11。目前只在本機 Auth Emulator 以虛構帳號**模擬**；連到開發用 Firebase 專案的真實 Google 登入，需要的資訊與後端變更見 §11.6。
- 既有網站的功能（作業、聯絡簿、成績、座位等），以及既有網站「請假連動作業」的規則。W1 的資料模型規定請假**不得**自動改寫點名。

## 3. 開發身分與本機服務的契約

受控 API 每一次請求都驗證 Auth Emulator 的 Bearer token，並依權威文件重新授權。測試世界、使用者與 token，由 `class-management-next` 的 `poc/stage2/src/harness.mjs` 的 `seedWorld`／`signIn`／`startStack` 建立。網站沿用這套機制，**不**新增登入功能。

**對接的 API 版本**：
- 固定為 `class-management-next` main `1e20989ea6393c12dd18e11db617873c297a9f4a`（PR #21 合併；受控 API 與判定程式等於已審查的 `f9097dd`，最後受保護版本 `971a7d3`）；
- 啟動器在執行前確認：
  - 該 checkout 的 `git rev-parse HEAD` 等於這個 commit；
  - `poc/stage2` 沒有未提交的修改；
  - 不符就拒絕啟動。
- 要換成其他版本，必須另外送審。

**啟動、測資、重設與停止**：
- 由本 repository 的**開發用啟動器**負責（一個本機 CLI，只在開發者的電腦上執行；不是網頁的功能）：
  1. 檢查 Emulator、受控 API、代理用到的 port 都是關閉的；
  2. 在 `firebase emulators:exec` 中，以 `class-management-next` 的 harness 建立一個**全新**的虛構測試世界：Stage 1 的固定測資；
  3. 啟動 back 代理 → 受控 API → front 代理；
  4. 啟動網站的本機代理（下述）。
- **重設**：停止後重新啟動，就是一個全新的世界。網頁上**沒有**重設的功能。
- **停止**：結束啟動器；Emulator、API 與代理一起關閉；結束後再次確認 port 都已關閉。
- 這些責任屬於開發者／測試程式，不屬於網頁。

**測試情境與身分**：每次啟動只載入**一個**情境，情境名稱顯示在頁面頂端的標示中。

| 情境 | 身分（actor） | 資料 | 可以做的事 |
|---|---|---|---|
| `S-ROSTER-A17` | `ACTOR-TEACHER` | `WS-A17`／`CLASS-606-A17` | P1 名冊與點名摘要（唯讀） |
| `S-LEAVE-SC01` | `ACTOR-SC01-TEACHER` | `WS-SC01`／`CLASS-606-SC01` | P1（該班的名冊）、P2、P3、P4 |
| `S-DENY` | `ACTOR-OTHER` | 沒有任何 membership | 只用於「沒有權限」的測試 |

- 這三個情境是**分開的**執行：
  - 頁面不能把兩個情境拼成同一個班級或同一個身分；
  - 頁面沒有切換身分的功能；
  - 要換情境，必須停止並重新啟動。

**token 的處理**：
- 只有該情境 actor 的一個短期 Auth Emulator token，**只存在本機代理的記憶體中**。代理在轉送時，替請求加上 `Authorization` 標頭。
- **頁面從頭到尾都拿不到 token**：
  - 不寫入 localStorage、sessionStorage、IndexedDB 或 cookie；（**本批變更**：本節「頁面不持有 token、代理附加測試 actor token」只適用於**測試情境**（`S-*`）。登入模式與真實模式由 Firebase SDK 管理登入者自己的登入狀態，代理不持有 token，見 §11.3、§12.3）
  - 不在網址、記錄檔或畫面中出現。
- 頁面送來的 `Authorization` 標頭一律丟棄。
- owner 權限（Emulator 的管理權）、其他 actor 的憑證、密碼，都**不會**進入代理或頁面；它們只留在啟動器的 harness 中。
- 停止啟動器時，token 隨程序結束而消失。Emulator 的 token 大約 1 小時後失效；失效後，所有請求都會得到 `FORBIDDEN`，需要重新啟動。

**本機代理的邊界**：
- 只監聽 `127.0.0.1`。
- upstream 固定為 front 代理（`http://127.0.0.1:18301`），**不**接受任何指定目的地的參數。
- **所有請求**：`Host` 必須是 `127.0.0.1:<port>` 或 `localhost:<port>`，用來防止 DNS rebinding；不符就回 403。
- **靜態檔案的 `GET`／`HEAD`**（v0.4 分開規定）：
  - 只提供本 repository 中允許清單上的靜態檔案（例如 `/`、`/index.html`、`/style.css`、`/app.js`）；不在清單中就 404；
  - 另有一個唯讀的設定端點 `/scenario.json`：只回傳目前的情境代碼（例如 `{"scenario":"S-LEAVE-SC01"}`），**不含** token、身分或測試資料；它不提供切換身分或情境的功能（WEB2-REV Q2）；
  - 路徑以**原始的 request-target 精確比對**，不先做 URL 正規化：dot-segment、fragment、query、absolute-form、編碼變體都不符合，一律 404（WEB2-REV-001；API 的三條路徑同樣適用）；
  - **允許正常的頂層導航**：使用者直接在網址列輸入或開啟書籤時，瀏覽器送出的 `Sec-Fetch-Site` 是 `none`（[W3C Fetch Metadata §2.3](https://w3c.github.io/webappsec-fetch-metadata/#sec-fetch-site-header)），這種請求要正常回應。不對靜態 `GET` 套用 API 的同源限制；
  - 靜態回應**不含** token 或任何測試資料，也**不會**觸發任何 API 呼叫或寫入；
  - 不轉送給 upstream。
- **API 的 `POST`**（限制不因首頁而放寬）：
  - 只接受剛好這三個路徑：`/v1/read`、`/v1/commit`、`/v1/receipt`；
  - `Content-Type: application/json`，請求本體上限 64 KiB；
  - `Origin` **必須存在**，而且等於代理自己的來源；
  - 有 `Sec-Fetch-Site` 時必須是 `same-origin`；
  - 不符就回 403，**不轉送**。
- 其他的方法或路徑一律 404，不轉送。
- 不送出任何 CORS 標頭。
- 上面這些才是存取控制；「不開 CORS」只是其中一項，不能單獨代表完成。
- 殘餘風險：同一台電腦上的其他程序，可以直接呼叫 `127.0.0.1` 的代理。只用虛構測資，不接正式資料（§5），才能接受這一點。

## 4. 送出結果的規則

**前提**：受控 API 會先完成交易（`processCommit`），之後才寫入稽核並送出回應。所以「沒有收到回應」**不**代表「沒有修改」。收據查詢的 `FORBIDDEN`，也**不能**證明交易沒有發生。

1. **固定操作**：
   - 使用者按下確認時，網頁一次產生並**凍結**一個「操作」：`operationId`（UUID v4）與**完整的** command（`expectedVersion`、intent、target、scope 等）。
   - 之後重送一律使用同一個 `operationId` 與同一份 command 內容，不重建、不修改。
2. **送出中**：
   - 送出按鈕停用；
   - 再按一次也只會沿用同一個操作；
   - 不會同時有兩個不同的操作在處理中。
3. **依回應決定狀態**：

| 回應 | 狀態 | 畫面與可以做的事 |
|---|---|---|
| 200 `OK` 加上收據 | 已完成 | 顯示收據與新版本；清除凍結的操作 |
| 409 `VERSION_CONFLICT` | 未修改（衝突） | 依 [`S2B1-AUTHORIZATION.md` §8](https://github.com/hsuanyu9503/class-management-next/blob/754e3a1c0ec674e57ff36d4af7b45b959f448e5b/docs/stage2/S2B1-AUTHORIZATION.md)「提交命令的處理順序」，授權通過之後，會在同一個交易中先檢查收據，所以這次操作**確定沒有寫入**。重新讀取請假摘要並顯示最新內容；使用者**重新確認**後，才建立**新的**操作，帶新的 `expectedVersion`。**不會**自動換版本後覆蓋 |
| 409 `OPERATION_REUSE_MISMATCH` | 錯誤 | 凍結的操作不應該發生這種情況，表示網頁有缺陷。顯示錯誤，保留原操作，不自動重試 |
| 403 `FORBIDDEN`（**第一次**提交） | 不允許 | 這次操作在授權階段就被拒絕，沒有進入交易。顯示一般的「無法存取」；不重試 |
| 403 `FORBIDDEN`（**結果不明之後的重送**） | **結果仍未確認，目前無法存取** | 見第 4 點：保留原操作，**不**視為未提交 |
| 網路錯誤、逾時、連線中斷、5xx、`UNAVAILABLE`（包括 `TRANSACTION_CONTENTION`） | **結果尚未確認** | 持續顯示「結果尚未確認」，**不**顯示「修改未發生」。保留凍結的操作，提供兩個動作：「查詢結果」與「重新送出同一操作」 |

4. **結果尚未確認時**：
   - **查詢結果**：以原 `operationId` 呼叫 `/v1/receipt`。
     - 200：已完成，顯示收據。
     - `FORBIDDEN`、5xx、網路錯誤：**仍然是**「結果尚未確認」，不是「未提交」。
   - **重新送出同一操作**：與原本的請求完全相同。
     - API 會**先**驗證身分並重新授權（`class-management-next` 的 `poc/stage2/src/api/server.mjs`：token 檢查 → `handleCommit` → 授權，被拒絕就直接回 403），**之後**才在交易中檢查收據；
     - 目前身分與授權**仍然通過**，而且操作一致時：已經提交過，就回傳原收據，不會再寫入（[`S2B1-AUTHORIZATION.md` §8](https://github.com/hsuanyu9503/class-management-next/blob/754e3a1c0ec674e57ff36d4af7b45b959f448e5b/docs/stage2/S2B1-AUTHORIZATION.md)「提交命令的處理順序」）；沒有提交過，就依 API 契約處理，可能成功、衝突或被拒絕；
     - **身分或授權已經失效**時（例如 token 過期、membership 被撤銷），重送會得到 `FORBIDDEN`，即使先前其實已經提交。這時畫面顯示「先前的結果尚未確認，目前無法存取」：
       - 保留原本的 `operationId` 與 command；
       - **不**視為未提交，**不**當成成功結案，**不**另建操作；
       - 不自動重試；前端不嘗試繞過授權，也不新增 token 刷新功能（開發情境中要重新啟動，§3）。
   - **絕對不會**自動產生新的 `operationId` 再提交，也不會把查詢失敗當成可以改送新操作的理由。
5. **重新整理或關閉頁面**：
   - W1 的凍結操作**只在頁面的記憶體中**，沒有離線或持久的草稿（上游的 Stage 4）。
   - 有「結果尚未確認」的操作時，離開頁面前會請瀏覽器顯示離開確認。這只是**盡力提醒**：瀏覽器可能不顯示，或使用者可能仍然離開，所以**不能**當成保存未確認操作的保證。
   - 重新整理之後，**無法**自動恢復那個操作。頁面只能重新讀取請假摘要，顯示目前的版本與內容，並說明「先前的送出結果無法自動確認，請以目前內容判斷」。
   - 這個恢復範圍的限制就是本 SPEC 的規定。

## 5. 資料與安全（D-W4、D-W6）

- 只用上游 Stage 1 的固定虛構測資；不接任何真實學生資料。
- 頁面拿不到 token（§3）；瀏覽器中不保存任何 token、憑證或學生資料（不寫入 localStorage、sessionStorage、IndexedDB、cookie）。**本批變更（2026-11-28）**：登入模式是例外——Firebase SDK 把**登入者自己的**登入狀態（含 ID token）保存在**這個分頁**的 sessionStorage；頁面程式本身仍不寫入任何儲存，也不保存學生資料（§11.3）。
- 網頁不持有 Emulator 的 owner 權限，只經受控 API。
- 本 repository 是 public：不啟用 GitHub Pages，不部署，不建立正式的 Firebase 專案。
- 殘餘風險：同一台電腦上的其他程序可以呼叫本機代理（§3）。

## 6. 驗收條件

**功能**：
1. P1 的計數與 API 回應一致：P+R+N+U = 合計；已到 = P+R；已登記 = P+R+N。沒有其他工作空間的資料。
2. 在**重設後的初始測資**（`LV-007` v5、上午）下，P3 成功後版本是 6，重新讀取的請假摘要顯示「全天」，點名狀態沒有被改動。「v6」只是這個固定初始狀態下的驗收值，不是產品規則。
3. 兩個分頁同時更正：一個成功，另一個顯示衝突畫面，不會覆蓋。
4. 連按兩次送出只產生一次修改（同一個 `operationId`、同一份 command）。
5. **提交已經發生，但回應遺失**（測試用的故障代理）：畫面顯示「結果尚未確認」；「查詢結果」取得同一份收據。整個過程只有一筆 revision，只用過一個 `operationId`。
6. 以 `S-DENY` 情境開啟每一個網站用到的路由與目標，加上一個不存在的目標：顯示一般的「無法存取」，「沒有權限」與「不存在」的回應相同。
7. **提交已經發生，但收據查詢失敗**（測試代理讓 `/v1/receipt` 回 503 或中斷連線）：
   - 畫面仍然是「結果尚未確認」，不是「未提交」；
   - 不會自動產生新的 `operationId`；
   - 「重新送出同一操作」得到原收據；
   - 只有一筆 revision。
8. **收據查詢被拒絕**（測試代理讓 `/v1/receipt` 回 403 `FORBIDDEN`）：同第 7 項，不得當成「未提交」，也不得自動改送新的操作。
9. **衝突之後**：重新讀取並顯示最新內容；不經使用者重新確認，就不會送出任何新的操作。
10. **（v0.4）結果不明之後，身分或授權失效**：
    - 提交成功但回應遺失；
    - 接著讓身分或授權失效，例如測試中停用該 actor 的 binding，或撤銷 membership；
    - 重送原操作，被 `FORBIDDEN` 拒絕。
    - 預期：畫面保留「先前的結果尚未確認，目前無法存取」，保留原 `operationId` 與 command；revision 仍然只有一筆；沒有出現新的 `operationId`。
11. **（v0.4）本機代理**：
    - 直接開啟首頁成功：模擬網址列導航，`Sec-Fetch-Site: none`，沒有 `Origin`；
    - 跨來源的 API `POST` 不會轉送：`Origin` 不符，或 `Sec-Fetch-Site: cross-site`，都回 403，而且 upstream 沒有收到請求；
    - 沒有 `Origin` 的 API `POST` 也被拒絕。

測試用的故障代理只存在於端對端測試中，不是網站本機代理的功能。

**介面**：
- 手機、平板、桌面三種寬度沒有水平溢出；
- 全程可以只用鍵盤操作，焦點看得見；
- 尊重 `prefers-reduced-motion`；
- 狀態不只用顏色表示；
- 依 `docs/DESIGN.md` §7 的清單驗收。

**資料與安全**：
- 只用虛構測資；
- 網頁不持有 Emulator 的 owner 權限，只經受控 API；
- 頁面拿不到 token（§3）；瀏覽器中不保存任何 token、憑證或學生資料（不寫入 localStorage、sessionStorage、IndexedDB、cookie）；
- 不部署。

**測試**：
- 端對端測試（Playwright，本機 Emulator 與受控 API），涵蓋上述 11 項，加上 §3 本機代理的邊界測試：其他路徑、其他方法、錯誤的 `Host`、不符的 `Origin`、頁面自帶的 `Authorization` 都會被拒絕或丟棄；
- 三種寬度的截圖；
- 本 repository 的測試全部通過；
- 上游的回歸，依 §6.1 的證據沿用安排處理；
- 結果分成「已通過／未執行／只經人工檢視」。

### 6.1 上游回歸的證據沿用安排（相對 v0.4 的**調整**，WEB-REV-001）

上游 v0.4 §4 的原文是：「既有的 `check`、`npm test`、`stage1:all`、Stage 2 測試全部回歸」。本 repository **不是**原樣承接這一句，而是改為以下安排：

1. **理由**：本 repository 不修改上游的任何程式；對接的受控 API 固定在上游 `1e20989`（§3），啟動器會拒絕其他版本或有未提交修改的工作區。上游的測試對象沒有改變。
2. **沿用的既有證據**（**不是**本 repository 重新執行的結果）：
   - 上游 PR #21（實作 B4 的受控寫入 API）：
     - ChatGPT 的 R1 複審通過（Reviewed Head `f9097dd`，最後受保護版本 `971a7d3`）；
     - 作者在本機 Linux 的回歸：`check`、`npm test` 20/20、`stage1:all`、`s2:test` 198/198、`s2:cases`、`s2:b3` 37/37、`s2:b4` 29/29；
     - 合併 commit `1e20989` 的 CI（push 到 main，run 45349503385）：success；
     - 證據紀錄在上游的 [`docs/stage2/S2B2-B4-REPORT.md`](https://github.com/hsuanyu9503/class-management-next/blob/754e3a1c0ec674e57ff36d4af7b45b959f448e5b/docs/stage2/S2B2-B4-REPORT.md) §10～§12。
   - 合併後的 hosted 執行（POC-016／017／018／021）與 ChatGPT 的原檔重播：四項 `MATCH`，結果 `UNATTESTED [TRUST_ROOT_NOT_CONFIGURED]`（同一份報告 §12）。
   - 沿用範圍**只限**：固定版本的受控 API 本身的行為與判定。
3. **一定要在本 repository 實際測試**（不能用上面的證據代替）：
   - §6 的 11 項端對端驗收；
   - §3 本機代理的邊界測試；
   - 開發用啟動器與上游 harness 的整合：版本檢查、乾淨工作區檢查、port 檢查、三個情境的建立與停止；
   - 三種寬度的截圖與 `docs/DESIGN.md` 的視覺驗收。
4. **啟動器整合時的上游煙霧檢查**：
   - 每次在新的環境第一次整合啟動器時，先在固定版本的上游 checkout 中執行 `npm run check`、`npm test`、`npm run stage1:all`、`npm run s2:test`（不需要 Emulator），確認該環境下的上游狀態與既有證據一致。
   - 結果記入本 repository 的 PR，標示為「本輪在 ○○ 環境執行」，並與上面沿用的證據分開寫。
   - 需要 Emulator 或沙箱的上游套件（`s2:cases`、`s2:b3`、`s2:b4`）**不**列為例行執行；觸發條件見第 5 點。
5. **需要重新評估回歸範圍的情況**：
   - 換到上游的其他版本；
   - 上游的 API 契約、授權規格或資料模型改變；
   - Node.js、firebase-tools、Emulator 的版本改變；
   - 啟動器開始依賴上游中原本沒有使用的部分。
   - 出現任何一種，都要在 PR 中列出「哪些上游測試需要重跑、由誰在哪裡執行」，送審後才使用新的組合。
6. 不得把沿用的既有結果寫成本輪重新執行。

## 7. 技術（D-W7、D-W8）

- 原生 HTML、CSS、JS，不需要建置步驟，沒有 CDN 或外部執行期套件（沿用既有網站的作法）。**本批變更（2026-11-28）**：Firebase Authentication 的 SDK 以 `scripts/build-vendor.mjs` 從鎖定版本的 `firebase`（13.3.0）打包成 `web/vendor/firebase-auth.js` 並提交；執行時仍不需要建置，也不從 CDN 載入。`npm test` 會以重新打包的結果核對提交的檔案。
- 開發用啟動器與本機代理：Node.js（版本與上游相同，22 以上）。
- 端對端測試：Playwright。
- 對接的上游版本固定，見 §3；要換版本必須另外送審。

## 8. 既有網站基準（Q-1 已決定）

- **負責人決定（2026-11-25）**：[`hsuanyu9503/Homework-manager-`](https://github.com/hsuanyu9503/Homework-manager-) **就是基準**。
  - 引用時固定版本：`main` `cdaf91ec280ed31a9e307bd665487356dc552539`（Classroom Manager v2.103）；之後如果有新版，要另外決定是否更新。
  - 先前所稱的「M02-04／M02-05」，以這個基準為準，不再另外等待原文。
- **只參考功能**（負責人指示，2026-11-25）：顏色等視覺效果依照先前已驗收的準則，不沿用既有網站的色彩，見 `docs/DESIGN.md` §1。
- **基準不等於 W1 的範圍**：
  - W1 只做 §2 列出的頁面與流程；
  - 基準中的其他功能（作業、聯絡簿、成績、座位等）不在 W1，要另外排入批次並送審；
  - 基準中與 W1 資料模型衝突的規則**不沿用**，例如「請假連動作業」（§2.3）。
- 既有網站的資料存在瀏覽器中，W1 **不**沿用其資料格式與儲存方式。
- 參考資料：負責人另外提供的附件 `ClassroomManager-v2.101.zip`（SHA-256 `3ce976a72e955e947ff6304bcbf4dd007497063b30f0747853bfb33941374003`），是同一個網站較早的版本；兩者不同時，以上面固定的 v2.103 為準。

## 9. 保留的正式門檻（W1 不處理）

- 正式的身分驗證與 Security Rules；（本批只做到 Emulator 模擬的 Google 登入；開發用專案的真實登入見 §11.6）
- 真機與離線；
- 備份與還原；
- 成本；
- 正式的 Firebase 專案與部署；
- 上游的 G-1／G-4／G-9／G-10 與 D-xx 決策；
- 正式 PASS（上游 `PASS_ENABLED=false`）。

## 10. 待決事項

| # | 事項 | 狀態 |
|---|---|---|
| Q-1 | 既有網站的基準 | **已決定**（2026-11-25）：`Homework-manager-` `cdaf91e`，只參考功能，見 §8 |
| Q-2 | 正式色票：沒有已驗收的色票，暫用上游範本的示範預設值，見 `docs/DESIGN.md` §1～§2 | 待負責人決定 |
| Q-3 | 本 repository 的 Settings：分支保護、Actions 權限、Pages 關閉 | **已設定**（2026-11-25），核對結果見 `docs/HANDOFF.md` |

## 11. Google 登入（2026-11-28 負責人決定；本批新增）

### 11.1 決定

- 新版網站繼續沿用本 repository；資料庫確定使用 Firebase（Cloud Firestore 承接既有資料模型）。
- 新增 Google 登入、登出與登入狀態；直接實作，驗收隨實作進行。

### 11.2 登入與授權分開

- **登入只確認身分**（Firebase Authentication 的 Google provider）。登入**不會**授予任何班級或管理員權限。
- 能讀哪個班級，由受控 API **每一次請求**決定：
  - 驗證**登入者自己的** ID token；
  - 以 Firebase UID 讀取 `authBindings/{uid}` → principal → membership。
  - 不憑電子郵件網域，也不憑前端傳入的班級 ID 放行；前端傳入的 `claimedScope` 只用來比對，不一致就拒絕。
- 已登入但沒有授權的人，看到「尚未取得班級存取權」，頁面不顯示任何班級資料。
- **沒有**「第一位登入者自動成為管理員」，也沒有任何「登入即加入班級」的規則。
- 授權綁定只由開發者明確設定：本機 Emulator 用 `dev/login-identities.json`；正式環境的方式待負責人決定，見 §11.7。

### 11.3 頁面的行為

- **未登入**：只顯示「請先登入」，不發出任何 API 請求。
- **登入中／取消／失敗**：
  - 按鈕顯示「登入中…」；
  - 取消：「已取消登入，沒有任何變更。」
  - 失敗：說明原因，例如無法連線、彈出視窗被擋、帳號被停用，按鈕恢復可用。
- **登入狀態**：由 Firebase SDK 管理，使用 `browserSessionPersistence`：
  - 只保存在這個分頁；重新整理會恢復，關閉分頁就結束；
  - 頁面程式本身**不**把 token 寫入 localStorage、網址或記錄檔。
- **每次 API 請求**：附上 SDK 提供的**目前登入者**的 ID token。本機代理在登入模式**不持有任何 token**，只轉送頁面送來的 `Bearer` token，不再附加測試 actor 的 token。
- **登出或切換帳號**：
  - 清除畫面與 DOM 中前一位使用者的所有資料：名冊、請假、結果、選單、班級代碼；
  - 遲到的回應一律丟棄，以帳號變更的世代判斷。
- **送出中或結果尚未確認時**：
  - 送出中不能登出；
  - 結果尚未確認時，登出前先確認；
  - 這個操作綁定建立它的 UID：換成其他帳號時**不會**顯示、查詢或重送它，只顯示「先前的帳號有一個送出結果尚未確認的操作」；
  - 同一個帳號在同一個分頁重新登入後才恢復；
  - 不會因為登出就說成「未修改」或「已完成」。
- **token 失效／帳號停用**：讀取被拒時，先以 `reload()` 與重新取得 token 確認登入狀態；失敗就登出並顯示「登入已失效，請重新登入」。SDK 自行登出的情況也一樣顯示。
- **授權被撤銷**：讀取被拒、登入仍有效、重新檢查後已沒有任何班級 → 清除資料，顯示「尚未取得班級存取權」。
- 不會停在「載入中」：確認登入狀態最多等 15 秒，逾時就顯示登入畫面與說明。

### 11.4 本機 Emulator 的模擬登入（本批實作）

- 啟動：`node dev/launcher.mjs --upstream <path> --scenario LOGIN`。
- 帳號：啟動器在本機 Auth Emulator 建立 `dev/login-identities.json` 中的**虛構** Google 帳號（`example.test` 網域），只為有 `grant` 的帳號寫入綁定。
- 登入畫面是開發專用的帳號選擇窗：選擇後，以 Emulator 文件記載的假 Google 憑證 `signInWithCredential`，由 Auth Emulator 為該 Google 帳號簽發 Emulator 的 ID token。
  - 也可以「建立新的虛構帳號」，它沒有任何授權。
  - **這是模擬登入，不是真的 Google 登入。**
- 為什麼不用 `signInWithPopup`：SDK 的彈出視窗流程即使在 Emulator 也會載入 `https://apis.google.com/js/api.js`，違反 §7「不從外部載入執行期程式」，CSP 也會擋下。

### 11.5 不變的部分

- 受控 API 的交易、版本衝突、operationId、收據查詢、重送規則都不變（§4）。
- 頁面**只**透過受控 API 讀寫，不使用 Firestore SDK，不直接存取 Firestore。
- 上游 API 仍是固定版本 `1e20989`，本批沒有修改：它在 Emulator 模式就已驗證 token 並逐次授權。
- Firestore Security Rules：上游 `poc/stage2/firestore.rules` 對 client SDK **一律拒絕**（`allow read, write: if false`），沒有使用公開讀寫的測試模式。網頁不直接存取 Firestore；受控 API 以 Emulator 的 owner 權限存取，並逐次自行授權。

### 11.6 連到開發用 Firebase 專案的真實 Google 登入（**本批已在本 repository 實作，見 §12**；仍需要負責人提供的設定）

- **網站端**：`signInWithPopup` 的程式已經寫好，但沒有啟用，也沒有執行過。需要：
  - 開發用專案的 Web app 設定：`apiKey`、`authDomain`、`projectId`、`appId`。這些是公開的識別資料，不是密碼。
  - Console 中啟用 Google provider；
  - authorized domains 加入 `localhost`；
  - CSP 例外：`script-src https://apis.google.com`、`frame-src https://<project>.firebaseapp.com`、`connect-src https://identitytoolkit.googleapis.com https://securetoken.googleapis.com`。這是 §7 的例外，**待負責人核准**。
- **後端**：上游 API 目前**只接受 Emulator 的 token**（`createApi` 拒絕非 Emulator 模式與非 `demo-` 專案）。最小必要變更：
  1. 驗證**簽章**的 Google ID token：RS256、Google 公開憑證、`aud`／`iss`／`exp`／`auth_time`、`sub`；
  2. 以伺服器端的憑證存取該專案的 Firestore（Admin 權限）：
     - 授權仍由 API **逐次**檢查，不依賴 Security Rules；
     - Security Rules 對網頁 client 一律拒絕，因為網頁不直接存取 Firestore；
  3. 放寬上游的「只能 Emulator」防護。
  - 這三項都會改動上游的受保護檔案（需要負責人重新核准錨定），也需要決定 API 在哪裡執行，見 §11.7。
- 不需要、也不要提供：密碼、服務帳戶私鑰、Google client secret。

### 11.7 待負責人決定

| # | 事項 | 選項（Claude 建議第一項） |
|---|---|---|
| L-1 | 管理員與初始成員的授權方式 | (a) **開發者以命令列寫入綁定**：只有負責人在自己電腦上、以自己的 Google 帳號（ADC）執行，指定 UID 與既有 principal，留下稽核紀錄；不提供網頁上的自助加入。(b) 之後再做管理頁面：只有已綁定的管理員能邀請，邀請需要對方登入後由管理員確認。(c) Console 手動寫入文件：不建議，容易出錯，也沒有稽核 |
| L-2 | 後端（受控 API）在哪裡執行 | (a) **負責人的電腦**（本機，連開發用專案），以 `gcloud auth application-default login` 取得憑證，不存金鑰。(b) Cloud Run 等託管服務：涉及付費與公開網址，需要另外同意 |
| L-3 | 真實登入的 CSP 例外（§11.6） | (a) **只在開發用專案的真實登入模式放行**所列網域。(b) 改用 `signInWithRedirect`：同樣需要例外 |
| L-4 | 開發用 Firebase 專案 | 需要負責人建立或指定，並提供 §11.6 的公開設定 |

## 12. Firebase 實際模式（開發用專案；2026-11-28 本批新增）

> 承接 §11。§11.6 原本寫「尚未實作」的後端變更，本批在**本 repository** 實作；上游 repository **沒有**修改。

### 12.1 架構

- 網頁 → 受控 API（`server/api.mjs`）→ Cloud Firestore。
- 受控 API 的業務邏輯，是上游 `class-management-next` `1e20989` 的**逐字複本**（`server/upstream/`，以 SHA-256 核對）：
  - 授權（`authz.mjs`）；
  - 請求格式；
  - 交易、版本、operationId、收據（`api/commit.mjs`）。
- 只有「連到哪裡、用什麼憑證、如何驗證 ID token」這一層依模式不同：`server/config.mjs`、`backend.mjs`、`store.mjs`、`txn.mjs`、`token-firebase.mjs`、`credentials.mjs`。
- 網頁**不**直接存取 Firestore，也不使用 Firestore SDK。

### 12.2 兩種模式，明確區分（`CMN_API_MODE`）

| 模式 | 用途 | 防止連錯專案 |
|---|---|---|
| `emulator` | 開發與自動測試：本機 Emulator、`demo-` 專案 | 上游的本機防護：只接受 `demo-` 專案與 loopback |
| `firebase` | 開發用的**真實** Firebase 專案（虛構資料） | 專案 ID 要輸入兩次（`CMN_FIREBASE_PROJECT_ID`、`CMN_CONFIRM_FIREBASE_PROJECT`）；不得是 `demo-`；設有任何 `*_EMULATOR_HOST` 就拒絕；只能連該專案的 Firestore 文件與 `accounts:lookup` |

### 12.3 真實模式的身分驗證

- **網頁**：Firebase SDK 的 `signInWithPopup`（Google）。
  - 登入狀態使用 `browserSessionPersistence`：只在這個分頁，關閉分頁就結束，是共用裝置的保守設定。
  - CSP 只多允許 Google 登入必要的主機：`apis.google.com`、`identitytoolkit`／`securetoken`／`www.googleapis.com`、專案的 `authDomain`。這是 §7 的例外，只用在真實模式（§11.7 L-3）。
- **API**：每一次請求都依下列順序檢查：
  1. RS256 簽章：使用 Google 公開的 securetoken 憑證，依 `kid` 選擇，憑證依快取期限快取；
  2. `iss`／`aud` 等於該專案，`sub` 等於 `user_id`，`iat`／`exp`／`auth_time`；
  3. 以 API 自己的憑證查 `accounts:lookup`：帳號存在、未停用；若登入時間（`auth_time`）早於 `validSince`，就視為已撤銷。
  - Emulator 的未簽章 token 在真實模式**一律拒絕**。
- **API 自己的憑證**：
  - `adc`：負責人電腦上 `gcloud auth application-default login` 的使用者憑證；**拒絕服務帳戶金鑰檔**；
  - `metadata`：之後放在 Cloud Run 等環境時使用。
  - 不在 repository、網頁、記錄或審查包中保存任何私鑰或 token。

### 12.4 授權與 Firestore Rules

- 授權沿用上游規格（S2-B1 授權模型），**每一次**讀取與修改都由 API 檢查：
  - binding（`authBindings/{uid}`，必須是 active，而且 token 的 `iat` 不早於 `activatedAt`）；
  - principal（active）；
  - membership（工作空間、班級、有效日期）；
  - capability（例如 `leave.revise`）。
- 不憑 email 網域、前端傳入的角色或隱藏按鈕放行；請求中多出的欄位（例如 `principalId`、`role`）一律拒絕。
- `firestore.rules`：對用戶端**一律拒絕**。登入者也無法自行寫入 binding 或 membership，也無法讀取任何資料。API 使用伺服器端憑證，不受 Rules 限制，所以授權完全由 API 負責。

### 12.5 開通帳號（受信任的管理腳本）

- `server/admin.mjs`，只由負責人在自己的電腦上執行：
  - `bind --uid <UID> --principal <既有的 principal>`：principal 必須存在而且 active；
  - `unbind --uid <UID>`：把 binding 改成 disabled，保留紀錄；
  - `list-bindings`；
  - `seed-fictional`：把固定的**虛構**世界寫入**空的**專案；非空就拒絕。
  - 每次變更都寫入稽核紀錄。
- 沒有網頁上的自助加入，第一位登入者也不會自動成為管理員。
- 「尚未取得班級存取權」畫面會顯示該帳號的 UID（識別碼，不是密碼），讓負責人可以用來 `bind`。

### 12.6 在負責人的電腦上以真實專案執行

- `node server/main.mjs`：網頁與 API 在同一個本機 origin（`http://localhost:18400`），只在 loopback。這**不是**部署。
- 步驟見 `docs/SETUP-FIREBASE.md`。
- **要從不同裝置使用，需要部署**：網頁放 Firebase Hosting，API 放 Cloud Run。這涉及公開網址與付費方案，**本批不做**，待負責人決定（§12.8）。

### 12.7 測試的區分

| 類別 | 內容 | 狀態 |
|---|---|---|
| 單元測試 | 模式防護、憑證、真實模式的 token 驗證（以測試金鑰簽章）、URL 白名單、逐字複本的雜湊 | 自動 |
| 真實模式程式路徑（Emulator） | `firebase` 後端，以測試金鑰簽章的 RS256 token 連 Emulator：授權、交易規則、帳號狀態 | 自動，**不是**真實 Google |
| 模擬登入 E2E | Auth Emulator 的 Google provider，加上真正的頁面 | 自動，**不是**真實 Google |
| 真實 Google 登入 | 開發用專案 | **未執行**：需要負責人的專案與設定 |

### 12.8 缺口與待決

- **G-A**：上游沒有「我的班級」API。頁面目前以 W1 固定的虛構目標逐一詢問 API（API 決定能不能看）。真實資料前，需要新增一個由 API 依 membership 列出班級的讀取操作，這是授權相關的新功能，要另外送審。
- **G-B**：沒有管理介面；開通帳號只能用 `server/admin.mjs`。
- **G-C**：多裝置使用需要部署：Hosting、Cloud Run、Blaze 付費方案。這些需要負責人同意。
- §11.7 的 L-1～L-4 仍然有效；L-2 的建議改為：先在負責人電腦上執行（本批已可用），之後再決定雲端部署。

