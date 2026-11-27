# Google 登入（模擬）的實際畫面

> - 產生的版本：`f141bcc41576bac0ce2b8cfe9f6344195246df45`（分支 `claude/w1-google-login`，工作目錄乾淨），作者在 Linux 執行，2026-11-27。
> - `npm run e2e -- --upstream <path> --script e2e-login`：真正的頁面、本機 Auth／Firestore Emulator、固定版本的 API `1e20989`。
> - **模擬登入**：Auth Emulator 的 Google provider 與虛構帳號，**不是**真的 Google 登入。
> - 結果：`e2e-login-results.json`（15/15）。色彩與樣式都是暫定。

**未登入：只有「請先登入」**

![未登入：只有「請先登入」](screens/L1-signed-out-1440.png)

**換成其他帳號：先前帳號尚未確認的操作不會顯示或重送，只顯示提示**

![換成其他帳號：先前帳號尚未確認的操作不會顯示或重送，只顯示提示](screens/L10-other-account-parked-1440.png)

**模擬登入的帳號選擇窗（虛構帳號）**

![模擬登入的帳號選擇窗（虛構帳號）](screens/L2-chooser-1440.png)

**已登入、沒有授權：「尚未取得班級存取權」**

![已登入、沒有授權：「尚未取得班級存取權」](screens/L4-no-access-1440.png)

**teacher.sc01：只看到 SC01 的名冊與請假**

![teacher.sc01：只看到 SC01 的名冊與請假](screens/L5-signed-in-sc01-1440.png)

**signed-in-classroom-1024x768**

![signed-in-classroom-1024x768.png](screens/signed-in-classroom-1024x768.png)

**signed-in-desktop-1440x900**

![signed-in-desktop-1440x900.png](screens/signed-in-desktop-1440x900.png)

**signed-in-phone-390x844**

![signed-in-phone-390x844.png](screens/signed-in-phone-390x844.png)

**signed-in-tablet-820x1180**

![signed-in-tablet-820x1180.png](screens/signed-in-tablet-820x1180.png)

**signed-out-classroom-1024x768**

![signed-out-classroom-1024x768.png](screens/signed-out-classroom-1024x768.png)

**signed-out-desktop-1440x900**

![signed-out-desktop-1440x900.png](screens/signed-out-desktop-1440x900.png)

**signed-out-phone-390x844**

![signed-out-phone-390x844.png](screens/signed-out-phone-390x844.png)

**signed-out-tablet-820x1180**

![signed-out-tablet-820x1180.png](screens/signed-out-tablet-820x1180.png)
