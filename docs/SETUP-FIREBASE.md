# 用真實的 Google 登入與 Cloud Firestore 執行（開發用專案）

> - **範圍**：負責人自己的電腦、開發用 Firebase 專案、**虛構**資料。這**不是**部署，也不需要付費方案：API 在您的電腦上執行。
> - **不要**把密碼、服務帳戶私鑰或 Google client secret 貼到聊天或放進 repository；整個流程都用不到它們。
> - 規格：SPEC §12。要從不同裝置使用，需要另外部署（SPEC §12.8 G-C）。

## A. 在 Firebase Console 設定（只需一次）

1. 到 https://console.firebase.google.com/ 建立一個**新的開發用專案**，例如 `cmn-dev-你的名字`。
   - Google Analytics 可以不啟用；
   - 記下 **專案 ID**。
2. **Firestore Database**：建立資料庫。
   - 選「**以正式版模式啟動**」（production mode），預設就是拒絕所有用戶端；
   - 位置選 `asia-east1`（台灣）。
3. **Authentication** → **登入方式** → 啟用 **Google**，選一個支援電子郵件，儲存。
4. **Authentication** → **設定** → **已授權的網域**：確認有 `localhost`（預設就有）。
5. **專案設定** → **一般** → 「您的應用程式」→ 新增 **網頁應用程式**（不勾選 Hosting）。畫面會顯示 `apiKey`、`authDomain`、`projectId`、`appId`。
   - 這些是**公開**的識別資料，不是密碼。
6. （建議）**Firestore Database** → **規則**：貼上本 repository 的 `firestore.rules`，然後「發布」。
   - 內容就是「一律拒絕用戶端」，和正式版模式的預設相同。

## B. 在您的電腦上準備（Windows PowerShell）

1. 安裝 Google Cloud CLI：https://cloud.google.com/sdk/docs/install 。裝完後重新打開 PowerShell。
2. 讓 API 使用**您自己的**權限：

   ```powershell
   gcloud auth application-default login
   gcloud auth application-default set-quota-project <專案 ID>
   ```

   - 第一行會開瀏覽器，用建立專案的 Google 帳號登入。
   - 憑證保存在您的電腦上，不會進入 repository。
3. 把 A-5 的設定存成 `C:\cmn\Classroom-Manager-ver.Next\dev\firebase-web-config.json`。
   - 以 `dev\firebase-web-config.example.json` 為範本；
   - 這個檔案已經在 `.gitignore` 中。

## C. 寫入虛構資料，然後開通您的帳號

在 `C:\cmn\Classroom-Manager-ver.Next`（每開一個新的 PowerShell 都要重新設定這四個變數）：

```powershell
$env:CMN_API_MODE = "firebase"
$env:CMN_FIREBASE_PROJECT_ID = "<專案 ID>"
$env:CMN_CONFIRM_FIREBASE_PROJECT = "<專案 ID>"
$env:CMN_GCP_CREDENTIALS = "adc"
```

1. 寫入固定的**虛構**世界（只能寫入空的專案）：

   ```powershell
   node server\admin.mjs seed-fictional --upstream C:\cmn\cmn-1e20989 --confirm-fictional
   ```

2. 啟動網站與 API：

   ```powershell
   node server\main.mjs
   ```

3. 用瀏覽器打開 **http://localhost:18400/**（用 `localhost`，不要用 `127.0.0.1`），按「使用 Google 登入」，用您的 Google 帳號登入。
4. 畫面會顯示「**尚未取得班級存取權**」，以及您的 **UID**。這是正確的：登入不會自動取得權限。
5. 另開一個 PowerShell（同樣先設定上面四個變數），把您的帳號綁定到虛構的導師：

   ```powershell
   node server\admin.mjs bind --uid <畫面上的 UID> --principal ACTOR-SC01-TEACHER
   ```

6. 回到網頁按「**重新檢查**」。畫面應該出現 SC01 班的名冊與請假紀錄 LV-007，可以「更正為全天」。
7. 停止：在執行 `server\main.mjs` 的視窗按 Ctrl+C。
   - 資料留在 Firestore：再次啟動時看到的是同一份資料，不會重設。

## D. 驗收時請回報

- 第 C-3 步登入有沒有成功；如果出現錯誤，回報畫面上的錯誤代碼；
- 第 C-4 步有沒有看到「尚未取得班級存取權」與 UID；
- 第 C-6 步「重新檢查」後有沒有看到班級資料，更正是否成功；
- 用無痕視窗、以**另一個** Google 帳號登入：應該只看到「尚未取得班級存取權」。

撤銷權限：`node server\admin.mjs unbind --uid <UID>`。列出目前的綁定：`node server\admin.mjs list-bindings`。
