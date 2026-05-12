// ===========================================================
// Slidecast — audio mixer + recorder
// Web Audio: voiceover (gapless concat or single track) + BGM ducking
// MediaRecorder: combines canvas video stream + mixed audio -> webm
// ===========================================================

export class SlidecastAudio {
  constructor() {
    this.ctx = null;
    this.master = null;       // -> destination
    this.recordDest = null;   // MediaStreamDestination for recording
    this.voGain = null;
    this.bgmGain = null;
    this.bgmBaseLevel = 0.18; // BGM volume relative to VO
    this.bgmDuckLevel = 0.06;
    this.bgmSource = null;
    this.bgmBuffer = null;
    this.voBuffers = [];      // {buffer, name}
    this.voSegments = [];     // computed timing: {idx, start, end}
    this.totalVoDuration = 0;
    this.scheduledSources = [];
    this.startedAtCtxTime = 0;
    this.startedAtVoOffset = 0;
    this.playing = false;
    this.bgmStartedAt = 0;
    this.bgmIsStandalone = false; // true while BGM runs via playBgmOnly (not tied to VO)
  }

  ensureCtx() {
    if (this.ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = 1;
    this.master.connect(this.ctx.destination);
    this.recordDest = this.ctx.createMediaStreamDestination();
    this.master.connect(this.recordDest);

    this.voGain = this.ctx.createGain();
    this.voGain.gain.value = 1;
    this.voGain.connect(this.master);

    this.bgmGain = this.ctx.createGain();
    this.bgmGain.gain.value = 0;
    this.bgmGain.connect(this.master);
  }

  async loadVoiceover(files) {
    this.ensureCtx();
    this.voBuffers = [];
    this.voSegments = [];
    let cursor = 0;
    for (const f of files) {
      const buf = await f.file.arrayBuffer();
      const audio = await this.ctx.decodeAudioData(buf.slice(0));
      const start = cursor;
      const end = cursor + audio.duration;
      this.voBuffers.push({ buffer: audio, name: f.name });
      this.voSegments.push({ idx: this.voSegments.length, start, end });
      cursor = end;
    }
    this.totalVoDuration = cursor;
    return { totalDuration: cursor, segments: [...this.voSegments] };
  }

  async loadBGM(file) {
    this.ensureCtx();
    if (!file) { this.bgmBuffer = null; return; }
    const buf = await file.arrayBuffer();
    this.bgmBuffer = await this.ctx.decodeAudioData(buf.slice(0));
  }

  setBgmLevels({ base, duck }) {
    if (typeof base === 'number') this.bgmBaseLevel = base;
    if (typeof duck === 'number') this.bgmDuckLevel = duck;
  }

  // Stop only VO sources, leaving a standalone BGM source untouched.
  _stopVoOnly() {
    for (const s of this.scheduledSources) {
      if (s === this.bgmSource) continue;
      try { s.stop(); } catch {}
      try { s.disconnect(); } catch {}
    }
    this.scheduledSources = this.scheduledSources.filter(s => s === this.bgmSource);
    this.playing = false;
  }

  // Schedule playback starting at absolute-VO offset (seconds since start)
  play(fromOffset = 0) {
    this.ensureCtx();
    if (this.ctx.state === 'suspended') this.ctx.resume();

    // If BGM was started standalone (e.g. during intro bumper), let it continue
    // without a restart gap. Only VO sources need to be cleared.
    const bgmContinue = this.bgmIsStandalone && !!this.bgmSource;
    if (bgmContinue) {
      this._stopVoOnly();
      this.bgmIsStandalone = false;
    } else {
      this.stop();
    }

    const t0 = this.ctx.currentTime + 0.05;
    this.startedAtCtxTime = t0;
    this.startedAtVoOffset = fromOffset;

    // Schedule each VO segment that ends after fromOffset
    for (const seg of this.voSegments) {
      if (seg.end <= fromOffset) continue;
      const buf = this.voBuffers[seg.idx].buffer;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.connect(this.voGain);
      const localOffset = Math.max(0, fromOffset - seg.start);
      const startAt = t0 + Math.max(0, seg.start - fromOffset);
      try {
        src.start(startAt, localOffset);
      } catch (e) {
        console.warn('VO start error', e);
      }
      this.scheduledSources.push(src);
    }

    if (this.bgmBuffer) {
      const endAt = t0 + (this.totalVoDuration - fromOffset);
      if (bgmContinue) {
        // BGM already playing — snap gain to base level (ramp may still be in
        // progress if the intro was shorter than 0.6 s) then schedule fade-out.
        const g = this.bgmGain.gain;
        g.cancelScheduledValues(this.ctx.currentTime);
        g.setValueAtTime(this.bgmBaseLevel, this.ctx.currentTime);
        g.setValueAtTime(this.bgmBaseLevel, endAt - 1.0);
        g.linearRampToValueAtTime(0, endAt + 0.2);
      } else {
        const src = this.ctx.createBufferSource();
        src.buffer = this.bgmBuffer;
        src.loop = true;
        src.connect(this.bgmGain);
        src.start(t0);
        this.bgmSource = src;
        this.scheduledSources.push(src);
        const g = this.bgmGain.gain;
        g.cancelScheduledValues(this.ctx.currentTime);
        g.setValueAtTime(0, this.ctx.currentTime);
        g.linearRampToValueAtTime(this.bgmBaseLevel, t0 + 0.6);
        g.setValueAtTime(this.bgmBaseLevel, endAt - 1.0);
        g.linearRampToValueAtTime(0, endAt + 0.2);
      }
    }

    this.playing = true;
  }

  stop() {
    for (const s of this.scheduledSources) {
      try { s.stop(); } catch {}
      try { s.disconnect(); } catch {}
    }
    this.scheduledSources = [];
    this.bgmSource = null;
    if (this.bgmGain) {
      const g = this.bgmGain.gain;
      g.cancelScheduledValues(this.ctx?.currentTime ?? 0);
      g.value = 0;
    }
    this.playing = false;
  }

  // Play BGM standalone (TTS mode or BGM preview; not tied to VO scheduling)
  playBgmOnly() {
    this.ensureCtx();
    if (this.ctx.state === 'suspended') this.ctx.resume();
    if (this.bgmSource) {
      const old = this.bgmSource;
      this.bgmSource = null;
      this.scheduledSources = this.scheduledSources.filter(s => s !== old);
      try { old.stop(); } catch {}
      try { old.disconnect(); } catch {}
    }
    if (!this.bgmBuffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.bgmBuffer;
    src.loop = true;
    src.connect(this.bgmGain);
    src.start(this.ctx.currentTime);
    this.bgmSource = src;
    this.bgmIsStandalone = true;
    const g = this.bgmGain.gain;
    g.cancelScheduledValues(this.ctx.currentTime);
    g.setValueAtTime(0, this.ctx.currentTime);
    g.linearRampToValueAtTime(this.bgmBaseLevel, this.ctx.currentTime + 0.6);
  }

  // Stop BGM without touching VO sources
  stopBgmOnly() {
    this.bgmIsStandalone = false;
    const src = this.bgmSource;
    this.bgmSource = null;
    if (src) {
      this.scheduledSources = this.scheduledSources.filter(s => s !== src);
      try { src.stop(); } catch {}
      try { src.disconnect(); } catch {}
    }
    if (this.bgmGain && this.ctx) {
      const g = this.bgmGain.gain;
      const now = this.ctx.currentTime;
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(0, now + 0.15);
    }
  }

  // Current absolute VO time (seconds since start of segment 0)
  getCurrentTime() {
    if (!this.playing || !this.ctx) return this.startedAtVoOffset;
    return this.startedAtVoOffset + (this.ctx.currentTime - this.startedAtCtxTime);
  }

  // Find which segment we're inside at time t.
  segmentAt(t) {
    for (const seg of this.voSegments) {
      if (t >= seg.start && t < seg.end) return seg;
    }
    if (t >= this.totalVoDuration) return this.voSegments[this.voSegments.length - 1] || null;
    return this.voSegments[0] || null;
  }

  getRecordingStream() {
    this.ensureCtx();
    return this.recordDest.stream;
  }

  connectMediaElement(el) {
    this.ensureCtx();
    if (this.ctx.state === 'suspended') this.ctx.resume();
    const src = this.ctx.createMediaElementSource(el);
    src.connect(this.master);
    return src;
  }
}

// ---------- Recorder: combines a <canvas> video stream + audio stream ----------

export class SlidecastRecorder {
  constructor(audioMixer) {
    this.mixer = audioMixer;
    this.recorder = null;
    this.chunks = [];
    this.mimeType = null;
  }

  pickMime() {
    const candidates = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm;codecs=h264,opus',
      'video/webm',
    ];
    for (const c of candidates) {
      if (window.MediaRecorder && MediaRecorder.isTypeSupported(c)) return c;
    }
    return 'video/webm';
  }

  start(canvas, fps = 30, onError) {
    if (!canvas || !canvas.captureStream) {
      throw new Error('canvas.captureStream not supported in this browser');
    }
    this.chunks = [];
    const videoStream = canvas.captureStream(fps);
    const audioStream = this.mixer.getRecordingStream();
    const tracks = [...videoStream.getVideoTracks(), ...audioStream.getAudioTracks()];
    const combined = new MediaStream(tracks);
    this.mimeType = this.pickMime();
    this.recorder = new MediaRecorder(combined, {
      mimeType: this.mimeType,
      videoBitsPerSecond: 6_000_000,
      audioBitsPerSecond: 192_000,
    });
    this.recorder.ondataavailable = (e) => { if (e.data && e.data.size) this.chunks.push(e.data); };
    this.recorder.onerror = (e) => onError && onError(e.error || e);
    this.recorder.start(1000);
  }

  async stop() {
    if (!this.recorder || this.recorder.state === 'inactive') {
      const blob = this.chunks.length ? new Blob(this.chunks, { type: this.mimeType }) : null;
      this.chunks = [];
      return blob;
    }
    return await new Promise((resolve) => {
      this.recorder.onstop = () => {
        const blob = new Blob(this.chunks, { type: this.mimeType });
        this.chunks = [];
        resolve(blob);
      };
      this.recorder.stop();
    });
  }
}


