# HANDOFF｜目前工作與交接狀態

## 目前狀態（2026-11-25）

- 目前任務：**W1 文件**（PR #1 文件審查通過，Reviewed Head `9b268c2`，待負責人決定合併）：建立本 repository 的 `CLAUDE.md`、`docs/SPEC.md`、`docs/DESIGN.md`，承接上游的 [`WEB-B1-PROPOSAL.md` v0.4](https://github.com/hsuanyu9503/class-management-next/blob/754e3a1c0ec674e57ff36d4af7b45b959f448e5b/docs/WEB-B1-PROPOSAL.md)。
- 基準：`main` `10670e7`（只有 `README`）。
- **還沒有任何網頁程式**。文件審查通過、負責人核准之後，才實作 W1。
- 上游：`hsuanyu9503/class-management-next` main `754e3a1`；受控 API 固定為 `1e20989`（SPEC §3）。

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
