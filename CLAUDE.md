# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 專案概述

**Slidecast** 是一個純前端瀏覽器應用，把投影片（PDF / 圖片）+ 配音 + 字幕組合成可下載的影片。  
不需要後端伺服器；所有運算都在瀏覽器內完成。

## 技術棧

| 層次 | 技術 |
|------|------|
| UI Framework | React 18 (JSX) |
| 打包工具 | Vite 5 |
| 投影片解析 | pdf.js 3.11 (CDN worker) |
| 影片轉檔 | ffmpeg.wasm 0.11.x |
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
npm run deploy       # build + 直接推到 gh-pages branch（需先 git remote）
```

## 架構與模組

```
src/
├── main.jsx       # ReactDOM 入口
├── app.jsx        # 主應用 component（所有 UI + 狀態）
├── audio.js       # SlidecastAudio（Web Audio 引擎）、SlidecastRecorder（MediaRecorder）
├── ffmpeg.js      # SlidecastFFmpeg（ffmpeg.wasm WebM→MP4）
├── renderer.js    # SlidecastRenderer（Canvas 渲染器，images 模式）
├── parsers.js     # PDF 解析、字幕解析（SRT/VTT/JSON/純文字）、工具函式
├── persist.js     # buildSnapshot / rehydrateProject（IndexedDB 存取序列化）
└── db.js          # SlidecastDB（IndexedDB CRUD）
```

### 關鍵設計決策

- **`app.jsx` 是單體**：所有狀態都在這裡，子元件（`DropZone`、`Section`、`Btn`）與 hook（`useToast`）定義在同一個檔案內。不要把狀態分散到獨立 context 或 store，維持現有扁平結構。
- **樣式 token**：所有顏色從 `SC_COLORS` 物件取用，寫在 `app.jsx` 頂部。新增 UI 一律引用這個物件，不要硬編碼色碼。
- **Renderer 模式**：`SlidecastRenderer` 只有 `'images'` 模式（Canvas 繪製）；`slidesMode` 只有 `'pdf'` 和 `'images'` 兩種值。
- **無 TypeScript**：所有檔案都是 `.js` / `.jsx`，不引入型別宣告。

### 主要狀態分組（app.jsx）

| 群組 | 主要 state | 說明 |
|------|-----------|------|
| 投影片 | `slidesMode`, `slideUrls`, `slidesCount` | `slidesMode`: `'pdf'` \| `'images'` |
| 配音 | `voFiles`, `totalDuration` | 上傳 MP3/WAV/M4A 音檔 |
| 背景音樂 | `bgmFile`, `bgmBase`, `bgmPreviewing` | `bgmBase` 預設 0.18，ducking 時降至 0.06 |
| 字幕 | `transcript`, `transcriptName`, `segments` | `segments`: `[{idx,start,end,slide,cues}]` |
| 片頭／片尾 | `introFile`, `introType`, `introDuration`, `outroFile`, `outroType`, `outroDuration` | `type`: `'image'` \| `'video'` |
| 播放 | `playing`, `time`, `currentSlide`, `currentCue` | |
| 設定 | `showSubs`, `resolution` | `resolution` 預設 `'1920x1080'` |
| 錄製 | `recording`, `recordedBlob`, `mp4Stage`, `mp4Progress` | `mp4Stage`: `'idle'\|'loading'\|'converting'\|'done'\|'error'` |
| 專案 | `projectId`, `projectName`, `savedProjects`, `autoSaveOn`, `lastSavedAt` | |

### 音訊混音（audio.js）

`SlidecastAudio` 建立單一 `AudioContext`，拓樸如下：

```
voGain ──┐
          ├── master ──> ctx.destination
