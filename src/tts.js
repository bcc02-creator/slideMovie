// ===========================================================
// Slidecast — TTS module
// Uses browser's SpeechSynthesis API to generate per-segment voiceover.
// We capture audio via MediaRecorder on a virtual MediaStream because
// SpeechSynthesisUtterance does NOT route through Web Audio.
//
// Strategy: speak each utterance, time how long it takes, generate a
// silent matching-length AudioBuffer per segment, and play live TTS in
// parallel during preview. For RECORDING, we capture the page's audio
// via getDisplayMedia({audio:true}) — but that requires user prompt.
//
// Practical approach (best browser support):
//  - "Live preview" mode: play TTS directly via speechSynthesis; we
//    track timings so subtitles + slides sync to it. No recording.
//  - "Bake" mode: speak each utterance and measure its duration via
//    onstart/onend events; create silent placeholder buffers of that
//    length; user is told that to RECORD a video they should screen-
//    record their tab (since speechSynthesis can't be captured into
//    MediaStreamDestination directly in any browser).
//
// We expose:
//   - listVoices(lang)
//   - bakeSegments({voice, rate, pitch, lines})  -> [{durationMs, text}]
//   - speak(line, opts) -> Promise (resolves on end)
//   - cancel()
// ===========================================================

export class SlidecastTTS {
  constructor() {
    this.synth = window.speechSynthesis;
    this._voicesPromise = null;
    this._segments = [];   // baked: [{text, durationMs, line}]
    this._totalMs = 0;
    this._currentUtter = null;
    this._opts = { voice: null, rate: 1.0, pitch: 1.0 };
  }

  isSupported() {
    return !!(window.speechSynthesis && window.SpeechSynthesisUtterance);
  }

  // Voices load asynchronously in some browsers
  async listVoices() {
    if (!this.isSupported()) return [];
    if (this._voicesPromise) return this._voicesPromise;
    this._voicesPromise = new Promise((resolve) => {
      const initial = this.synth.getVoices();
      if (initial && initial.length) { resolve(initial); return; }
      const onChange = () => {
        const v = this.synth.getVoices();
        if (v && v.length) {
          this.synth.removeEventListener('voiceschanged', onChange);
          resolve(v);
        }
      };
      this.synth.addEventListener('voiceschanged', onChange);
      // fallback: resolve empty after 2s
      setTimeout(() => resolve(this.synth.getVoices() || []), 2000);
    });
    return this._voicesPromise;
  }

  async listChineseVoices() {
    const all = await this.listVoices();
    // include zh-TW, zh-HK, zh-CN, zh
    return all.filter(v => /^zh(-|_)?/i.test(v.lang) || /chinese|mandarin|cantonese/i.test(v.name));
  }

  setOptions(opts) { Object.assign(this._opts, opts); }

  // Speak a single line; resolves with measured duration in ms.
  speak(text, { onBoundary } = {}) {
    return new Promise((resolve, reject) => {
      if (!this.isSupported()) { reject(new Error('SpeechSynthesis 不支援')); return; }
      const u = new SpeechSynthesisUtterance(text);
      const { voice, rate, pitch } = this._opts;
      if (voice) u.voice = voice;
      u.lang = voice?.lang || 'zh-TW';
      u.rate = rate ?? 1.0;
      u.pitch = pitch ?? 1.0;
      u.volume = 1.0;
      let startedAt = 0;
      u.onstart = () => { startedAt = performance.now(); };
      u.onend = () => {
        const dur = Math.max(50, performance.now() - startedAt);
        resolve(dur);
      };
      u.onerror = (e) => reject(new Error('TTS 錯誤: ' + (e.error || 'unknown')));
      if (onBoundary) u.onboundary = onBoundary;
      this._currentUtter = u;
      this.synth.speak(u);
    });
  }

  cancel() {
    try { this.synth.cancel(); } catch {}
    this._currentUtter = null;
  }

  // Estimate duration from char count (Chinese ~ 4 chars/sec at rate=1)
  estimateMs(text, rate = 1) {
    const chars = text.length;
    const cps = 4.0 * rate; // chars per second
    return Math.max(800, (chars / cps) * 1000 + 250); // +250ms tail
  }

  // Bake: estimate durations for all lines without actually speaking them.
  // (We can't actually capture TTS audio into a Blob in any current browser.
  // So "bake" just produces a virtual timeline; live playback uses speak().)
  bakeEstimate(lines) {
    const rate = this._opts.rate ?? 1.0;
    let cursor = 0;
    const segs = lines.map((text, idx) => {
      const ms = this.estimateMs(text, rate);
      const seg = {
        idx, text,
        start: cursor / 1000,
        end: (cursor + ms) / 1000,
        durationMs: ms,
      };
      cursor += ms;
      return seg;
    });
    this._segments = segs;
    this._totalMs = cursor;
    return { segments: segs, totalMs: cursor };
  }

  // Actually speak in sequence (live preview mode), advancing slide on each segment start.
  // Returns a controller {pause, resume, cancel, getCurrentTime, isPlaying}.
  startLivePlayback({ lines, onSegmentStart, onSegmentEnd, onTick, onAllDone }) {
    let cancelled = false;
    let curIdx = 0;
    let segStartPerf = 0;
    let elapsedBefore = 0;
    const tickInterval = 100;
    let tickTimer = null;
    let paused = false;

    const tick = () => {
      if (cancelled || paused) return;
      const segElapsed = performance.now() - segStartPerf;
      const totalSec = (this._segments.slice(0, curIdx).reduce((a,s)=>a+s.durationMs,0) + segElapsed) / 1000;
      onTick && onTick(totalSec, curIdx);
    };

    const speakNext = async () => {
      if (cancelled) return;
      if (curIdx >= lines.length) { onAllDone && onAllDone(); return; }
      const text = lines[curIdx];
      onSegmentStart && onSegmentStart(curIdx, text);
      segStartPerf = performance.now();
      tickTimer = setInterval(tick, tickInterval);
      try {
        const dur = await this.speak(text);
        if (this._segments[curIdx]) this._segments[curIdx].durationMs = dur;
      } catch (e) {
        // swallow individual TTS errors and continue
        console.warn('TTS segment failed', e);
      }
      clearInterval(tickTimer);
      onSegmentEnd && onSegmentEnd(curIdx);
      curIdx++;
      if (!cancelled) speakNext();
    };

    speakNext();

    return {
      cancel: () => { cancelled = true; clearInterval(tickTimer); this.cancel(); },
      pause: () => { paused = true; this.synth.pause(); clearInterval(tickTimer); },
      resume: () => { paused = false; this.synth.resume(); tickTimer = setInterval(tick, tickInterval); },
      isPlaying: () => !cancelled && curIdx < lines.length,
      getCurrentIndex: () => curIdx,
    };
  }
}


