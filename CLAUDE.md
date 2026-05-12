# Slidecast — CLAUDE.md

## 專案概述

**Slidecast** 是一個純前端瀏覽器應用，把投影片（PDF / 圖片 / HTML deck）+ 配音 + 字幕組合成可下載的影片。  
不需要後端伺服器；所有運算都在瀏覽器內完成。

## 技術棧

| 層次 | 技術 |
|------|------|
| UI Framework | React 18 (JSX) |
| 打包工具 | Vite 5 |
| 投影片解析 | pdf.js 3.11 (CDN worker) |
| 影片轉檔 | ffmpeg.wasm 0.11.x |
| 語音合成 | Web Speech API (SpeechSynthesis) |
| 音訊 | Web Audio API |
| 錄製 | MediaRecorder API |
| 持久化 | IndexedDB（瀏覽器本機）|
| 樣式 | 純 inline styles，無 CSS 框架 |
| 型別 | 無 TypeScript，純 JavaScript |

## 開發指令

```bash
npm install          # 安裝相依
npm run dev          # 開發伺服器 → http://localhost:5173
npm run build        # 打包到 dist/
npm run preview      # 預覽打包結果
```

## 架構與模組

```
src/
├── main.jsx       # ReactDOM 入口
├── app.jsx        # 主應用 component（所有 UI + 狀態）
├── audio.js       # SlidecastAudio（Web Audio 引擎）、SlidecastRecorder（MediaRecorder）
├── tts.js         # SlidecastTTS（Web Speech API 包裝）
├── ffmpeg.js      # SlidecastFFmpeg（ffmpeg.wasm WebM→MP4）
├── renderer.js    # SlidecastRenderer（Canvas 渲染器，支援 images / iframe 兩種模式）
├── parsers.js     # PDF 解析、字幕解析（SRT/VTT/JSON/純文字）、工具函式
├── persist.js     # buildSnapshot / rehydrateProject（IndexedDB 存取序列化）
└── db.js          # SlidecastDB（IndexedDB CRUD）
```

### 關鍵設計決策

- **`app.jsx` 是單體**：所有狀態都在這裡，子元件（`DropZone`、`Section`、`Btn`）與 hook（`useToast`）定義在同一個檔案內。不要把狀態分散到獨立 context 或 store，維持現有扁平結構。
- **樣式 token**：所有顏色從 `SC_COLORS` 物件取用，寫在 `app.jsx` 頂部。新增 UI 一律引用這個物件，不要硬編碼色碼。
- **Renderer 模式**：`SlidecastRenderer` 有兩個模式：`'images'`（Canvas 繪製）和 `'iframe'`（HTML deck）。Canvas 在兩種模式都存在，iframe 模式下 Canvas 背景透明、只渲染字幕疊層。
- **無 TypeScript**：所有檔案都是 `.js` / `.jsx`，不引入型別宣告。

### 主要狀態分組（app.jsx）

| 群組 | 主要 state | 說明 |
|------|-----------|------|
| 投影片 | `slidesMode`, `slideUrls`, `slidesCount`, `htmlDeckUrl` | `slidesMode`: `'pdf'` \| `'images'` \| `'html'` |
| 配音 | `voMode`, `voFiles`, `totalDuration` | `voMode`: `'upload'` \| `'tts'` |
| TTS | `ttsVoiceURI`, `ttsRate`, `ttsPitch`, `ttsVoices` | 透過 `SlidecastTTS` 驅動 |
| 背景音樂 | `bgmFile`, `bgmBase`, `bgmPreviewing` | `bgmBase` 預設 0.18 |
| 字幕 | `transcript`, `transcriptName`, `segments` | `segments`: `[{idx,start,end,slide,cues}]` |
| 片頭／片尾 | `introFile`, `introType`, `introDuration`, `outroFile`, `outroType`, `outroDuration` | `type`: `'image'` \| `'video'` |
| 播放 | `playing`, `time`, `currentSlide`, `currentCue` | |
| 設定 | `showSubs`, `resolution` | `resolution` 預設 `'1920x1080'` |
| 錄製 | `recording`, `recordedBlob`, `mp4Stage`, `mp4Progress` | `mp4Stage`: `'idle'\|'loading'\|'converting'\|'done'\|'error'` |
| 專案 | `projectId`, `projectName`, `savedProjects`, `autoSaveOn`, `lastSavedAt` | |

### 片頭／片尾（Bumper）

`playBumper(file, type, duration)` 在錄製序列中插入片頭或片尾：
- **image 型**：在 canvas 渲染靜態圖片，持續 `duration` 秒。
- **video 型**：透過 `connectMediaElement()` 將影片音訊路由進 Web Audio 以被 MediaRecorder 捕捉；播到結束為止。
- 錄製序列：片頭 → 主體播放 → 片尾 → `stop()`，任何步驟皆可透過 `recordingAbortedRef` 中斷。

### 自動儲存

- 編輯後 4 秒 debounce 觸發 `saveCurrentProject(false)`。
- **只有在使用者至少手動儲存過一次**（`projectId` 存在）才會自動儲存。
- Cmd/Ctrl+S 可隨時手動儲存。

### IndexedDB 結構（db.js）

DB 名稱 `slidecast`，版本 1，兩個 object store：

| Store | keyPath | Indices | 說明 |
|-------|---------|---------|------|
| `projects` | `id` | `updatedAt` | 儲存 payload（不含 Blob）|
| `blobs` | `id`（autoIncrement）| `projectId`, `projectRole` | `role` ∈ `'slide'\|'vo'\|'bgm'\|'html'\|'intro'\|'outro'` |

`SlidecastDB` 公開 API：`listProjects`, `saveProject`, `loadProject`, `deleteProject`, `renameProject`, `getStorageEstimate`。

## 重要限制與已知約束

### SharedArrayBuffer / COOP+COEP
ffmpeg.wasm 需要 `SharedArrayBuffer`，必須有以下 HTTP headers：
```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```
- **本機開發**：`vite.config.js` 已設定這兩個 header，MP4 轉檔正常。
- **GitHub Pages**：不支援自訂 headers → WebM 正常，**MP4 轉檔無法使用**。
- **Vercel**：`vercel.json` 已設定 headers，MP4 可用。
- **其他平台**：Netlify / Cloudflare Pages 需另外設定 `_headers` 或 `netlify.toml`。

### 錄製限制
- 錄製（`SlidecastRecorder`）**只支援 PDF / 圖片**來源，HTML deck 因瀏覽器安全限制無法錄製。
- TTS 模式（Web Speech API）因瀏覽器限制**無法被 MediaRecorder 捕捉**，只能即時預覽。
- 片頭／片尾影片的音訊透過 `connectMediaElement()` 路由進 Web Audio，才能被 MediaRecorder 捕捉。

### 資料儲存
- 所有專案資料存在瀏覽器 **IndexedDB**，不上傳伺服器。
- Blob（投影片圖片、音檔、片頭片尾）直接存為 Blob，大型專案可能佔用可觀的空間。

## 部署

目前 `vercel.json` 設定支援 Vercel 部署（含 COOP/COEP headers）。  
GitHub Actions workflow 在 `.github/workflows/deploy.yml`，自動部署到 GitHub Pages（**僅 WebM**，不支援 MP4）。

`vite.config.js` 的 `base` 目前設為 `'/'`，部署到子路徑需修改。
