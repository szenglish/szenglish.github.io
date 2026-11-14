# 樹人醫專應用英語科學會網站

純 HTML、CSS、JavaScript 網站，發布在 GitHub Pages。成員日常操作請看 [網站內容操作說明.md](網站內容操作說明.md)。

## 架構

- 內容後台：`/admin`（Sveltia CMS），編輯結果存進 `content/`，上傳的圖片和檔案存進 `assets/uploads/`。
- 發布：推送到 `main` 後，GitHub Actions 執行 `scripts/build_data.py` 產生 `data/site.json`，再部署網站，約需 1 到 2 分鐘。
- 意見投遞箱、會費查詢、幹部收費：網站把資料送到同一支 Google Apps Script，再讀寫試算表。名單留在不公開的試算表裡，公開的查詢頁只拿得到查詢的那一筆。

## 本機預覽

```bash
python scripts/build_data.py
```

```bash
python -m http.server 8123
```

然後打開 <http://localhost:8123>。

## 上線設定

以下都請使用科學會統一帳號 `szae.official@gmail.com`。

### 1. GitHub

1. 用這個信箱註冊科學會的 GitHub 帳號，並開啟兩步驟驗證。
2. 建立儲存庫，上傳所有檔案到 `main`。
3. 到 Settings > Pages，把 Source 設為 GitHub Actions。
4. 修改 `admin/config.yml` 的 `repo`，改成實際的「帳號/儲存庫」。
5. 網址如果是 `帳號.github.io/儲存庫名稱`，要把 `404.html` 的 `<base href="/">` 改成 `<base href="/儲存庫名稱/">`。儲存庫直接命名為 `帳號.github.io`，或綁定自己的網域時，不用改。

### 2. 內容後台登入

快速開始可以用 token 登入：

1. 到 GitHub 的 Settings > Developer settings > Fine-grained tokens 建立權杖。
2. 只選這個儲存庫，權限開 Contents 的 Read and write。
3. 打開網站的 `/admin`，選 Sign In with Token 並貼上。

權杖等同這個儲存庫的寫入權限，不要貼在群組或寫進檔案，交接時請重新產生。

如果常有多人編輯，建議改用官方的 Sveltia CMS Authenticator（Cloudflare Workers），讓成員用 GitHub 帳號登入，再把網址填進 `admin/config.yml` 的 `base_url`。

### 3. Google 試算表與 Apps Script（意見投遞箱、會費查詢、幹部收費）

三個功能共用同一份試算表和同一支 Apps Script。

**建立試算表**

1. 新增一份 Google 試算表，保持「限制存取」，不要開成知道連結的人都能檢視。
2. 選「擴充功能 > Apps Script」，貼上 [apps-script/Code.gs](apps-script/Code.gs) 並儲存。
3. 在編輯器上方選 `setup` 函式按「執行」，依畫面完成授權。試算表會自動建立「名冊」「收款紀錄」「設定」「幹部」「意見」分頁。
4. 到「設定」分頁填「目前學年」（例如 `115`）和「會費金額」（只填數字）。
5. 到「幹部」分頁，每位收費幹部填一列：Gmail、姓名。姓名會記錄成收據上的經手人。

從舊系統搬資料時，「名冊」和「收款紀錄」可以直接從整理好的 Excel 貼上。「學號」欄要設成「格式 > 數值 > 純文字」，避免開頭的 0 被吃掉。

**建立 Google 登入用的用戶端 ID**（幹部收費頁要用，只需做一次）

1. 打開 <https://console.cloud.google.com/>，建立專案，名稱例如 `szae-collect`。
2. 到「API 和服務 > OAuth 同意畫面」，使用者類型選「外部」，應用程式名稱填「應用英語科學會收費」，支援信箱填科學會信箱，其他留空。完成後按「發布應用程式」，改成「正式版」。只用登入的基本資料，不需要送 Google 審核。
3. 到「API 和服務 > 憑證 > 建立憑證 > OAuth 用戶端 ID」，類型選「網頁應用程式」。「已授權的 JavaScript 來源」加入 `https://szenglish.github.io`；要在本機測試，再加 `http://localhost:8123`。
4. 複製產生的用戶端 ID（結尾是 `.apps.googleusercontent.com`）。

