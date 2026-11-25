# HANDOFF｜目前工作與交接狀態

## 目前狀態（2026-11-25）

- 目前任務：**W1 實作**（分支 `claude/w1-impl`，L3 PR，待 ChatGPT 審查）。PR #1（文件）已由負責人核准合併，`main` `307682e`。
- 上游：受控 API 固定為 `class-management-next` `1e20989`（SPEC §3）；啟動器拒絕其他版本或 `poc/stage2` 有未提交修改的 checkout。
- 內容：
  - `web/`：P1 點名名冊（摘要＋明細）、P2 請假紀錄與「更正為全天」、P4 送出結果（SPEC §4 狀態機）、確認對話框；
  - `dev/`：開發用本機代理（SPEC §3 邊界）、上游檢查、情境世界、啟動器（`npm run dev -- --upstream <path> --scenario <S>`）；
  - `test/`：代理邊界單元測試（`npm test`）、端對端驗收（`npm run e2e -- --upstream <path>`）。

## W1 實作的待審事項（請 ChatGPT／負責人確認）

| # | 事項 | 目前作法 |
|---|---|---|
| W1-Q1 | P／R／N／U 在規格中沒有中文名稱 | 頁面直接顯示代碼；摘要另列「已到（P+R）」「已登記（P+R+N）」。名稱待負責人決定，不自行命名 |
| W1-Q2 | 目標 ID（點名場次、請假紀錄 LV-007、範圍）寫在 `web/app.js` 的 `TARGETS` | 視為**情境設定**，不是測資；都是上游 Stage 1 的虛構 ID。`/scenario.json` 只回傳情境代碼，不含 token |
| W1-Q3 | 色彩 | 仍是 `web/tokens.css` 的**暫定**值（Starter Kit 範例），頁首標示「暫定色票」；正式色票待 Q-2 |
| W1-Q4 | 啟動器 | **只供開發**：以獨立程序群組啟動 `firebase emulators:exec`，停止訊號送給整個群組，結束後確認所有 port 已關閉；不是產品功能 |

## W1 測試結果（2026-11-25）

**已通過（本輪在 Linux 雲端環境執行；Node 22.23.5、firebase-tools 15.35.0、Playwright 1.63.0 Chromium）**

- `npm test`：代理邊界 9/9。
- `npm run e2e`：17/17。內容：SPEC §6 的 11 項驗收；四種尺寸（390×844、820×1180、1440×900、1024×768）不水平溢出、文字區塊不塌縮；鍵盤；`prefers-reduced-motion`；每個送出狀態都有文字標籤。結果 JSON 與截圖在 `test-results/`（不提交，附在審查包）。
- 啟動器：啟動 `S-DENY` 後首頁回傳 200；只對啟動器送出 SIGINT 後，輸出「stopped (exit 0); ports confirmed closed」。
- SPEC §6.1 第 4 點的上游煙霧檢查（固定版本 `1e20989` 的 checkout）：`npm run check` 通過、`npm test` 20/20、`npm run stage1:all` 通過（Postgres 仍是 `NOT_RUN`）、`s2:test` 198/198；執行後工作區仍乾淨。

**沿用的既有證據**（不是本輪重跑）：見 SPEC §6.1 第 2 點。

**未執行**

- Windows、macOS 的啟動器與 E2E；Firefox、WebKit；
- 實體手機、平板與螢幕閱讀器；
- 上游需要 Emulator 的套件（`s2:cases`、`s2:b3`、`s2:b4`）：依 SPEC §6.1 第 4 點不例行執行；
- CI：本 repository 還沒有 CI。

**只經人工檢視**

- 截圖中的版面與視覺（DESIGN §7）。

## 待決事項

| # | 事項 | 負責 |
|---|---|---|
| Q-1 | 既有網站的基準：**已決定**（2026-11-25）＝`Homework-manager-` `cdaf91e`，只參考功能 | — |
| Q-2 | 正式色票（沒有已驗收的色票；既有網站的色彩依指示不沿用） | 負責人 |
| Q-3 | 本 repository 的 Settings：**負責人已設定（2026-11-25）**，Claude 以公開 API 核對，見下方 | — |

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
