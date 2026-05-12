// ===========================================================
// Slidecast — Project persistence (IndexedDB)
//
// Schema (DB: 'slidecast', v1):
//   projects   — { id, name, updatedAt, createdAt, payload }
//                payload is the serialized non-blob state
//   blobs      — { id, projectId, role, index, blob, name, mime }
//                role ∈ 'slide' | 'vo' | 'bgm' | 'html'
//
// Public API (window.SlidecastDB):
//   await listProjects()                  → [{id,name,updatedAt,...}]
//   await saveProject(snapshot, id?)      → id (creates or overwrites)
//   await loadProject(id)                 → { payload, blobs:{slides:Blob[], vo:[{name,blob}], bgm:Blob|null, html:Blob|null} }
//   await deleteProject(id)
//   await renameProject(id, name)
// ===========================================================

const DB_NAME = 'slidecast';
const DB_VERSION = 1;

function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, DB_VERSION);
    r.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('projects')) {
        const s = db.createObjectStore('projects', { keyPath: 'id' });
        s.createIndex('updatedAt', 'updatedAt');
      }
      if (!db.objectStoreNames.contains('blobs')) {
        const s = db.createObjectStore('blobs', { keyPath: 'id', autoIncrement: true });
        s.createIndex('projectId', 'projectId');
        s.createIndex('projectRole', ['projectId', 'role']);
      }
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

function tx(db, stores, mode = 'readonly') {
  return db.transaction(stores, mode);
}

function reqAsPromise(req) {
  return new Promise((res, rej) => {
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

function uid() {
  return 'p_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

async function listProjects() {
  const db = await openDB();
  const t = tx(db, ['projects']);
  const all = await reqAsPromise(t.objectStore('projects').getAll());
  // strip payload to keep list light
  return all
    .map(({ id, name, updatedAt, createdAt }) => ({ id, name, updatedAt, createdAt }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

async function deleteBlobsForProject(db, projectId) {
  const t = tx(db, ['blobs'], 'readwrite');
  const idx = t.objectStore('blobs').index('projectId');
  const keys = await reqAsPromise(idx.getAllKeys(IDBKeyRange.only(projectId)));
  await Promise.all(keys.map((k) => reqAsPromise(t.objectStore('blobs').delete(k))));
}

async function saveProject(snapshot, existingId, onProgress) {
  const db = await openDB();
  const id = existingId || uid();
  const now = Date.now();

  // Wipe old blobs first if overwriting
  if (existingId) {
    await deleteBlobsForProject(db, id);
  }

  // Write blobs
  const blobs = snapshot._blobs || {};
  let totalBlobs = 0;
  if (blobs.slides) totalBlobs += blobs.slides.length;
  if (blobs.vo) totalBlobs += blobs.vo.length;
  if (blobs.bgm) totalBlobs += 1;
  if (blobs.html) totalBlobs += 1;
  if (blobs.intro) totalBlobs += 1;
  if (blobs.outro) totalBlobs += 1;
  let written = 0;
  const tick = () => {
    written++;
    if (onProgress && totalBlobs) onProgress(written / totalBlobs);
  };

  const writeBlob = async (role, index, blob, name) => {
    if (!blob) return;
    const t = tx(db, ['blobs'], 'readwrite');
    await reqAsPromise(t.objectStore('blobs').add({
      projectId: id, role, index, blob,
      name: name || null,
      mime: blob.type || '',
    }));
    tick();
  };

  if (blobs.slides) {
    for (let i = 0; i < blobs.slides.length; i++) {
      await writeBlob('slide', i, blobs.slides[i]);
    }
  }
  if (blobs.vo) {
    for (let i = 0; i < blobs.vo.length; i++) {
      const v = blobs.vo[i];
      await writeBlob('vo', i, v.blob, v.name);
    }
  }
  if (blobs.bgm) {
    await writeBlob('bgm', 0, blobs.bgm, blobs.bgmName || null);
  }
  if (blobs.html) {
    await writeBlob('html', 0, blobs.html, blobs.htmlName || null);
  }
  if (blobs.intro) {
    await writeBlob('intro', 0, blobs.intro, blobs.introName || null);
  }
  if (blobs.outro) {
    await writeBlob('outro', 0, blobs.outro, blobs.outroName || null);
  }

  // Write project metadata + payload
  const t2 = tx(db, ['projects'], 'readwrite');
  const existing = existingId ? await reqAsPromise(t2.objectStore('projects').get(id)) : null;
  await reqAsPromise(t2.objectStore('projects').put({
    id,
    name: snapshot.name || existing?.name || ('未命名 ' + new Date().toLocaleString('zh-TW')),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    payload: snapshot.payload || {},
  }));

  return id;
}

async function loadProject(id) {
  const db = await openDB();
  const t = tx(db, ['projects', 'blobs']);
  const project = await reqAsPromise(t.objectStore('projects').get(id));
  if (!project) throw new Error('Project not found: ' + id);
  const blobRows = await reqAsPromise(
    t.objectStore('blobs').index('projectId').getAll(IDBKeyRange.only(id))
  );
  const slides = [];
  const vo = [];
  let bgm = null;
  let html = null;
  let intro = null;
  let outro = null;
  for (const row of blobRows) {
    if (row.role === 'slide') slides[row.index] = row.blob;
    else if (row.role === 'vo') vo[row.index] = { name: row.name, blob: row.blob };
    else if (row.role === 'bgm') bgm = { blob: row.blob, name: row.name };
    else if (row.role === 'html') html = { blob: row.blob, name: row.name };
    else if (row.role === 'intro') intro = { blob: row.blob, name: row.name };
    else if (row.role === 'outro') outro = { blob: row.blob, name: row.name };
  }
  return {
    id: project.id,
    name: project.name,
    updatedAt: project.updatedAt,
    createdAt: project.createdAt,
    payload: project.payload,
    blobs: {
      slides: slides.filter(Boolean),
      vo: vo.filter(Boolean),
      bgm,
      html,
      intro,
      outro,
    },
  };
}

async function deleteProject(id) {
  const db = await openDB();
  await deleteBlobsForProject(db, id);
  const t = tx(db, ['projects'], 'readwrite');
  await reqAsPromise(t.objectStore('projects').delete(id));
}

async function renameProject(id, name) {
  const db = await openDB();
  const t = tx(db, ['projects'], 'readwrite');
  const p = await reqAsPromise(t.objectStore('projects').get(id));
  if (!p) return;
  p.name = name;
  p.updatedAt = Date.now();
  await reqAsPromise(t.objectStore('projects').put(p));
}

async function getStorageEstimate() {
  if (!navigator.storage?.estimate) return null;
  return navigator.storage.estimate();
}

export const SlidecastDB = {
  listProjects,
  saveProject,
  loadProject,
  deleteProject,
  renameProject,
  getStorageEstimate,
};