**部署**

1. 把用戶端 ID 貼進 `Code.gs` 最上面的 `GOOGLE_CLIENT_ID`，儲存。
2. 選「部署 > 新增部署作業」，類型選「網頁應用程式」，「執行身分」選自己，「誰可以存取」選「所有人」。
3. 把結尾是 `/exec` 的網址填進 `config.js` 的 `feedbackUrl` 和 `paycheckUrl`，用戶端 ID 填進 `googleClientId`。

之後修改 `Code.gs` 時，要選「部署 > 管理部署作業 > 編輯 > 新版本」才會生效，網址不會變。

### 4. 會費查詢與幹部收費

> 目前選單的「會費查詢」仍連到舊系統。Google 試算表設定好、確認可以使用後，再把 `js/site.js` 的「會費查詢」改成 `{ label: "會費查詢", href: "paycheck.html", page: "paycheck" }`。
>
> 上線前可以用示範模式試用：在網址後面加 `?demo=1`，例如 `collect.html?demo=1`、`paycheck.html?demo=1`。示範模式用的是假名單，資料只存在自己手機的瀏覽器裡，不會寫進試算表。


- **學生查詢**：網站選單的「會費查詢」（`paycheck.html`）。輸入學號，顯示是否已繳、收據編號和經手人。姓名只顯示遮蔽後的樣子（例如「王○明」），避免別人用學號查出全名。
- **幹部收費**：`https://szenglish.github.io/collect.html`，不放在選單上。幹部用手機打開、用 Google 登入，加到主畫面後就像 App。登入時會先下載名冊，找人不用等網路。可以用學號（打滿 8 碼自動查詢）、掃學生證條碼、姓名或班級找人，按一次「收款」就完成，10 秒內可以「復原」。收據編號、經手人和時間會自動記錄，不用寫紙本收據。名冊沒有的學號可以當場填姓名新增。
- **掃描**：使用 [html5-qrcode](https://github.com/mebjas/html5-qrcode)（從 unpkg 載入），支援 Code 39、Code 128 等常見的學生證條碼，需要瀏覽器允許使用相機。
- **班級**：名冊的「班級」欄有填就依班級分組；沒填就依學號推算年級（例如 `51106069` 是 111 學年入學、應英科 06）。
- **作廢**：收錯時在「今日收款」按「作廢」並填原因。紀錄不會刪除，只會標成作廢，號碼也不再使用。
- **會費規則**：五專會費入會時繳一次，五年有效。只要「收款紀錄」裡有一筆有效的紀錄就算已繳，不分學年。
- **新學年**：每年 8 月把「設定」分頁的「目前學年」加 1（例如 `116`）。網站用它推算年級：入學滿五年的同學會標成「已畢業」，排在班級名單最後；延畢的同學一樣可以收款。收據編號也會從新學年的 `001` 開始，例如 `116-001`。
- **換屆**：在「幹部」分頁刪掉舊幹部、加上新幹部，立刻生效。
- 收款或作廢後，學生查詢馬上會更新；直接改試算表的話，最多 1 分鐘會反映到網站。
- 從 LINE 點開收費頁時，Google 會擋住登入，請改用 Chrome 或 Safari 開啟。

## 新增部門

部門要同時改兩個地方：`admin/config.yml` 的 `dept` 選項，以及 `scripts/build_data.py` 的 `DEPARTMENTS`。

## 尚未完成

- 舊文章搬遷：目前 7 篇，只有 1 篇有全文。
- 文件連結：舊文件目前都指向雲端資料夾，要改成各自的檔案。
- 幹部形象照：重新拍攝後，到後台更換照片。
