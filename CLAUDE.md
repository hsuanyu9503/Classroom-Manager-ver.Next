# Claude 開發守則｜Classroom Manager ver.Next

你是本專案的**主要程式實作與整合者**，不是產品需求的最終決策者。專案負責人決定需求、合併與 Settings；ChatGPT 做獨立審查。

## 每次開工先讀

1. `docs/SPEC.md`：功能規格、驗收條件與禁止事項。
2. `docs/DESIGN.md`：介面、視覺與互動規格。
3. `docs/HANDOFF.md`：目前任務、狀態與待決事項。
4. 上游的技術驗證 repository `hsuanyu9503/class-management-next`：
   - `docs/WEB-B1-PROPOSAL.md` v0.4 是本批的依據；
   - `docs/stage2/` 是受控 API 的授權與資料模型規格。

## 工作約束

- 先確認目前的分支與 commit；交接單指定的版本不同時，**先停下說明**。
- **分支**：Claude 只在 `claude/*` 分支工作。不得直接修改、強制推送或自行合併 `main`；除非負責人明確核准，否則只建立 PR。
- **最小必要改動**；需要重構時，先提出方案等待核准。
- **規格衝突或缺漏**：先提出問題，交由負責人與 ChatGPT 決策，不自行選擇新需求。
  - 既有網站的基準是 `hsuanyu9503/Homework-manager-` `cdaf91e`（SPEC §8），**只參考功能**；顏色等視覺效果依 `docs/DESIGN.md` §1 已驗收的準則。基準中不在目前批次的功能，不自行加入。
- **資料**：只用 `class-management-next` Stage 1 的固定**虛構**測資。不得使用、提交或顯示任何真實學生資料。
- **禁止提交**：`.env`、存取憑證、token、正式資料匯出、個資。
- **不部署**：本 repository 是 public；不啟用 GitHub Pages 或任何部署流程，除非負責人另外決定。
- **後端**：只連本機的 Firebase Emulator 與 `class-management-next` 中**固定版本**的受控 API（SPEC §3）。不建立正式的 Firebase 專案，不接正式資料。
- **瀏覽器端**：頁面不持有 token 或任何憑證；不使用 localStorage、sessionStorage、IndexedDB、cookie 保存資料（SPEC §3、§5）。
- **測試**：必須執行實際可以執行的測試，並把「已通過」「未執行」「只經人工檢視」分開寫。不能以「可以載入」代替操作驗收；要檢查手機、平板、桌面的版面與鍵盤操作。
- **審查**：每個 PR 初評風險等級（L1 純文件／L2 一般功能／L3 授權、資料一致性、代理邊界）。L2、L3 要把實際差異交 ChatGPT 獨立審查；只有摘要或截圖，不能宣稱已完成 Code Review。
- AI 的審查意見**不是** GitHub 的正式 Approve，也不能代替負責人核准合併。

## 每次交付需附

- PR 連結、固定的 commit SHA、風險等級；
- 修改的檔案與變更摘要；
- 測試命令、結果、尚未測試的項目；
- 已知限制，以及對資料的影響（本專案只有虛構資料）；
- 更新 `docs/HANDOFF.md`。
