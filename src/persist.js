// ===========================================================
// Slidecast — Snapshot build/apply helpers.
// Bridges React state ↔ persisted IndexedDB form.
// ===========================================================

// urlToBlob: works for both blob: URLs and data: URLs (via fetch)
async function urlToBlob(url) {
  if (!url) return null;
  const r = await fetch(url);
  return r.blob();
}

// Build a snapshot from current state. Slides become Blobs, vo files become Blobs (using
// each entry's .file when available, else fetching its URL), bgm is the original File,
// transcript is JSON, segments are simplified (no live audio refs).
export async function buildSnapshot(state) {
  const {
    projectName,
    slidesMode, slideUrls,
    htmlDeckUrl, htmlDeckFile,
    voMode, voFiles,
    bgmFile,
    transcript, transcriptName,
    ttsVoiceURI, ttsRate, ttsPitch,
    segments,
    showSubs, bgmBase, resolution,
  } = state;

  // Slides → Blob[]
  let slideBlobs = [];
  if (slidesMode && slideUrls?.length) {
    slideBlobs = await Promise.all(slideUrls.map(u => urlToBlob(u)));
  }
  // Voiceover → [{name, blob}]
  let voBlobs = [];
  if (voMode === 'upload' && voFiles?.length) {
    voBlobs = await Promise.all(voFiles.map(async (v) => ({
      name: v.name,
      blob: v.file || await urlToBlob(v.url),
    })));
  }
  // BGM → Blob
  let bgmBlob = null;
  if (bgmFile) bgmBlob = bgmFile;
  // HTML deck → Blob
  let htmlBlob = null;
  let htmlName = null;
  if (slidesMode === 'html' && htmlDeckUrl) {
    htmlBlob = htmlDeckFile || await urlToBlob(htmlDeckUrl);
    htmlName = htmlDeckFile?.name || 'deck.html';
  }

  // Strip any unserializable fields in segments
  const segmentsLite = (segments || []).map(s => ({
    idx: s.idx,
    start: s.start,
    end: s.end,
    slide: s.slide,
    cues: s.cues || [],
  }));

  return {
    name: projectName || null,
    payload: {
      slidesMode: slidesMode || null,
      voMode: voMode || 'upload',
      voFileNames: (voFiles || []).map(v => v.name),
      bgmFileName: bgmFile?.name || null,
      transcript: transcript || null,
      transcriptName: transcriptName || '',
      ttsVoiceURI: ttsVoiceURI || '',
      ttsRate: ttsRate ?? 1.0,
      ttsPitch: ttsPitch ?? 1.0,
      segments: segmentsLite,
      showSubs: !!showSubs,
      bgmBase: bgmBase ?? 0.18,
      resolution: resolution || '1920x1080',
      version: 1,
    },
    _blobs: {
      slides: slideBlobs,
      vo: voBlobs,
      bgm: bgmBlob,
      bgmName: bgmFile?.name || null,
      html: htmlBlob,
      htmlName: htmlName,
    },
  };
}

// Convert loaded blobs back to URLs/Files, return an "apply" object the
// caller's React component can consume to set state.
export function rehydrateProject(loaded) {
  const { payload, blobs } = loaded;

  const slideUrls = (blobs.slides || []).map(b => URL.createObjectURL(b));

  const voFiles = (blobs.vo || []).map(({ name, blob }, i) => {
    // Wrap Blob as File so existing code that reads .file still works
    const file = blob instanceof File ? blob : new File([blob], name || `vo-${i+1}.wav`, { type: blob.type });
    return { name: name || file.name, url: URL.createObjectURL(file), file };
  });

  let bgmFile = null;
  if (blobs.bgm) {
    const { blob, name } = blobs.bgm;
    bgmFile = blob instanceof File ? blob : new File([blob], name || 'bgm', { type: blob.type });
  }

  let htmlDeckUrl = null;
  let htmlDeckFile = null;
  if (blobs.html) {
    const { blob, name } = blobs.html;
    htmlDeckFile = blob instanceof File ? blob : new File([blob], name || 'deck.html', { type: blob.type || 'text/html' });
    htmlDeckUrl = URL.createObjectURL(htmlDeckFile);
  }

  return {
    id: loaded.id,
    name: loaded.name,
    payload,
    slideUrls,
    slidesCount: slideUrls.length,
    voFiles,
    bgmFile,
    htmlDeckUrl,
    htmlDeckFile,
  };
}


