# HANDOFF｜目前工作與交接狀態

## 目前狀態（2026-11-25）

- 目前任務：**W1 文件**：建立本 repository 的 `CLAUDE.md`、`docs/SPEC.md`、`docs/DESIGN.md`，承接上游的 [`WEB-B1-PROPOSAL.md` v0.4](https://github.com/hsuanyu9503/class-management-next/blob/754e3a1c0ec674e57ff36d4af7b45b959f448e5b/docs/WEB-B1-PROPOSAL.md)。
- 基準：`main` `10670e7`（只有 `README`）。
- **還沒有任何網頁程式**。文件審查通過、負責人核准之後，才實作 W1。
- 上游：`hsuanyu9503/class-management-next` main `754e3a1`；受控 API 固定為 `1e20989`（SPEC §3）。

## 待決事項

| # | 事項 | 負責 |
|---|---|---|
| Q-1 | 既有網站的基準：**已決定**（2026-11-25）＝`Homework-manager-` `cdaf91e`，只參考功能 | — |
| Q-2 | 正式色票（沒有已驗收的色票；既有網站的色彩依指示不沿用） | 負責人 |
| Q-3 | 本 repository 的 Settings（見下方建議） | 負責人 |

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
