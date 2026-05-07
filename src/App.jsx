// ===========================================================
// Slidecast — main React app
// ===========================================================

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { SlidecastAudio, SlidecastRecorder } from './audio.js';
import { SlidecastTTS } from './tts.js';
import { SlidecastFFmpeg } from './ffmpeg.js';
import { SlidecastRenderer } from './renderer.js';
import { SlidecastDB } from './db.js';
import { buildSnapshot, rehydrateProject } from './persist.js';
import {
  renderPdfToFrames, imageFilesToUrls, htmlFileToUrl, audioFilesToList,
  parseTranscriptFile, chunkLine, fmtTime, fmtBytes,
} from './parsers.js';

// ----- Color tokens -----
const SC_COLORS = {
  bg: '#0b0d12',
  bg2: '#11141b',
  panel: '#161a23',
  panel2: '#1c2230',
  border: '#262d3d',
  borderHi: '#3a4358',
  text: '#e6ebf5',
  textDim: '#8c97ad',
  accent: '#7c9cff',
  accentHot: '#a8bcff',
  ok: '#5fd28a',
  warn: '#f0b860',
  err: '#ef6b6b',
};

// Toolbar button base style
const tbBtn = {
  background: SC_COLORS.bg, color: SC_COLORS.text,
  border: `1px solid ${SC_COLORS.border}`, borderRadius: 6,
  padding: '6px 12px', fontSize: 12, fontWeight: 600,
  cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: 'inherit',
};

function fmtRelativeTime(ts) {
  if (!ts) return '';
  const diff = (Date.now() - ts) / 1000;
  if (diff < 5) return '剛剛';
  if (diff < 60) return `${Math.floor(diff)}秒前`;
  if (diff < 3600) return `${Math.floor(diff / 60)}分前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}小時前`;
  return new Date(ts).toLocaleDateString('zh-TW');
}

const useToast = () => {
  const [msgs, setMsgs] = useState([]);
  const push = useCallback((text, kind = 'info', ms = 3500) => {
    const id = Math.random().toString(36).slice(2);
    setMsgs(m => [...m, { id, text, kind }]);
    setTimeout(() => setMsgs(m => m.filter(x => x.id !== id)), ms);
  }, []);
  return { msgs, push };
};