bgmGain ─┘         └──> recordDest (MediaStreamDestination)
```

- `bgmBaseLevel` 0.18 / `bgmDuckLevel` 0.06：播放配音時 BGM 自動 duck。
- `connectMediaElement(videoEl)` 把片頭片尾影片的音訊接進同一條 master，確保 MediaRecorder 能捕捉到。
- `recordDest.stream` 與 canvas 的 `captureStream()` 合併後傳給 `MediaRecorder`。

### 片頭／片尾（Bumper）

`playBumper(file, type, duration)` 在錄製序列中插入片頭或片尾：
- **image 型**：在 canvas 渲染靜態圖片，持續 `duration` 秒。
- **video 型**：透過 `connectMediaElement()` 將影片音訊路由進 Web Audio 以被 MediaRecorder 捕捉；播到結束為止。
- 錄製序列：片頭 → 主體播放 → 片尾 → `stop()`，任何步驟皆可透過 `recordingAbortedRef` 中斷。

### 錄製流程細節

**背景分頁**：`requestAnimationFrame` 在背景分頁（非焦點）會被瀏覽器節流，導致換頁計時失準。現改以 `segTimersRef`（`useRef<number[]>`）存放各段落的 `setTimeout` ID，錄製開始時依 `segments[i].start * 1000` 排程 `rendererRef.current.setSlide(slideIdx)`，確保換頁時間不受 rAF 節流影響。另用 `Promise.race([mainDone, fallbackEnd])` 加保底計時（`totalDuration + 5` 秒），防止 rAF 完全凍結時錄製卡死。`stopRecording` 與錯誤處理皆會 `clearTimeout` 清除所有計時器。

**投影片載入順序**：`onSlidesPdf` 與 `onSlidesImages` 皆先完成 `rendererRef.current.loadImages()` 再呼叫 `URL.revokeObjectURL()` 撤銷舊 blob URL，避免 renderer 在圖片切換瞬間繪製已失效的 URL。載入完成後同步呼叫 `setSlide(0)` / `setCurrentSlide(0)` 重置預覽到第一張。`onSlidesImages` 另包 try/catch，載入失敗時立即撤銷新建的 blob URL 並顯示錯誤提示。

### ffmpeg.wasm 音訊濾鏡

MP4 轉檔使用 `-af asetpts=N/SR/TB` 重算 audio PTS（取代舊的 `aresample=async=1:min_hard_comp=0.100000:first_pts=0`），避免轉出的 MP4 在某些播放器出現音訊偏移。

### 字幕格式（parsers.js）

支援四種輸入，`parseTranscriptFile()` 依副檔名自動判斷：

| 格式 | 解析結果 | 備註 |
|------|---------|------|
| `.srt` / `.vtt` | `flatCues: [{start,end,text}]` | 時間軸字幕 |
| `.json`（flat）| `flatCues: [{start,end,text,slide?}]` | 陣列每項含 start/end |
| `.json`（per-slide）| `perSlideCues: [{slide,cues:[]}]` | 陣列每項含 cues 陣列 |
| `.txt` | `perSlideCues`，依空行分段 | 每段對應一張投影片 |

### 自動儲存

- 編輯後 4 秒 debounce 觸發 `saveCurrentProject(false)`。
- **只有在使用者至少手動儲存過一次**（`projectId` 存在）才會自動儲存。
- Cmd/Ctrl+S 可隨時手動儲存。

### IndexedDB 結構（db.js）

DB 名稱 `slidecast`，版本 1，兩個 object store：

| Store | keyPath | Indices | 說明 |
|-------|---------|---------|------|
| `projects` | `id` | `updatedAt` | 儲存 payload（不含 Blob）|
| `blobs` | `id`（autoIncrement）| `projectId`, `projectRole` | `role` ∈ `'slide'\|'vo'\|'bgm'\|'intro'\|'outro'` |

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
- 錄製（`SlidecastRecorder`）**只支援 PDF / 圖片**來源。
- 片頭／片尾影片的音訊透過 `connectMediaElement()` 路由進 Web Audio，才能被 MediaRecorder 捕捉。

### 資料儲存
- 所有專案資料存在瀏覽器 **IndexedDB**，不上傳伺服器。
- Blob（投影片圖片、音檔、片頭片尾）直接存為 Blob，大型專案可能佔用可觀的空間。

## 部署

目前 `vercel.json` 設定支援 Vercel 部署（含 COOP/COEP headers）。  
GitHub Actions workflow 在 `.github/workflows/deploy.yml`，自動部署到 GitHub Pages（**僅 WebM**，不支援 MP4）。

`vite.config.js` 的 `base` 目前設為 `'/'`，部署到子路徑（例如 GitHub Pages project page）需改為 `'/REPO/'`。
