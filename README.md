# 樹人醫專應用英語科學會網站

純 HTML、CSS、JavaScript 網站，發布在 GitHub Pages。成員日常操作請看 [網站內容操作說明.md](網站內容操作說明.md)。

## 架構

- 內容後台：`/admin`（Sveltia CMS），編輯結果存進 `content/`，上傳的圖片和檔案存進 `assets/uploads/`。
- 發布：推送到 `main` 後，GitHub Actions 執行 `scripts/build_data.py` 產生 `data/site.json`，再部署網站，約需 1 到 2 分鐘。
- 意見投遞箱：網站送到 Google Apps Script，再寫進試算表的「意見」分頁。
- 會費查詢：獨立網站 `https://lezhaia.github.io/paycheck/`，選單直接連過去。

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

### 3. 意見投遞箱

1. 新增一份 Google 試算表。
2. 選「擴充功能 > Apps Script」，貼上 [apps-script/Code.gs](apps-script/Code.gs) 並儲存。
3. 選「部署 > 新增部署作業」，類型選「網頁應用程式」，「執行身分」選自己，「誰可以存取」選「所有人」。
4. 把結尾是 `/exec` 的網址填進 `config.js` 的 `feedbackUrl`。

之後修改 `Code.gs` 時，要選「部署 > 管理部署作業 > 編輯 > 新版本」才會生效。

## 新增部門

部門要同時改兩個地方：`admin/config.yml` 的 `dept` 選項，以及 `scripts/build_data.py` 的 `DEPARTMENTS`。

## 尚未完成

- 舊文章搬遷：目前 7 篇，只有 1 篇有全文。
- 文件連結：舊文件目前都指向雲端資料夾，要改成各自的檔案。
- 幹部形象照：重新拍攝後，到後台更換照片。
