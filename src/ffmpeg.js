// ===========================================================
// Slidecast — ffmpeg.wasm wrapper (0.11.x, Web Worker)
// All ffmpeg work runs inside a dedicated Worker; the main thread
// only sends/receives messages and is never blocked during transcoding.
// ===========================================================

export class SlidecastFFmpeg {
  constructor() {
    this.ready = false;
    this._worker = null;
    this._loadPromise = null;
  }

  _ensureWorker() {
    if (this._worker) return;
    this._worker = new Worker(
      new URL('./ffmpeg.worker.js', import.meta.url),
      { type: 'classic' },
    );
  }

  load() {
    if (this.ready) return Promise.resolve();
    if (this._loadPromise) return this._loadPromise;
    this._ensureWorker();
    this._loadPromise = new Promise((resolve, reject) => {
      const handler = ({ data }) => {
        if (data.type !== 'ready' && data.type !== 'error') return;
        this._worker.removeEventListener('message', handler);
        if (data.type === 'ready') { this.ready = true; resolve(); }
        else reject(new Error(data.message));
      };
      this._worker.addEventListener('message', handler);
      this._worker.onerror = (e) => {
        this._worker.removeEventListener('message', handler);
        const msg = e.message || e.filename
          ? `Worker error at ${e.filename}:${e.lineno} — ${e.message}`
          : 'Worker 無法啟動（請確認瀏覽器支援 WebAssembly 並重新整理頁面）';
        reject(new Error(msg));
      };
      this._worker.postMessage({ type: 'load' });
    });
    return this._loadPromise;
  }

  async webmToMp4(webmBlob, { onConvertProgress } = {}) {
    if (!this.ready) await this.load();

    // Read the blob into a transferable ArrayBuffer before handing off to the
    // worker — the transfer moves ownership (zero-copy) so the main thread
    // doesn't hold a large allocation while conversion runs.
    const buffer = await webmBlob.arrayBuffer();

    return new Promise((resolve, reject) => {
      const handler = ({ data }) => {
        if (data.type === 'progress') {
          onConvertProgress?.(data.ratio);
        } else if (data.type === 'done') {
          this._worker.removeEventListener('message', handler);
          resolve(new Blob([data.buffer], { type: 'video/mp4' }));
        } else if (data.type === 'error') {
          this._worker.removeEventListener('message', handler);
          reject(new Error(data.message));
        }
      };
      this._worker.addEventListener('message', handler);
      this._worker.postMessage({ type: 'convert', buffer }, [buffer]);
    });
  }
}
