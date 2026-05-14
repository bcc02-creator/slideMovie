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
    voFiles,
    bgmFile,
    transcript, transcriptName,
    segments,
    showSubs, bgmBase, resolution,
    introFile, introType, introDuration,
    outroFile, outroType, outroDuration,
  } = state;

  // Slides → Blob[]
  let slideBlobs = [];
  if (slidesMode && slideUrls?.length) {
    slideBlobs = await Promise.all(slideUrls.map(u => urlToBlob(u)));
  }
  // Voiceover → [{name, blob}]
  let voBlobs = [];
  if (voFiles?.length) {
    voBlobs = await Promise.all(voFiles.map(async (v) => ({
      name: v.name,
      blob: v.file || await urlToBlob(v.url),
    })));
  }
  // BGM → Blob
  let bgmBlob = null;
  if (bgmFile) bgmBlob = bgmFile;

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
      voFileNames: (voFiles || []).map(v => v.name),
      bgmFileName: bgmFile?.name || null,
      transcript: transcript || null,
      transcriptName: transcriptName || '',
      segments: segmentsLite,
      showSubs: !!showSubs,
      bgmBase: bgmBase ?? 0.12,
      resolution: resolution || '1920x1080',
      introType: introType || null,
      introDuration: introDuration ?? 3,
      outroType: outroType || null,
      outroDuration: outroDuration ?? 3,
      version: 1,
    },
    _blobs: {
      slides: slideBlobs,
      vo: voBlobs,
      bgm: bgmBlob,
      bgmName: bgmFile?.name || null,
      intro: introFile || null,
      introName: introFile?.name || null,
      outro: outroFile || null,
      outroName: outroFile?.name || null,
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

  let introFile = null;
  if (blobs.intro) {
    const { blob, name } = blobs.intro;
    introFile = blob instanceof File ? blob : new File([blob], name || 'intro', { type: blob.type });
  }
  let outroFile = null;
  if (blobs.outro) {
    const { blob, name } = blobs.outro;
    outroFile = blob instanceof File ? blob : new File([blob], name || 'outro', { type: blob.type });
  }

  return {
    id: loaded.id,
    name: loaded.name,
    payload,
    slideUrls,
    slidesCount: slideUrls.length,
    voFiles,
    bgmFile,
    introFile,
    outroFile,
  };
}