// ----- File drop zone -----
function DropZone({ label, hint, accept, multiple, onFiles, value, dense }) {
  const ref = useRef(null);
  const [over, setOver] = useState(false);
  const onDrop = (e) => {
    e.preventDefault(); setOver(false);
    const files = [...(e.dataTransfer.files || [])];
    if (files.length) onFiles(files);
  };
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      onClick={() => ref.current.click()}
      style={{
        border: `1.5px dashed ${over ? SC_COLORS.accent : SC_COLORS.border}`,
        background: over ? 'rgba(124,156,255,0.06)' : SC_COLORS.panel2,
        borderRadius: 12,
        padding: dense ? '14px 16px' : '20px 18px',
        cursor: 'pointer',
        transition: 'all .15s',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{
          width: 36, height: 36, borderRadius: 8,
          background: SC_COLORS.bg, border: `1px solid ${SC_COLORS.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 16, color: SC_COLORS.accent, flexShrink: 0,
        }}>
          {value ? '✓' : '+'}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: SC_COLORS.text }}>{label}</div>
          <div style={{ fontSize: 12, color: SC_COLORS.textDim, marginTop: 2,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {value || hint}
          </div>
        </div>
      </div>
      <input ref={ref} type="file" accept={accept} multiple={multiple}
        style={{ display: 'none' }}
        onChange={(e) => {
          const files = [...e.target.files];
          if (files.length) onFiles(files);
          e.target.value = '';
        }} />
    </div>
  );
}

// ----- Section header -----
function Section({ n, title, subtitle, children, accent }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
        <div style={{
          fontSize: 11, fontWeight: 700, letterSpacing: 1.5,
          color: accent || SC_COLORS.accent,
        }}>
          {String(n).padStart(2, '0')}
        </div>
        <div style={{ fontSize: 14, fontWeight: 600, color: SC_COLORS.text }}>{title}</div>
        {subtitle && <div style={{ fontSize: 12, color: SC_COLORS.textDim }}>{subtitle}</div>}
      </div>
      {children}
    </div>
  );
}

// ----- Button -----
function Btn({ children, onClick, primary, danger, disabled, small, style }) {
  const bg = disabled ? SC_COLORS.panel2
    : primary ? SC_COLORS.accent
    : danger ? 'rgba(239,107,107,0.12)'
    : SC_COLORS.panel2;
  const fg = disabled ? SC_COLORS.textDim
    : primary ? '#0b0d12'
    : danger ? SC_COLORS.err
    : SC_COLORS.text;
  const border = primary ? SC_COLORS.accent
    : danger ? 'rgba(239,107,107,0.4)'
    : SC_COLORS.border;
  return (
    <button onClick={onClick} disabled={disabled}
      style={{
        background: bg, color: fg, border: `1px solid ${border}`,
        borderRadius: 8, padding: small ? '6px 12px' : '10px 16px',
        fontSize: small ? 12 : 13, fontWeight: 600,
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontFamily: 'inherit',
        transition: 'all .12s',
        ...style,
      }}>{children}</button>
  );
}

// ===== Main app =====
function App() {
  const toast = useToast();

  // ---- State: ingestion ----
  const [slidesMode, setSlidesMode] = useState(null); // 'pdf' | 'images' | 'html'
  const [slideUrls, setSlideUrls] = useState([]);     // image data/object URLs
  const [slidesCount, setSlidesCount] = useState(0);
  const [htmlDeckUrl, setHtmlDeckUrl] = useState(null);
  const [pdfProgress, setPdfProgress] = useState(null);

  const [voMode, setVoMode] = useState('upload');     // 'upload' | 'tts'
  const [voFiles, setVoFiles] = useState([]);         // [{name,url,file}]
  const [bgmFile, setBgmFile] = useState(null);
  const [transcript, setTranscript] = useState(null); // parsed result
  const [transcriptName, setTranscriptName] = useState('');

  // TTS state
  const [ttsVoices, setTtsVoices] = useState([]);
  const [ttsVoiceURI, setTtsVoiceURI] = useState('');
  const [ttsRate, setTtsRate] = useState(1.0);
  const [ttsPitch, setTtsPitch] = useState(1.0);
  const ttsRef = useRef(null);
  const ttsCtrlRef = useRef(null);
  if (!ttsRef.current && typeof SlidecastTTS !== 'undefined') {
    ttsRef.current = new SlidecastTTS();
  }

  // ---- State: mapping & timing ----
  const [segments, setSegments] = useState([]);       // [{idx, start, end, slide, cues:[]}]
  const [totalDuration, setTotalDuration] = useState(0);

  // ---- Playback ----
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [currentSlide, setCurrentSlide] = useState(0);
  const [currentCue, setCurrentCue] = useState('');

  // ---- Settings ----
  const [showSubs, setShowSubs] = useState(true);
  const [bgmBase, setBgmBase] = useState(0.18);
  const [resolution, setResolution] = useState('1920x1080');

  // ---- Project persistence ----
  const [projectId, setProjectId] = useState(null);
  const [projectName, setProjectName] = useState('');
  const [htmlDeckFile, setHtmlDeckFile] = useState(null); // retain original File for save
  const [savedProjects, setSavedProjects] = useState([]);
  const [showProjectsModal, setShowProjectsModal] = useState(false);
  const [savingProject, setSavingProject] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState(0);
  const [autoSaveOn, setAutoSaveOn] = useState(true);

  // ---- Recording ----
  const [recording, setRecording] = useState(false);
  const [recordedBlob, setRecordedBlob] = useState(null);
  // mp4 conversion
  const [mp4Blob, setMp4Blob] = useState(null);
  const [mp4Stage, setMp4Stage] = useState('idle'); // 'idle'|'loading'|'converting'|'done'|'error'
  const [mp4Progress, setMp4Progress] = useState(0);
  const [mp4Error, setMp4Error] = useState('');
  const ffmpegRef = useRef(null);

  // ---- Refs ----
  const audioRef = useRef(null);
  const recorderRef = useRef(null);
  const rendererRef = useRef(null);
  const canvasRef = useRef(null);
  const iframeRef = useRef(null);
  const tickRef = useRef(null);

  if (!audioRef.current) audioRef.current = new SlidecastAudio();

  // ---- Load TTS voices ----
  useEffect(() => {
    if (!ttsRef.current?.isSupported()) return;
    ttsRef.current.listChineseVoices().then((vs) => {
      setTtsVoices(vs);
      if (vs.length && !ttsVoiceURI) {
        // prefer zh-TW > zh-HK > zh-CN > first
        const pref = vs.find(v => /zh-tw/i.test(v.lang)) ||
                     vs.find(v => /zh-hk/i.test(v.lang)) ||
                     vs.find(v => /zh-cn/i.test(v.lang)) || vs[0];
        setTtsVoiceURI(pref.voiceURI);
      }
    });
  }, []);

  // ---- Apply TTS options ----
  useEffect(() => {
    if (!ttsRef.current) return;
    const v = ttsVoices.find(x => x.voiceURI === ttsVoiceURI) || null;
    ttsRef.current.setOptions({ voice: v, rate: ttsRate, pitch: ttsPitch });
  }, [ttsVoices, ttsVoiceURI, ttsRate, ttsPitch]);

  // ---- Initialize renderer when canvas mounts ----
  useEffect(() => {
    if (canvasRef.current && !rendererRef.current) {
      rendererRef.current = new SlidecastRenderer(canvasRef.current);
      rendererRef.current.start();
    }
    return () => { rendererRef.current?.stop(); };
  }, []);

  // ---- Slide ingestion handlers ----
  const onSlidesPdf = async (files) => {
    const file = files[0];
    setPdfProgress({ done: 0, total: 0 });
    try {
      const frames = await renderPdfToFrames(file, (d, t) => setPdfProgress({ done: d, total: t }));
      slideUrls.forEach(u => u.startsWith('blob:') && URL.revokeObjectURL(u));
      setSlideUrls(frames);
      setSlidesCount(frames.length);
      setSlidesMode('pdf');
      setHtmlDeckUrl(null);
      await rendererRef.current.loadImages(frames);
      rendererRef.current.mode = 'images';
      toast.push(`已載入 ${frames.length} 張投影片`, 'ok');
    } catch (e) {
      console.error(e);
      toast.push('PDF 解析失敗：' + e.message, 'err');
    } finally {
      setPdfProgress(null);
    }
  };

  const onSlidesImages = async (files) => {
    const urls = imageFilesToUrls(files);
    slideUrls.forEach(u => u.startsWith('blob:') && URL.revokeObjectURL(u));
    setSlideUrls(urls);
    setSlidesCount(urls.length);
    setSlidesMode('images');
    setHtmlDeckUrl(null);
    await rendererRef.current.loadImages(urls);
    rendererRef.current.mode = 'images';
    toast.push(`已載入 ${urls.length} 張圖片`, 'ok');
  };

  const onSlidesHtml = (files) => {
    const file = files[0];
    if (htmlDeckUrl) URL.revokeObjectURL(htmlDeckUrl);
    const url = htmlFileToUrl(file);
    setHtmlDeckUrl(url);
    setHtmlDeckFile(file);
    setSlidesMode('html');
    setSlideUrls([]);
    rendererRef.current.mode = 'iframe';
    toast.push('HTML deck 已載入', 'ok');
  };

  const onVoiceover = async (files) => {
    const list = audioFilesToList(files);
    setVoFiles(list);
    try {
      const r = await audioRef.current.loadVoiceover(list);
      setTotalDuration(r.totalDuration);
      toast.push(`已載入 ${list.length} 段配音 / ${fmtTime(r.totalDuration)}`, 'ok');
    } catch (e) {
      toast.push('配音解碼失敗：' + e.message, 'err');
    }
  };

  const onBgm = async (files) => {
    const f = files[0];
    setBgmFile(f);
    try { await audioRef.current.loadBGM(f); toast.push('背景音樂已載入', 'ok'); }
    catch (e) { toast.push('BGM 失敗：' + e.message, 'err'); }
  };

  const onTranscript = async (files) => {
    const f = files[0];
    try {
      const parsed = await parseTranscriptFile(f);
      setTranscript(parsed);
      setTranscriptName(f.name);
      toast.push(`字幕載入：${f.name} (${parsed.kind})`, 'ok');
    } catch (e) {
      toast.push('字幕解析失敗：' + e.message, 'err');
    }
  };

  // ---- Compute segments when VO + transcript change ----
  useEffect(() => {
    let segs = [];
    if (voMode === 'upload') {
      if (!audioRef.current.voSegments?.length) { setSegments([]); return; }
      segs = audioRef.current.voSegments.map(s => ({
        idx: s.idx, start: s.start, end: s.end, slide: s.idx, cues: [],
      }));
    } else if (voMode === 'tts') {
      // TTS mode: derive segments from transcript lines
      let lines = [];
      if (transcript?.kind === 'per-slide' && transcript.perSlideCues) {
        lines = transcript.perSlideCues.map(e => e.text || (e.cues || []).join(''));
      } else if (transcript?.kind === 'timed' && transcript.flatCues) {
        lines = transcript.flatCues.map(c => c.text);
      }
      lines = lines.filter(l => l && l.trim());
      if (!lines.length || !ttsRef.current) { setSegments([]); setTotalDuration(0); return; }
      const baked = ttsRef.current.bakeEstimate(lines);
      segs = baked.segments.map(s => ({
        idx: s.idx, start: s.start, end: s.end, slide: s.idx, cues: [], text: s.text,
      }));
      setTotalDuration(baked.totalMs / 1000);
    }

    if (transcript?.kind === 'per-slide' && transcript.perSlideCues) {
      for (const e of transcript.perSlideCues) {
        const target = segs.find(s => s.idx === e.slide);
        if (target) {
          target.cues = e.cues.length ? e.cues : (e.text ? chunkLine(e.text) : []);
        }
      }
    } else if (transcript?.kind === 'timed' && transcript.flatCues) {
      for (const c of transcript.flatCues) {
        const seg = segs.find(s => c.start >= s.start && c.start < s.end);
        if (seg) seg.cues.push({ start: c.start, end: c.end, text: c.text });
      }
    }
    setSegments(segs);
  }, [voMode, voFiles, transcript, ttsRate, ttsVoiceURI]);

  // ---- Also assign slide mapping ----
  // If transcript is per-slide and slides count > seg count, extend segments
  // (rare); otherwise default 1:1.
  const playableSlideCount = slidesMode === 'html' ? null : slidesCount;
  const segCount = segments.length;
  const mismatch = playableSlideCount !== null && segCount > 0 && playableSlideCount !== segCount;

  // ---- Playback tick (file mode only; TTS uses its own onTick) ----
  useEffect(() => {
    if (!playing || voMode === 'tts') {
      if (tickRef.current) cancelAnimationFrame(tickRef.current);
      return;
    }
    const tick = () => {
      const t = audioRef.current.getCurrentTime();
      setTime(t);

      // current segment
      const seg = segments.find(s => t >= s.start && t < s.end) ||
                  (t >= totalDuration ? segments[segments.length - 1] : segments[0]);
      if (seg) {
        if (currentSlide !== seg.slide) {
          setCurrentSlide(seg.slide);
          rendererRef.current.setSlide(seg.slide);
        }
        // figure out cue text
        let cueText = '';
        if (seg.cues.length) {
          if (typeof seg.cues[0] === 'string') {
            // distribute strings evenly across segment duration
            const dur = seg.end - seg.start;
            const idx = Math.min(seg.cues.length - 1,
              Math.floor((t - seg.start) / (dur / seg.cues.length)));
            cueText = seg.cues[idx];
          } else {
            const c = seg.cues.find(c => t >= c.start && t < c.end);
            cueText = c?.text || '';
          }
        }
        if (cueText !== currentCue) {
          setCurrentCue(cueText);
          rendererRef.current.setSubtitle(showSubs ? cueText : '');
        }
      }

      // stop at end
      if (t >= totalDuration) {
        handleStop();
        return;
      }
      tickRef.current = requestAnimationFrame(tick);
    };
    tickRef.current = requestAnimationFrame(tick);
    return () => { if (tickRef.current) cancelAnimationFrame(tickRef.current); };
  }, [playing, segments, totalDuration, currentSlide, currentCue, showSubs]);

  // ---- Sync subtitle visibility ----
  useEffect(() => {
    rendererRef.current?.setSubtitleStyle({ enabled: showSubs });
    if (!showSubs) rendererRef.current?.setSubtitle('');
    else rendererRef.current?.setSubtitle(currentCue);
  }, [showSubs, currentCue]);

  // ---- BGM level ----
  useEffect(() => {
    audioRef.current.setBgmLevels({ base: bgmBase });
  }, [bgmBase]);

  // ---- iframe attach when html deck ----
  useEffect(() => {
    if (slidesMode === 'html' && iframeRef.current) {
      const onload = () => rendererRef.current.attachIframe(iframeRef.current);
      iframeRef.current.addEventListener('load', onload);
      return () => iframeRef.current?.removeEventListener('load', onload);
    }
  }, [slidesMode, htmlDeckUrl]);

  // ---- Probe HTML deck slide count ----
  useEffect(() => {
    if (slidesMode !== 'html' || !iframeRef.current) return;
    const tryProbe = () => {
      try {
        const doc = iframeRef.current.contentDocument;
        const stage = doc?.querySelector('deck-stage');
        if (stage) {
          // count direct child <section> or use stage._slides if present
          const n = stage.querySelectorAll(':scope > section').length;
          if (n > 0) setSlidesCount(n);
        } else {
          // fallback: count [data-screen-label] elements
          const n = doc?.querySelectorAll('[data-screen-label]').length || 0;
          if (n > 0) setSlidesCount(n);
        }
      } catch {}
    };
    const t = setTimeout(tryProbe, 800);
    return () => clearTimeout(t);
  }, [slidesMode, htmlDeckUrl]);

  // ---- Controls ----
  const handlePlay = () => {
    if (!segments.length) { toast.push('需要至少一段配音', 'warn'); return; }
    if (voMode === 'tts') {
      // Live TTS playback
      const lines = segments.map(s => s.text || '');
      // Cancel any prior playback
      ttsCtrlRef.current?.cancel();
      let segStartedAt = 0;
      let curIdx = 0;
      ttsCtrlRef.current = ttsRef.current.startLivePlayback({
        lines,
        onSegmentStart: (idx) => {
          curIdx = idx;
          segStartedAt = performance.now();
          setCurrentSlide(idx);
          rendererRef.current.setSlide(idx);
        },
        onSegmentEnd: () => {},
        onTick: (totalSec, idx) => {
          setTime(totalSec);
          // distribute cues within current segment
          const seg = segments[idx];
          if (!seg) return;
          let cueText = '';
          if (seg.cues.length) {
            if (typeof seg.cues[0] === 'string') {
              const elapsed = (performance.now() - segStartedAt) / 1000;
              const dur = Math.max(0.1, seg.end - seg.start);
              const ci = Math.min(seg.cues.length - 1,
                Math.floor(elapsed / (dur / seg.cues.length)));
              cueText = seg.cues[ci];
            }
          } else if (seg.text) {
            cueText = seg.text;
          }
          if (cueText !== currentCue) {
            setCurrentCue(cueText);
            rendererRef.current.setSubtitle(showSubs ? cueText : '');
          }
        },
        onAllDone: () => {
          setPlaying(false);
          ttsCtrlRef.current = null;
        },
      });
      setPlaying(true);
      return;
    }
    audioRef.current.play(time);
    setPlaying(true);
  };
  const handlePause = () => {
    if (voMode === 'tts') {
      ttsCtrlRef.current?.cancel();
      ttsCtrlRef.current = null;
      setPlaying(false);
      return;
    }
    audioRef.current.stop();
    setPlaying(false);
  };
  const handleStop = () => {
    if (voMode === 'tts') {
      ttsCtrlRef.current?.cancel();
      ttsCtrlRef.current = null;
    } else {
      audioRef.current.stop();
    }
    setPlaying(false);
    setTime(0);
    setCurrentSlide(0);
    rendererRef.current.setSlide(0);
    rendererRef.current.setSubtitle('');
  };
  const handleSeek = (t) => {
    if (voMode === 'tts') {
      // TTS cannot seek mid-utterance reliably; jump to nearest segment start
      ttsCtrlRef.current?.cancel();
      ttsCtrlRef.current = null;
      const seg = segments.find(s => t >= s.start && t < s.end) || segments[0];
      if (seg) {
        setTime(seg.start);
        setCurrentSlide(seg.slide);
        rendererRef.current.setSlide(seg.slide);
      }
      setPlaying(false);
      return;
    }
    const wasPlaying = playing;
    audioRef.current.stop();
    setTime(t);
    const seg = segments.find(s => t >= s.start && t < s.end);
    if (seg) {
      setCurrentSlide(seg.slide);
      rendererRef.current.setSlide(seg.slide);
    }
    if (wasPlaying) {
      audioRef.current.play(t);
    }
  };

  const canRecord = segments.length > 0 && (slidesMode === 'pdf' || slidesMode === 'images') && voMode !== 'tts';
  const startRecording = () => {
    if (!canRecord) {
      toast.push('錄製目前僅支援 PDF / 圖片來源', 'warn');
      return;
    }
    handleStop();
    setRecordedBlob(null);
    if (!recorderRef.current) recorderRef.current = new SlidecastRecorder(audioRef.current);
    try {
      recorderRef.current.start(canvasRef.current, 30, (e) => {
        toast.push('錄製錯誤：' + (e?.message || e), 'err');
        setRecording(false);
      });
      setRecording(true);
      toast.push('開始錄製，自動從頭播放', 'ok');
      setTimeout(() => { handlePlay(); }, 300);
    } catch (e) {
      toast.push('無法開始錄製：' + e.message, 'err');
    }
  };
  const stopRecording = async () => {
    if (!recording) return;
    handlePause();
    const blob = await recorderRef.current.stop();
    setRecording(false);
    if (blob) {
      setRecordedBlob(blob);
      toast.push(`錄製完成 (${fmtBytes(blob.size)})`, 'ok');
    }
  };

  // Auto-stop recording when playback hits end
  useEffect(() => {
    if (recording && !playing && time >= totalDuration && totalDuration > 0) {
      stopRecording();
    }
  }, [recording, playing, time, totalDuration]);

  const downloadRecording = () => {
    if (!recordedBlob) return;
    const url = URL.createObjectURL(recordedBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'slidecast-' + Date.now() + '.webm';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // Reset mp4 cache whenever a new recording is made
  useEffect(() => {
    setMp4Blob(null);
    setMp4Stage('idle');
    setMp4Progress(0);
    setMp4Error('');
  }, [recordedBlob]);

  // ---- Project save/load ----
  const buildCurrentSnapshot = async () => {
    return buildSnapshot({
      projectName,
      slidesMode, slideUrls,
      htmlDeckUrl, htmlDeckFile,
      voMode, voFiles,
      bgmFile,
      transcript, transcriptName,
      ttsVoiceURI, ttsRate, ttsPitch,
      segments,
      showSubs, bgmBase, resolution,
    });
  };

  const refreshProjectsList = async () => {
    try {
      const list = await SlidecastDB.listProjects();
      setSavedProjects(list);
    } catch (e) {
      console.error(e);
      toast.push('讀取專案列表失敗：' + e.message, 'err');
    }
  };

  useEffect(() => { refreshProjectsList(); }, []);

  // Cmd/Ctrl+S to save
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        saveCurrentProject(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line
  }, [projectId, projectName, slidesMode, slideUrls, voFiles, bgmFile, transcript, segments]);


  const saveCurrentProject = async (asCopy = false) => {
    if (savingProject) return;
    setSavingProject(true);
    try {
      const snap = await buildCurrentSnapshot();
      if (!snap.name) snap.name = '未命名專案 ' + new Date().toLocaleString('zh-TW');
      const id = await SlidecastDB.saveProject(snap, asCopy ? null : projectId);
      setProjectId(id);
      setProjectName(snap.name);
      setLastSavedAt(Date.now());
      await refreshProjectsList();
      toast.push(asCopy ? '已另存新專案' : '已儲存', 'ok');
    } catch (e) {
      console.error(e);
      toast.push('儲存失敗：' + e.message, 'err');
    } finally {
      setSavingProject(false);
    }
  };

  const applyLoadedProject = async (id) => {
    try {
      const loaded = await SlidecastDB.loadProject(id);
      const r = rehydrateProject(loaded);

      // Free old URLs first
      slideUrls.forEach(u => u.startsWith('blob:') && URL.revokeObjectURL(u));
      voFiles.forEach(v => v.url?.startsWith('blob:') && URL.revokeObjectURL(v.url));
      if (htmlDeckUrl) URL.revokeObjectURL(htmlDeckUrl);

      const p = r.payload;
      setProjectId(r.id);
      setProjectName(r.name || '');
      setSlidesMode(p.slidesMode);
      setSlideUrls(r.slideUrls);
      setSlidesCount(r.slidesCount);
      setHtmlDeckUrl(r.htmlDeckUrl);
      setHtmlDeckFile(r.htmlDeckFile);
      setVoMode(p.voMode || 'upload');
      setVoFiles(r.voFiles);
      setBgmFile(r.bgmFile);
      setTranscript(p.transcript);
      setTranscriptName(p.transcriptName || '');
      setTtsVoiceURI(p.ttsVoiceURI || '');
      setTtsRate(p.ttsRate ?? 1.0);
      setTtsPitch(p.ttsPitch ?? 1.0);
      setSegments(p.segments || []);
      setShowSubs(!!p.showSubs);
      setBgmBase(p.bgmBase ?? 0.18);
      setResolution(p.resolution || '1920x1080');

      // Tell renderer/audio engines what to use
      if (r.slidesMode === 'pdf' || p.slidesMode === 'pdf' || p.slidesMode === 'images') {
        rendererRef.current.mode = 'images';
        if (r.slideUrls.length) await rendererRef.current.loadImages(r.slideUrls);
      } else if (p.slidesMode === 'html') {
        rendererRef.current.mode = 'iframe';
      }
      if (r.voFiles.length) {
        try {
          const res = await audioRef.current.loadVoiceover(r.voFiles);
          setTotalDuration(res.totalDuration);
        } catch (e) { console.warn(e); }
      }
      if (r.bgmFile) {
        try { await audioRef.current.loadBGM(r.bgmFile); } catch (e) { console.warn(e); }
      }

      setLastSavedAt(loaded.updatedAt || 0);
      setShowProjectsModal(false);
      toast.push(`已開啟專案：${r.name}`, 'ok');
    } catch (e) {
      console.error(e);
      toast.push('開啟失敗：' + e.message, 'err');
    }
  };

  const newProject = () => {
    if (!confirm('要新建一個空專案嗎？目前未儲存的內容將清除。')) return;
    // free URLs
    slideUrls.forEach(u => u.startsWith('blob:') && URL.revokeObjectURL(u));
    voFiles.forEach(v => v.url?.startsWith('blob:') && URL.revokeObjectURL(v.url));
    if (htmlDeckUrl) URL.revokeObjectURL(htmlDeckUrl);
    setProjectId(null);
    setProjectName('');
    setSlidesMode(null);
    setSlideUrls([]);
    setSlidesCount(0);
    setHtmlDeckUrl(null);
    setHtmlDeckFile(null);
    setVoFiles([]);
    setBgmFile(null);
    setTranscript(null);
    setTranscriptName('');
    setSegments([]);
    setTotalDuration(0);
    setRecordedBlob(null);
    setMp4Blob(null);
    setMp4Stage('idle');
    toast.push('已新建空專案', 'info');
  };

  const deleteProjectById = async (id, name) => {
    if (!confirm(`確定要刪除「${name}」嗎？此動作無法復原。`)) return;
    try {
      await SlidecastDB.deleteProject(id);
      if (id === projectId) { setProjectId(null); }
      await refreshProjectsList();
      toast.push('已刪除', 'ok');
    } catch (e) {
      toast.push('刪除失敗：' + e.message, 'err');
    }
  };

  // ---- Auto-save (debounced) ----
  useEffect(() => {
    if (!autoSaveOn) return;
    if (!projectId) return; // only auto-save once user has explicitly saved at least once
    const t = setTimeout(() => {
      saveCurrentProject(false).catch(() => {});
    }, 4000);
    return () => clearTimeout(t);
    // eslint-disable-next-line
  }, [
    autoSaveOn, projectId,
    slidesMode, slideUrls, htmlDeckUrl,
    voMode, voFiles, bgmFile,
    transcript, transcriptName,
    ttsVoiceURI, ttsRate, ttsPitch,
    segments, showSubs, bgmBase, resolution,
    projectName,
  ]);

  const convertToMp4 = async () => {
    if (!recordedBlob) return;
    if (!ffmpegRef.current) ffmpegRef.current = new SlidecastFFmpeg();
    setMp4Error('');
    setMp4Progress(0);
    let realProgressFired = false;
    let fakeTimer = null;
    try {
      if (!ffmpegRef.current.ready) {
        setMp4Stage('loading');
        toast.push('載入 ffmpeg.wasm 中（首次約 30MB，會被瀏覽器快取）…', 'info', 6000);
        await ffmpegRef.current.load();
      }
      setMp4Stage('converting');

      // Fallback "looks alive" timer: 0.11.x setProgress doesn't always fire.
      // Asymptotic creep toward 0.9 so the user sees activity.
      let fakeT = 0;
      fakeTimer = setInterval(() => {
        if (realProgressFired) { clearInterval(fakeTimer); fakeTimer = null; return; }
        fakeT += 1;
        // approach 0.9 over ~60s
        const p = 0.9 * (1 - Math.exp(-fakeT / 30));
        setMp4Progress((cur) => Math.max(cur, p));
      }, 1000);

      const blob = await ffmpegRef.current.webmToMp4(recordedBlob, {
        onConvertProgress: (r) => {
          realProgressFired = true;
          if (fakeTimer) { clearInterval(fakeTimer); fakeTimer = null; }
          setMp4Progress(r);
        },
      });
      if (fakeTimer) { clearInterval(fakeTimer); fakeTimer = null; }
      setMp4Blob(blob);
      setMp4Stage('done');
      setMp4Progress(1);
      toast.push(`MP4 轉檔完成 (${fmtBytes(blob.size)})`, 'ok');
    } catch (e) {
      if (fakeTimer) { clearInterval(fakeTimer); fakeTimer = null; }
      console.error(e);
      setMp4Stage('error');
      setMp4Error(e?.message || String(e));
      toast.push('MP4 轉檔失敗：' + (e?.message || e), 'err');
    }
  };

  const downloadMp4 = () => {
    if (!mp4Blob) return;
    const url = URL.createObjectURL(mp4Blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'slidecast-' + Date.now() + '.mp4';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // ---- UI ----
  return (
    <div style={{
      width: '100vw', minHeight: '100vh', background: SC_COLORS.bg,
      color: SC_COLORS.text, fontFamily: '"Inter","Noto Sans TC","Microsoft JhengHei",sans-serif',
      display: 'grid', gridTemplateColumns: '420px 1fr', gridTemplateRows: '52px 1fr',
    }}>
      {/* Top bar */}
      <div style={{
        gridColumn: '1 / -1', display: 'flex', alignItems: 'center',
        padding: '0 20px', borderBottom: `1px solid ${SC_COLORS.border}`,
        background: SC_COLORS.bg2,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 28, height: 28, borderRadius: 6,
            background: `linear-gradient(135deg, ${SC_COLORS.accent}, #b794f6)`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 14, fontWeight: 800, color: '#0b0d12',
          }}>S</div>
          <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: 0.3 }}>Slidecast</div>
          <div style={{ fontSize: 11, color: SC_COLORS.textDim, marginLeft: 4 }}>
            投影片 + 配音 + 字幕 → 影片
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Project name (editable) */}
          <input
            type="text"
            value={projectName}
            placeholder="未命名專案"
            onChange={(e) => setProjectName(e.target.value)}
            style={{
              background: SC_COLORS.bg, color: SC_COLORS.text,
              border: `1px solid ${SC_COLORS.border}`, borderRadius: 6,
              padding: '5px 10px', fontSize: 12, width: 200, outline: 'none',
              fontFamily: 'inherit',
            }}
          />
          {projectId && lastSavedAt > 0 && (
            <span style={{ fontSize: 10, color: SC_COLORS.textDim }}>
              {savingProject ? '儲存中…' : `已儲存 ${fmtRelativeTime(lastSavedAt)}`}
            </span>
          )}

          {totalDuration > 0 && (
            <span style={{ fontSize: 11, color: SC_COLORS.textDim, padding: '0 8px', borderLeft: `1px solid ${SC_COLORS.border}` }}>
              總長 {fmtTime(totalDuration)} • {segments.length} 段
            </span>
          )}

          {/* New */}
          <button
            onClick={newProject}
            title="新建空專案"
            style={tbBtn}
          >＋ 新建</button>

          {/* Save */}
          <button
            onClick={() => saveCurrentProject(false)}
            disabled={savingProject}
            title="儲存目前專案 (Cmd/Ctrl+S)"
            style={{ ...tbBtn, background: SC_COLORS.accent, color: '#0b0d12', borderColor: SC_COLORS.accent }}
          >{savingProject ? '⏳ 儲存中' : (projectId ? '💾 儲存' : '💾 儲存為新專案')}</button>

          {/* Save As */}
          {projectId && (
            <button
              onClick={() => saveCurrentProject(true)}
              disabled={savingProject}
              title="另存新專案"
              style={tbBtn}
            >📋 另存</button>
          )}

          {/* Open */}
          <button
            onClick={() => { refreshProjectsList(); setShowProjectsModal(true); }}
            title="開啟已儲存的專案"
            style={tbBtn}
          >📂 開啟…</button>
        </div>
      </div>

      {/* Sidebar */}
      <aside style={{
        borderRight: `1px solid ${SC_COLORS.border}`, background: SC_COLORS.bg2,
        padding: 20, overflowY: 'auto', minHeight: 0,
      }}>
        <Section n={1} title="投影片來源" subtitle="PDF / 圖片 / HTML deck">
          <div style={{ display: 'grid', gap: 8 }}>
            <DropZone
              label="上傳 PDF"
              hint="拖放或點擊；自動拆成投影片"
              accept=".pdf"
              onFiles={onSlidesPdf}
              value={slidesMode === 'pdf' ? `${slidesCount} 張` : null}
              dense
            />
            {pdfProgress && (
              <div style={{ fontSize: 11, color: SC_COLORS.textDim, padding: '0 4px' }}>
                解析中 {pdfProgress.done}/{pdfProgress.total}…
              </div>
            )}
            <DropZone
              label="上傳圖片序列"
              hint="多張 PNG/JPG，依檔名排序"
              accept="image/*" multiple
              onFiles={onSlidesImages}
              value={slidesMode === 'images' ? `${slidesCount} 張` : null}
              dense
            />
            <DropZone
              label="上傳 HTML deck"
              hint="支援 deck-stage / 含 data-screen-label"
              accept=".html,.htm"
              onFiles={onSlidesHtml}
              value={slidesMode === 'html' ? '已載入' : null}
              dense
            />
          </div>
        </Section>

        <Section n={2} title="配音" subtitle="每段對應一張投影片">
          {/* Mode tabs */}
          <div style={{
            display: 'flex', background: SC_COLORS.bg, borderRadius: 8,
            padding: 3, marginBottom: 10, border: `1px solid ${SC_COLORS.border}`,
          }}>
            {[
              { id: 'upload', label: '上傳音檔' },
              { id: 'tts', label: '瀏覽器 TTS' },
            ].map(t => (
              <button key={t.id} onClick={() => setVoMode(t.id)}
                style={{
                  flex: 1, padding: '7px 10px', borderRadius: 6,
                  border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600,
                  fontFamily: 'inherit',
                  background: voMode === t.id ? SC_COLORS.panel2 : 'transparent',
                  color: voMode === t.id ? SC_COLORS.text : SC_COLORS.textDim,
                  transition: 'all .12s',
                }}>
                {t.label}
              </button>
            ))}
          </div>

          {voMode === 'upload' && (
            <DropZone
              label="上傳配音 (多段)"
              hint="MP3/WAV/M4A；依檔名排序串接"
              accept="audio/*" multiple
              onFiles={onVoiceover}
              value={voFiles.length ? `${voFiles.length} 段 / ${fmtTime(totalDuration)}` : null}
            />
          )}

          {voMode === 'tts' && (
            <div style={{
              background: SC_COLORS.panel2, border: `1px solid ${SC_COLORS.border}`,
              borderRadius: 10, padding: 14,
            }}>
              {!ttsRef.current?.isSupported() ? (
                <div style={{ fontSize: 12, color: SC_COLORS.err }}>
                  此瀏覽器不支援 SpeechSynthesis API
                </div>
              ) : (
                <>
                  <div style={{ fontSize: 11, color: SC_COLORS.textDim, marginBottom: 10, lineHeight: 1.5 }}>
                    用第 3 區的字幕檔當作旁白稿；播放時瀏覽器會即時朗讀。
                  </div>
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 11, color: SC_COLORS.textDim, marginBottom: 4 }}>語音</div>
                    <select value={ttsVoiceURI} onChange={e => setTtsVoiceURI(e.target.value)}
                      style={{
                        width: '100%', padding: '7px 9px', borderRadius: 6,
                        background: SC_COLORS.bg, color: SC_COLORS.text,
                        border: `1px solid ${SC_COLORS.border}`, fontSize: 12,
                        fontFamily: 'inherit',
                      }}>
                      {ttsVoices.length === 0 && <option value="">（載入中…若清單空白請刷新）</option>}
                      {ttsVoices.map(v => (
                        <option key={v.voiceURI} value={v.voiceURI}>
                          {v.name} ({v.lang}){v.localService ? '' : ' · 雲端'}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <div>
                      <div style={{ fontSize: 11, color: SC_COLORS.textDim, marginBottom: 4 }}>
                        語速 {ttsRate.toFixed(2)}×
                      </div>
                      <input type="range" min={0.5} max={2.0} step={0.05} value={ttsRate}
                        onChange={e => setTtsRate(+e.target.value)}
                        style={{ width: '100%' }} />
                    </div>
                    <div>
                      <div style={{ fontSize: 11, color: SC_COLORS.textDim, marginBottom: 4 }}>
                        音調 {ttsPitch.toFixed(2)}
                      </div>
                      <input type="range" min={0.5} max={1.5} step={0.05} value={ttsPitch}
                        onChange={e => setTtsPitch(+e.target.value)}
                        style={{ width: '100%' }} />
                    </div>
                  </div>
                  <div style={{
                    fontSize: 11, color: SC_COLORS.textDim, marginTop: 10,
                    padding: 8, background: SC_COLORS.bg, borderRadius: 6,
                    border: `1px solid ${SC_COLORS.border}`, lineHeight: 1.5,
                  }}>
                    {transcript
                      ? <>已偵測到字幕，TTS 會逐段朗讀。</>
                      : <>請先在第 3 區上傳字幕／旁白稿。</>}
                  </div>
                </>
              )}
            </div>
          )}
        </Section>

        <Section n={3} title="字幕 / 旁白稿" subtitle="可選">
          <DropZone
            label="字幕檔"
            hint="SRT / VTT / JSON / 純文字（每行一張投影片）"
            accept=".srt,.vtt,.txt,.json"
            onFiles={onTranscript}
            value={transcriptName || null}
          />
        </Section>

        <Section n={4} title="背景音樂" subtitle="可選；自動 ducking">
          <DropZone
            label="BGM"
            hint="MP3/WAV"
            accept="audio/*"
            onFiles={onBgm}
            value={bgmFile?.name || null}
            dense
          />
          <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 12, color: SC_COLORS.textDim, width: 60 }}>BGM 音量</span>
            <input type="range" min={0} max={0.5} step={0.01} value={bgmBase}
              onChange={e => setBgmBase(+e.target.value)}
              style={{ flex: 1 }} />
            <span style={{ fontSize: 11, color: SC_COLORS.textDim, width: 32, textAlign: 'right' }}>
              {Math.round(bgmBase * 100)}
            </span>
          </div>
        </Section>

        {mismatch && (
          <div style={{
            fontSize: 11, color: SC_COLORS.warn, background: 'rgba(240,184,96,0.08)',
            border: `1px solid rgba(240,184,96,0.3)`, borderRadius: 8, padding: 10, marginBottom: 14,
          }}>
            ⚠ 投影片數 ({slidesCount}) 與配音段數 ({segCount}) 不一致；將以段數為準，多餘投影片會被忽略。
          </div>
        )}
      </aside>

      {/* Main: preview + controls */}
      <main style={{ display: 'flex', flexDirection: 'column', minHeight: 0, padding: 20, gap: 14 }}>
        {/* Preview stage */}
        <div style={{
          flex: 1, position: 'relative', background: '#000',
          borderRadius: 14, overflow: 'hidden', minHeight: 0,
          border: `1px solid ${SC_COLORS.border}`,
        }}>
          <div style={{
            position: 'absolute', inset: 0, display: 'flex',
            alignItems: 'center', justifyContent: 'center',
          }}>
            {/* 16:9 wrapper, scaled to fit */}
            <div style={{
              width: '100%', height: '100%', position: 'relative',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {/* iframe layer for HTML deck */}
              {slidesMode === 'html' && htmlDeckUrl && (
                <iframe
                  ref={iframeRef}
                  src={htmlDeckUrl}
                  style={{
                    position: 'absolute',
                    width: '100%', height: '100%',
                    border: 'none', background: '#000',
                  }}
                />
              )}
              {/* Canvas overlay (always present; drawn either as full image or transparent w/ subtitles) */}
              <canvas
                ref={canvasRef}
                width={1920}
                height={1080}
                style={{
                  width: '100%', height: '100%', objectFit: 'contain',
                  position: 'relative', pointerEvents: 'none',
                  background: slidesMode === 'html' ? 'transparent' : '#000',
                }}
              />
              {!slidesMode && (
                <div style={{ color: SC_COLORS.textDim, fontSize: 14, textAlign: 'center' }}>
                  上傳投影片開始<br />
                  <span style={{ fontSize: 11 }}>左側欄選擇 PDF、圖片或 HTML deck</span>
                </div>
              )}
            </div>
          </div>

          {/* Slide counter */}
          {slidesMode && segCount > 0 && (
            <div style={{
              position: 'absolute', top: 12, right: 14,
              padding: '4px 10px', borderRadius: 6,
              background: 'rgba(0,0,0,0.5)', color: '#fff', fontSize: 11,
              fontVariantNumeric: 'tabular-nums', letterSpacing: 1,
            }}>
              {String(currentSlide + 1).padStart(2, '0')} / {String(segCount).padStart(2, '0')}
            </div>
          )}
        </div>

        {/* Controls */}
        <div style={{
          background: SC_COLORS.panel, border: `1px solid ${SC_COLORS.border}`,
          borderRadius: 12, padding: 14,
        }}>
          {/* Timeline */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <span style={{ fontSize: 12, color: SC_COLORS.textDim, width: 44, fontVariantNumeric: 'tabular-nums' }}>
              {fmtTime(time)}
            </span>
            <div style={{ flex: 1, position: 'relative', height: 30 }}>
              {/* segment markers */}
              <div style={{
                position: 'absolute', inset: '12px 0', borderRadius: 4,
                background: SC_COLORS.bg, overflow: 'hidden',
                border: `1px solid ${SC_COLORS.border}`,
              }}>
                {segments.map(s => (
                  <div key={s.idx} style={{
                    position: 'absolute',
                    left: `${(s.start / Math.max(1, totalDuration)) * 100}%`,
                    width: `${((s.end - s.start) / Math.max(1, totalDuration)) * 100}%`,
                    top: 0, bottom: 0,
                    borderRight: `1px solid ${SC_COLORS.border}`,
                    background: s.idx === currentSlide ? 'rgba(124,156,255,0.18)' : 'transparent',
                  }} />
                ))}
                <div style={{
                  position: 'absolute', left: 0, top: 0, bottom: 0,
                  width: `${(time / Math.max(1, totalDuration)) * 100}%`,
                  background: SC_COLORS.accent, opacity: 0.55,
                }} />
              </div>
              <input type="range" min={0} max={Math.max(0.01, totalDuration)} step={0.01}
                value={time}
                onChange={e => handleSeek(+e.target.value)}
                style={{
                  position: 'absolute', inset: 0, width: '100%',
                  opacity: 0.001, cursor: 'pointer',
                }}
              />
            </div>
            <span style={{ fontSize: 12, color: SC_COLORS.textDim, width: 44, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
              {fmtTime(totalDuration)}
            </span>
          </div>

          {/* Buttons row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {!playing ? (
              <Btn onClick={handlePlay} primary disabled={!segments.length}>▶ 播放</Btn>
            ) : (
              <Btn onClick={handlePause} primary>⏸ 暫停</Btn>
            )}
            <Btn onClick={handleStop} disabled={!segments.length}>⏹ 停止</Btn>

            <div style={{ width: 1, height: 24, background: SC_COLORS.border, margin: '0 6px' }} />

            <Btn small onClick={() => handleSeek(Math.max(0, segments[Math.max(0, currentSlide - 1)]?.start ?? 0))}>
              ◀ 上一段
            </Btn>
            <Btn small onClick={() => handleSeek(segments[Math.min(segments.length - 1, currentSlide + 1)]?.start ?? totalDuration)}>
              下一段 ▶
            </Btn>

            <div style={{ width: 1, height: 24, background: SC_COLORS.border, margin: '0 6px' }} />

            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: SC_COLORS.textDim, cursor: 'pointer' }}>
              <input type="checkbox" checked={showSubs} onChange={e => setShowSubs(e.target.checked)} />
              顯示字幕
            </label>

            <div style={{ flex: 1 }} />

            {!recording ? (
              <Btn onClick={startRecording} disabled={!canRecord}
                style={{ background: 'rgba(239,107,107,0.12)', color: SC_COLORS.err, borderColor: 'rgba(239,107,107,0.4)' }}>
                ⏺ 錄製成影片
              </Btn>
            ) : (
              <Btn onClick={stopRecording} primary style={{ background: SC_COLORS.err, borderColor: SC_COLORS.err, color: '#fff' }}>
                ⏹ 停止錄製
              </Btn>
            )}
            {recordedBlob && (
              <Btn onClick={downloadRecording} primary>⬇ 下載 WebM ({fmtBytes(recordedBlob.size)})</Btn>
            )}
            {recordedBlob && !mp4Blob && mp4Stage !== 'loading' && mp4Stage !== 'converting' && (
              <Btn onClick={convertToMp4}>⇄ 轉成 MP4</Btn>
            )}
            {(mp4Stage === 'loading' || mp4Stage === 'converting') && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 12px', borderRadius: 8,
                background: SC_COLORS.bg, border: `1px solid ${SC_COLORS.border}`,
                fontSize: 12, color: SC_COLORS.textDim, minWidth: 200,
              }}>
                <div style={{
                  width: 14, height: 14, borderRadius: '50%',
                  border: `2px solid ${SC_COLORS.border}`,
                  borderTopColor: SC_COLORS.accent,
                  animation: 'sc-spin 0.8s linear infinite',
                }} />
                <span>{mp4Stage === 'loading' ? '載入 ffmpeg…' : `轉檔中 ${Math.round(mp4Progress * 100)}%`}</span>
                {mp4Stage === 'converting' && (
                  <div style={{
                    flex: 1, height: 4, background: SC_COLORS.border, borderRadius: 2, overflow: 'hidden',
                  }}>
                    <div style={{
                      width: `${mp4Progress * 100}%`, height: '100%',
                      background: SC_COLORS.accent, transition: 'width .2s',
                    }} />
                  </div>
                )}
              </div>
            )}
            {mp4Blob && (
              <Btn onClick={downloadMp4} primary>⬇ 下載 MP4 ({fmtBytes(mp4Blob.size)})</Btn>
            )}
          </div>

          {/* Caption preview */}
          <div style={{
            marginTop: 12, padding: 10, background: SC_COLORS.bg,
            borderRadius: 8, fontSize: 13, minHeight: 40,
            color: currentCue ? SC_COLORS.text : SC_COLORS.textDim,
            border: `1px solid ${SC_COLORS.border}`,
            fontFamily: '"Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif',
          }}>
            {currentCue || (segments.length ? '— 即將開始 —' : '尚未載入內容')}
          </div>

          {!canRecord && segments.length > 0 && slidesMode === 'html' && (
            <div style={{
              marginTop: 10, fontSize: 11, color: SC_COLORS.warn,
              padding: '8px 10px', borderRadius: 6,
              background: 'rgba(240,184,96,0.08)',
              border: `1px solid rgba(240,184,96,0.25)`,
            }}>
              HTML deck 模式無法直接錄製成影片（瀏覽器安全限制）。請改用 PDF / 圖片來源，或使用螢幕錄製工具錄整個視窗。
            </div>
          )}

          {voMode === 'tts' && segments.length > 0 && (
            <div style={{
              marginTop: 10, fontSize: 11, color: SC_COLORS.warn,
              padding: '8px 10px', borderRadius: 6,
              background: 'rgba(240,184,96,0.08)',
              border: `1px solid rgba(240,184,96,0.25)`,
              lineHeight: 1.5,
            }}>
              ⚠ TTS 模式僅供即時預覽。瀏覽器安全限制使 SpeechSynthesis 無法被錄進影片裡，要輸出影片請改用「上傳音檔」（可先用 TTS 試聽稿子，再離線生成正式配音檔），或用作業系統內建的螢幕錄製工具錄整個視窗。
            </div>
          )}
        </div>
      </main>

      {/* Projects modal */}
      {showProjectsModal && (
        <div
          onClick={() => setShowProjectsModal(false)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 200, backdropFilter: 'blur(4px)',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 640, maxHeight: '80vh', background: SC_COLORS.bg2,
              border: `1px solid ${SC_COLORS.border}`, borderRadius: 12,
              boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
              display: 'flex', flexDirection: 'column', overflow: 'hidden',
            }}
          >
            <div style={{
              padding: '16px 20px', borderBottom: `1px solid ${SC_COLORS.border}`,
              display: 'flex', alignItems: 'center',
            }}>
              <div style={{ fontSize: 15, fontWeight: 700 }}>已儲存的專案</div>
              <div style={{ fontSize: 11, color: SC_COLORS.textDim, marginLeft: 10 }}>
                {savedProjects.length} 個
              </div>
              <button
                onClick={() => setShowProjectsModal(false)}
                style={{ ...tbBtn, marginLeft: 'auto' }}
              >✕ 關閉</button>
            </div>
            <div style={{ overflowY: 'auto', flex: 1, padding: '8px 0' }}>
              {savedProjects.length === 0 ? (
                <div style={{ padding: 40, textAlign: 'center', color: SC_COLORS.textDim }}>
                  尚未儲存任何專案。<br/>編輯後點右上角「💾 儲存」建立第一個。
                </div>
              ) : savedProjects.map(p => (
                <div key={p.id} style={{
                  padding: '12px 20px', borderBottom: `1px solid ${SC_COLORS.border}`,
                  display: 'flex', alignItems: 'center', gap: 12,
                  background: p.id === projectId ? SC_COLORS.panel : 'transparent',
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 13, fontWeight: 600, marginBottom: 3,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>
                      {p.name}
                      {p.id === projectId && <span style={{
                        marginLeft: 8, fontSize: 10, color: SC_COLORS.accent,
                        padding: '1px 6px', border: `1px solid ${SC_COLORS.accent}`,
                        borderRadius: 4,
                      }}>目前</span>}
                    </div>
                    <div style={{ fontSize: 11, color: SC_COLORS.textDim }}>
                      最後儲存：{new Date(p.updatedAt).toLocaleString('zh-TW')}
                    </div>
                  </div>
                  <button
                    onClick={() => applyLoadedProject(p.id)}
                    disabled={p.id === projectId}
                    style={{ ...tbBtn, background: SC_COLORS.accent, color: '#0b0d12', borderColor: SC_COLORS.accent, opacity: p.id === projectId ? 0.5 : 1, cursor: p.id === projectId ? 'default' : 'pointer' }}
                  >開啟</button>
                  <button
                    onClick={async () => {
                      const newName = prompt('重新命名為：', p.name);
                      if (newName && newName.trim()) {
                        await SlidecastDB.renameProject(p.id, newName.trim());
                        await refreshProjectsList();
                        if (p.id === projectId) setProjectName(newName.trim());
                      }
                    }}
                    style={tbBtn}
                  >✎</button>
                  <button
                    onClick={() => deleteProjectById(p.id, p.name).then(refreshProjectsList)}
                    style={{ ...tbBtn, color: SC_COLORS.err, borderColor: 'rgba(239,107,107,0.4)' }}
                  >🗑</button>
                </div>
              ))}
            </div>
            <div style={{
              padding: '10px 20px', borderTop: `1px solid ${SC_COLORS.border}`,
              fontSize: 11, color: SC_COLORS.textDim, display: 'flex', alignItems: 'center', gap: 12,
            }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
                <input
                  type="checkbox" checked={autoSaveOn}
                  onChange={(e) => setAutoSaveOn(e.target.checked)}
                />
                自動儲存（編輯後 4 秒）
              </label>
              <span style={{ marginLeft: 'auto' }}>
                專案儲存在瀏覽器 IndexedDB（本機）
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Toasts */}
      <div style={{
        position: 'fixed', bottom: 20, right: 20, display: 'flex',
        flexDirection: 'column', gap: 8, zIndex: 100,
      }}>
        {toast.msgs.map(m => (
          <div key={m.id} style={{
            background: m.kind === 'err' ? 'rgba(239,107,107,0.95)'
                      : m.kind === 'ok' ? 'rgba(95,210,138,0.95)'
                      : m.kind === 'warn' ? 'rgba(240,184,96,0.95)'
                      : 'rgba(124,156,255,0.95)',
            color: '#0b0d12',
            padding: '10px 14px', borderRadius: 8, fontSize: 13, fontWeight: 500,
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
            maxWidth: 360,
          }}>{m.text}</div>
        ))}
      </div>
    </div>
  );
}

// Mount
export default App;
