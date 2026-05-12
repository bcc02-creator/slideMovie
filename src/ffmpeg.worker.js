// Runs inside a dedicated Web Worker so ffmpeg.wasm never blocks the main thread.
'use strict';

importScripts('/ffmpeg/ffmpeg.min.js');

let ff = null;

self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'load') {
      const { createFFmpeg } = self.FFmpeg;
      ff = createFFmpeg({
        log: false,
        logger: ({ type, message }) => {
          if (type === 'fferr' && (message.includes('frame=') || message.includes('time='))) {
            self.postMessage({ type: 'log', message });
          }
        },
        mainName: 'main',
        corePath: `${self.location.origin}/ffmpeg/ffmpeg-core.js`,
      });
      await ff.load();
      self.postMessage({ type: 'ready' });

    } else if (data.type === 'convert') {
      ff.setProgress(({ ratio }) => {
        if (typeof ratio === 'number' && ratio >= 0) {
          self.postMessage({ type: 'progress', ratio: Math.max(0, Math.min(1, ratio)) });
        }
      });

      ff.FS('writeFile', 'in.webm', new Uint8Array(data.buffer));
      await ff.run(
        '-i', 'in.webm',
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-crf', '24',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-movflags', '+faststart',
        'out.mp4',
      );
      const output = ff.FS('readFile', 'out.mp4');
      try { ff.FS('unlink', 'in.webm'); } catch {}
      try { ff.FS('unlink', 'out.mp4'); } catch {}
      ff.setProgress(() => {});

      // Transfer (zero-copy) the result back to the main thread
      self.postMessage({ type: 'done', buffer: output.buffer }, [output.buffer]);
    }
  } catch (e) {
    self.postMessage({ type: 'error', message: e?.message || String(e) });
  }
};
