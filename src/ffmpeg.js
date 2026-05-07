// ===========================================================
// Slidecast — ffmpeg.wasm wrapper (0.11.x, no worker complications)
// 0.12.x requires same-origin worker which breaks in cross-origin iframes.
// 0.11.x runs everything via importScripts inside a single worker created
// internally — and accepts a CDN corePath directly. CORS-enabled CDN works.
// Note: 0.11 needs SharedArrayBuffer normally — but we use single-thread core
// (@ffmpeg/core 0.11.0 single-thread) which doesn't.
// ===========================================================

export class SlidecastFFmpeg {
  constructor() {
    this.ready = false;
    this.loading = false;
    this.ffmpeg = null;
    this._loadPromise = null;
  }

  _injectScript(src) {
    return new Promise((res, rej) => {
      const existing = document.querySelector(`script[src="${src}"]`);
      if (existing) { res(); return; }
      const s = document.createElement('script');
      s.src = src;
      s.crossOrigin = 'anonymous';
      s.onload = res;
      s.onerror = () => rej(new Error('Failed to load ' + src));
      document.head.appendChild(s);
    });
  }

  async load(onProgress) {
    if (this.ready) return;
    if (this._loadPromise) return this._loadPromise;
    this._loadPromise = (async () => {
      this.loading = true;
      onProgress && onProgress(0.05);

      // 0.11.6 — exposes window.FFmpeg with createFFmpeg / fetchFile
      if (!window.FFmpeg) {
        await this._injectScript('https://unpkg.com/@ffmpeg/ffmpeg@0.11.6/dist/ffmpeg.min.js');
      }
      onProgress && onProgress(0.3);

      const { createFFmpeg } = window.FFmpeg;
      this.ffmpeg = createFFmpeg({
        log: false,
        logger: ({ type, message }) => {
          // Surface ffmpeg lifecycle in console so users can confirm activity
          // even when setProgress callback doesn't fire.
          if (type === 'fferr' && (message.includes('frame=') || message.includes('time='))) {
            console.log('[ffmpeg]', message);
          }
        },
        // mainName 'main' tells the wrapper to call _main (not proxy_main)
        // — required for single-thread cores that don't expose proxy_main.
        mainName: 'main',
        corePath: 'https://unpkg.com/@ffmpeg/core-st@0.11.1/dist/ffmpeg-core.js',
      });
      onProgress && onProgress(0.5);
      await this.ffmpeg.load();
      onProgress && onProgress(1);

      this.ready = true;
      this.loading = false;
    })();
    return this._loadPromise;
  }

  async webmToMp4(webmBlob, { onLoadProgress, onConvertProgress } = {}) {
    if (!this.ready) await this.load(onLoadProgress);
    const ff = this.ffmpeg;
    const { fetchFile } = window.FFmpeg;

    if (onConvertProgress) {
      ff.setProgress(({ ratio }) => {
        if (typeof ratio === 'number' && ratio >= 0) {
          onConvertProgress(Math.max(0, Math.min(1, ratio)));
        }
      });
    }

    const inName = 'in.webm';
    const outName = 'out.mp4';
    ff.FS('writeFile', inName, await fetchFile(webmBlob));

    try {
      await ff.run(
        '-i', inName,
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-crf', '24',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-movflags', '+faststart',
        outName,
      );
      const data = ff.FS('readFile', outName);
      try { ff.FS('unlink', inName); } catch {}
      try { ff.FS('unlink', outName); } catch {}
      return new Blob([data.buffer], { type: 'video/mp4' });
    } finally {
      try { ff.setProgress(() => {}); } catch {}
    }
  }
}


