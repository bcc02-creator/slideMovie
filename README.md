# Slidecast — 投影片配音影片產生器

把投影片（PDF / 圖片 / HTML deck）+ 配音 + 字幕，組合成可下載的影片。全部在瀏覽器跑，不需要伺服器。

## 功能

- **投影片來源**：PDF（pdf.js 解析）、圖片序列、HTML deck
- **配音**：上傳音檔（依檔名數字排序）或 Web Speech TTS 試聽
- **字幕**：SRT / VTT / JSON / 純文字逐字稿
- **背景音樂**：可調音量、自動 ducking
- **錄製輸出**：WebM（即時錄製）或 MP4（ffmpeg.wasm 轉檔）
- **專案存檔**：IndexedDB 本機儲存，多專案管理、自動儲存

## 專案結構

```
slidecast/
├── index.html                # Vite 入口
├── package.json
├── vite.config.js            # Vite 設定（含 base、COOP/COEP）
├── README.md
├── .gitignore
├── .github/workflows/
│   └── deploy.yml            # GitHub Actions 自動部署
└── src/
    ├── main.jsx              # ReactDOM 掛載入口
    ├── App.jsx               # 主應用 component
    ├── audio.js              # WebAudio 引擎 + 錄製
    ├── tts.js                # Web Speech TTS
    ├── ffmpeg.js             # MP4 轉檔
    ├── renderer.js           # 投影片畫面渲染
    ├── parsers.js            # PDF / 字幕解析
    ├── persist.js            # 專案 snapshot build/apply
    └── db.js                 # IndexedDB 儲存
```

## 本機開發

```bash
# 安裝相依套件
npm install

# 啟動開發伺服器（http://localhost:5173）
npm run dev

# 打包到 dist/
npm run build

# 預覽打包結果
npm run preview
```

## 部署到 GitHub Pages

### 1. 設定 base path

打開 `vite.config.js`，把 `base` 改成你的 repo 名稱：

```js
// 假設 repo URL 是 https://github.com/USER/slidecast
// 部署後網址會是 https://USER.github.io/slidecast/
export default defineConfig({
  base: '/slidecast/',  // ← 改這裡，前後都要有斜線
  // ...
});
```

> User/Org page（`USER.github.io`）或自訂網域：改成 `base: '/'`

### 2. 把專案推到 GitHub

```bash
git init
git add .
git commit -m "init"
git branch -M main
git remote add origin https://github.com/USER/REPO.git
git push -u origin main
```

### 3. 啟用 GitHub Pages

到 repo 的 **Settings → Pages**：
- **Source** 選 `GitHub Actions`

接著每次 push 到 `main` branch，`.github/workflows/deploy.yml` 會自動執行：

1. 安裝 npm 套件
2. `npm run build`
3. 把 `dist/` 部署到 GitHub Pages

部署完成後到 **Actions** tab 看綠勾勾，網址會在 workflow 結果裡。

### 4. （可選）手動部署

如果不想用 GitHub Actions，可以用 `gh-pages` 套件：

```bash
npm run deploy
```

這會打包並推到 `gh-pages` branch；接著 Settings → Pages 把 Source 設為 `Deploy from a branch` → `gh-pages` / `/`。

---

## ⚠️ MP4 轉檔在 GitHub Pages 上不能用

ffmpeg.wasm 需要 `SharedArrayBuffer`，必須有以下 HTTP headers：

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

**GitHub Pages 不支援自訂 headers**，所以部署在 GitHub Pages 上：
- ✅ 錄製 WebM 正常
- ❌ MP4 轉檔會失敗

要支援 MP4，請改用支援 headers 的平台：

### Cloudflare Pages

1. Connect Git repo
2. Build command: `npm run build`
3. Output: `dist`
4. 在 repo 根目錄新增 `public/_headers`：
   ```
   /*
     Cross-Origin-Opener-Policy: same-origin
     Cross-Origin-Embedder-Policy: require-corp
   ```

### Netlify

新增 `netlify.toml`：

```toml
[build]
  command = "npm run build"
  publish = "dist"

[[headers]]
  for = "/*"
  [headers.values]
    Cross-Origin-Opener-Policy = "same-origin"
    Cross-Origin-Embedder-Policy = "require-corp"
```

### Vercel

新增 `vercel.json`：

```json
{
  "headers": [{
    "source": "/(.*)",
    "headers": [
      { "key": "Cross-Origin-Opener-Policy", "value": "same-origin" },
      { "key": "Cross-Origin-Embedder-Policy", "value": "require-corp" }
    ]
  }]
}
```

---

## 使用流程

1. 上傳 PDF / 圖片 / HTML deck
2. 上傳配音音檔（每段一個檔，依檔名排序）或開啟 TTS 試聽
3. （可選）上傳字幕、BGM
4. 預覽 → 微調段落
5. 錄製 → 下載 WebM 或轉 MP4

**專案存檔**：右上角 `💾 儲存`、`📂 開啟…`、`＋ 新建`，或按 `Cmd/Ctrl+S`。資料存在瀏覽器 IndexedDB，不會上傳。

## 瀏覽器需求

- Chrome / Edge 90+（推薦）
- Firefox 100+
- Safari 16+（部分功能受限）
 