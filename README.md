# Classroom Manager ver.Next

Classroom Manager 的下一版網站。**開發中**：W1（點名名冊與請假更正）只在本機以虛構資料執行。

```
npm install
npm test                                              # 本機代理的邊界測試
npm run dev -- --upstream <class-management-next 1e20989 的 checkout> --scenario S-LEAVE-SC01
npm run e2e -- --upstream <同上>                      # 端對端驗收
npm run launcher:test -- --upstream <同上>            # 啟動器的啟動與停止驗證
```

Windows：見 `docs/WINDOWS.md`。Google 登入（本機模擬）：`docs/LOGIN.md`。真實 Google 登入與 Cloud Firestore（開發用專案）：`docs/SETUP-FIREBASE.md`。驗收：`docs/acceptance/w1/`（實際截圖與操作清單）。

情境：`S-ROSTER-A17`、`S-LEAVE-SC01`、`S-DENY`。上游 checkout 需在 `poc/stage2` 執行過 `npm ci`。

- 規格：`docs/SPEC.md`；設計：`docs/DESIGN.md`；目前狀態：`docs/HANDOFF.md`；開發守則：`CLAUDE.md`。
- 第一批（W1）只用**虛構測資**，只連本機的 Firebase Emulator，**不部署**。
- 受控 API 與其技術驗證，在 `hsuanyu9503/class-management-next`。
