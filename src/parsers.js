// ===========================================================
// Slidecast — parsers (ES module)
// ===========================================================

export function parseTimecode(tc) {
  const m = tc.trim().match(/^(\d+):(\d+):(\d+)[,.](\d+)$/) ||
            tc.trim().match(/^(\d+):(\d+)[,.](\d+)$/);
  if (!m) return 0;
  if (m.length === 5) {
    const [, h, mn, s, ms] = m;
    return (+h) * 3600 + (+mn) * 60 + (+s) + (+ms) / Math.pow(10, ms.length);
  }
  const [, mn, s, ms] = m;
  return (+mn) * 60 + (+s) + (+ms) / Math.pow(10, ms.length);
}

export function parseSRT(text) {
  const blocks = text.replace(/\r\n/g, '\n').split(/\n\n+/).filter(b => b.trim());
  const out = [];
  for (const b of blocks) {
    const lines = b.split('\n').filter(l => l.trim());
    if (lines.length < 2) continue;
    const tcLineIdx = /-->/g.test(lines[0]) ? 0 : 1;
    const tcLine = lines[tcLineIdx];
    const tcMatch = tcLine.match(/(\S+)\s*-->\s*(\S+)/);
    if (!tcMatch) continue;
    const start = parseTimecode(tcMatch[1]);
    const end = parseTimecode(tcMatch[2]);
    const txt = lines.slice(tcLineIdx + 1).join(' ').trim();
    if (txt) out.push({ start, end, text: txt });
  }
  return out;
}

export function parseVTT(text) {
  const t = text.replace(/^WEBVTT[^\n]*\n+/i, '');
  return parseSRT(t);
}

export function parseTranscriptJSON(raw) {
  const arr = JSON.parse(raw);
  if (!Array.isArray(arr)) throw new Error('JSON 必須是陣列');
  if (arr.length === 0) return { perSlideCues: [], flatCues: [] };
  if (arr[0].cues && Array.isArray(arr[0].cues)) {
    const perSlideCues = arr.map(o => ({
      slide: o.slide ?? o.idx ?? 0,
      cues: o.cues.map(s => String(s)),
    }));
    return { perSlideCues, flatCues: null };
  }
  const flatCues = arr.map(o => ({
    start: +(o.start ?? 0),
    end: +(o.end ?? 0),
    text: String(o.text ?? ''),
    slide: o.slide ?? null,
  }));
  return { perSlideCues: null, flatCues };
}

export function parsePlaintextTranscript(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n').map(l => l.trim()).filter(Boolean);
  return lines;
}

export function chunkLine(s) {
  const parts = [];
  let buf = '';
  for (const ch of s) {
    buf += ch;
    if (/[。？！]/.test(ch)) { parts.push(buf.trim()); buf = ''; }
  }
  if (buf.trim()) parts.push(buf.trim());

  const out = [];
  for (const p of parts) {
    if (p.length <= 28) { out.push(p); continue; }
    const tokens = p.split(/(，|、|；|：|——|—)/).filter(x => x);
    let acc = '';
    for (const t of tokens) {
      if (/^(，|、|；|：|——|—)$/.test(t)) {
        acc += t;
        if (acc.length >= 16) { out.push(acc.trim()); acc = ''; }
        continue;
      }
      acc += t;
    }
    if (acc.trim()) {
      if (acc.trim().length < 8 && out.length) out[out.length - 1] += acc.trim();
      else out.push(acc.trim());
    }
  }
  return out.map(s => s.replace(/^[，、；：]+/, '').trim()).filter(Boolean);
}

export async function parseTranscriptFile(file) {
  const text = await file.text();
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (ext === 'srt')  return { kind: 'timed', flatCues: parseSRT(text) };
  if (ext === 'vtt')  return { kind: 'timed', flatCues: parseVTT(text) };
  if (ext === 'json') {
    const r = parseTranscriptJSON(text);
    if (r.perSlideCues) return { kind: 'per-slide', perSlideCues: r.perSlideCues };
    return { kind: 'timed', flatCues: r.flatCues };
  }
  const lines = parsePlaintextTranscript(text);
  const perSlideCues = lines.map((line, idx) => ({
    slide: idx,
    cues: chunkLine(line),
    text: line,
  }));
  return { kind: 'per-slide', perSlideCues };
}

export async function renderPdfToFrames(file, onProgress) {
  if (!window.pdfjsLib) throw new Error('pdf.js not loaded');
  const buf = await file.arrayBuffer();
  const pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;
  const frames = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    if (onProgress) onProgress(i - 1, pdf.numPages);
    const page = await pdf.getPage(i);
    const v0 = page.getViewport({ scale: 1 });
    const targetLong = 1920;
    const scale = targetLong / Math.max(v0.width, v0.height);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;
    frames.push(canvas.toDataURL('image/jpeg', 0.92));
  }
  if (onProgress) onProgress(pdf.numPages, pdf.numPages);
  return frames;
}

export function imageFilesToUrls(files) {
  const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
  return sorted.map(f => URL.createObjectURL(f));
}

export function htmlFileToUrl(file) {
  return URL.createObjectURL(file);
}

export function audioFilesToList(files) {
  const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
  return sorted.map(f => ({ name: f.name, url: URL.createObjectURL(f), file: f }));
}

export function fmtTime(s) {
  if (!isFinite(s)) s = 0;
  const m = Math.floor(s / 60), ss = Math.floor(s % 60);
  return `${m}:${String(ss).padStart(2, '0')}`;
}

export function fmtBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}
