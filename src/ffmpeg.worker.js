'use strict';

let Core = null;
let mainFn = null;
let duration = 0;

const ts2sec = (ts) =>
  ts.split(':').reduce((acc, v, i) => acc + parseFloat(v) * [3600, 60, 1][i], 0);

const parseProgress = (msg) => {
  if (msg.startsWith('  Duration')) {
    const ts = msg.split(', ')[0].split(': ')[1];
    if (ts && ts !== 'N/A') duration = ts2sec(ts);
  } else if ((msg.startsWith('frame') || msg.startsWith('size')) && duration > 0) {
    const tsPart = msg.split('time=')[1]?.split(' ')[0];
    if (tsPart && tsPart !== 'N/A') {
      const ratio = Math.min(ts2sec(tsPart) / duration, 1);
      if (ratio >= 0) self.postMessage({ type: 'progress', ratio });
    }
  }
};

// Allocate C argv array and return [argc, argvPtr]
const buildArgv = (args) => {
  const ptr = Core._malloc(args.length * Uint32Array.BYTES_PER_ELEMENT);
  args.forEach((s, i) => {
    const sz = Core.lengthBytesUTF8(s) + 1;
    const buf = Core._malloc(sz);
    Core.stringToUTF8(s, buf, sz);
    Core.setValue(ptr + i * Uint32Array.BYTES_PER_ELEMENT, buf, 'i32');
  });
  return [args.length, ptr];
};

self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'load') {
      // Import inside the handler so any failure is caught and reported
      // as a proper { type: 'error' } message instead of a silent onerror.
      if (!Core) {
        importScripts('/ffmpeg/ffmpeg-core.js');
        Core = await createFFmpegCore({
          printErr: parseProgress,
          print: (msg) => {
            if (msg === 'FFMPEG_END') {
              // handled via onExit / Promise resolve below
            }
          },
          locateFile: (path) => {
            if (path.endsWith('.wasm')) return '/ffmpeg/ffmpeg-core.wasm';
            if (path.endsWith('.worker.js')) return '/ffmpeg/ffmpeg-core.worker.js';
            return path;
          },
        });
        mainFn = Core.cwrap('main', 'number', ['number', 'number']);
      }
      self.postMessage({ type: 'ready' });

    } else if (data.type === 'convert') {
      duration = 0;
      Core.FS.writeFile('in.webm', new Uint8Array(data.buffer));

      await new Promise((resolve, reject) => {
        const origPrintErr = Core.printErr;
        const origPrint = Core.print;
        Core.printErr = (msg) => { origPrintErr?.(msg); parseProgress(msg); };
        Core.print = (msg) => {
          if (msg === 'FFMPEG_END') {
            Core.printErr = origPrintErr;
            Core.print = origPrint;
            resolve();
          }
        };

        try {
          const [argc, argv] = buildArgv([
            './ffmpeg', '-nostdin', '-y',
            '-i', 'in.webm',
            '-c:v', 'libx264',
            '-preset', 'ultrafast',
            '-crf', '24',
            '-pix_fmt', 'yuv420p',
            '-c:a', 'aac',
            '-ar', '44100',
            '-b:a', '192k',
            '-af', 'aresample=async=1:min_hard_comp=0.100000:first_pts=0',
            '-movflags', '+faststart',
            'out.mp4',
          ]);
          mainFn(argc, argv);
        } catch (e) {
          Core.printErr = origPrintErr;
          Core.print = origPrint;
          // single-threaded core throws on exit — check if output was written
          try {
            Core.FS.stat('out.mp4');
            resolve();
          } catch {
            reject(e);
          }
        }
      });

      const output = Core.FS.readFile('out.mp4');
      try { Core.FS.unlink('in.webm'); } catch {}
      try { Core.FS.unlink('out.mp4'); } catch {}

      self.postMessage({ type: 'done', buffer: output.buffer }, [output.buffer]);
    }
  } catch (e) {
    self.postMessage({ type: 'error', message: e?.message || String(e) });
  }
};
